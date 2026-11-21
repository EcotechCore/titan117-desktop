// Phase 8's pieces for real, no model: Node.js downloaded from nodejs.org
// and checked against its hash, a new web app from the template, its
// packages installed from npm, typecheck, build and tests, then the app
// opened in Chromium (the laptop's Edge or Chrome), Firefox and WebKit at
// three sizes and in dark mode. Downloads go to a folder kept between runs
// (TITAN117_LIVE_COMPONENTS, or the system temp folder): about 41 MB for
// Node.js and 250 MB for the two browsers the first time.
//
//   pnpm eval:apps
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeAll, describe, expect, it } from 'vitest'

import { createNodeComponent } from '../../src/engine/lib/apps/node'
import { createRunner } from '../../src/engine/lib/apps/runner'
import { createBrowserTests } from '../../src/engine/lib/apps/browsers'
import { createAppService } from '../../src/engine/lib/apps/service'
import { tempFolder } from '../helpers'

const components =
  process.env.TITAN117_LIVE_COMPONENTS ?? join(tmpdir(), 'titan117-live-components')

beforeAll(() => {
  // Versions need a git name and email: a throwaway home gives them.
  const home = tempFolder('titan117-home-')
  writeFileSync(
    join(home, '.gitconfig'),
    '[user]\n\tname = Live Test\n\temail = live@example.com\n'
  )
  process.env.HOME = home
})

describe('the web app builder, for real', () => {
  it('builds, tests and opens a new app in three browser engines', async () => {
    const node = createNodeComponent({ dir: join(components, 'node') })
    const notes: string[] = []
    const runtime = await node.ensure((n) => notes.push(n))
    expect(existsSync(runtime.node)).toBe(true)

    const apps = createAppService({
      runner: createRunner({
        node: () => node.ensure(),
        npmDir: join(components, 'npm'),
        scratch: tempFolder('titan117-apps-scratch-')
      }),
      browsers: createBrowserTests({ dir: join(components, 'browsers') }),
      coAuthor: () => true
    })
    const root = tempFolder('titan117-live-apps-')
    const app = await apps.create(root, {
      title: 'Cluj Bakery',
      description: 'Fresh bread every morning in Cluj, baked with local flour since 1998.'
    })

    const report = await apps.check(app.folder, { onProgress: (n) => notes.push(n) })
    console.log(notes.join('\n'))
    console.log(report.summary)
    expect(report.checks.map((c) => [c.name, c.ok])).toEqual([
      ['install', true],
      ['typecheck', true],
      ['build', true],
      ['test', true]
    ])
    expect(report.browsers?.engines.map((e) => e.engine)).toEqual(['chromium', 'firefox', 'webkit'])
    expect(report.browsers?.engines.every((e) => e.ran)).toBe(true)
    const shots = readdirSync(join(app.folder, '.titan117', 'reports', report.id)).filter((f) =>
      f.endsWith('.png')
    )
    expect(shots).toHaveLength(12)
    expect(report.browsers?.seo.filter((f) => !f.ok)).toEqual([])
    expect(report.passed).toBe(true)

    // The preview serves the app on 127.0.0.1 only.
    const { url } = await apps.startPreview(app.folder)
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/)
    const html = await (await fetch(url)).text()
    expect(html).toContain('<title>Cluj Bakery</title>')
    apps.stopPreview(app.folder)

    // A real problem is found: a second <h1> and a font from another website.
    const appFile = join(app.folder, 'src', 'App.tsx')
    writeFileSync(
      appFile,
      readFileSync(appFile, 'utf8').replace(
        '<p className',
        '<h1>Again</h1>\n      <link rel="stylesheet" href="https://fonts.example.com/x.css" />\n      <p className'
      )
    )
    const broken = await apps.check(app.folder, { engines: ['firefox'] })
    console.log(broken.summary)
    expect(broken.passed).toBe(false)
    expect(broken.summary).toContain('One main heading')
    expect(broken.summary).toContain('Blocked (outside the preview): https://fonts.example.com')
  })
})
