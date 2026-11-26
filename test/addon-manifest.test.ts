import { describe, expect, it } from 'vitest'

import {
  addonHost,
  describeAddon,
  parseAddonManifest,
  safeAddonPath
} from '../src/shared/addon-manifest'

/**
 * The same cases run in the web repo (titan117-web packages/shared/src/addons.test.ts), so the
 * marketplace's listing and the laptop agree on what a valid add-on is.
 */
const tool = {
  titan: 1,
  type: 'tool',
  name: 'ron-rates',
  title: 'RON exchange rates',
  version: '1.0.0',
  description: "Reads the National Bank of Romania's daily rates.",
  license: 'MIT',
  tool: {
    main: 'tool.js',
    hosts: ['www.bnr.ro', 'WWW.BNR.RO'],
    tools: [
      {
        name: 'rate',
        description: "Today's rate for a currency.",
        risk: 'read',
        params: {
          type: 'object',
          properties: { currency: { type: 'string', description: 'EUR' } },
          required: ['currency', 'nope']
        }
      },
      { name: 'send_rates', description: 'Mails the rates.', risk: 'read' }
    ]
  }
}

describe('titan.json', () => {
  it('reads a tool add-on and cleans it', () => {
    const r = parseAddonManifest(tool)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.manifest.tool?.hosts).toEqual(['www.bnr.ro'])
    expect(r.manifest.tool?.tools[0].params.required).toEqual(['currency'])
    // A name that sends acts outside, whatever it says.
    expect(r.manifest.tool?.tools[1].risk).toBe('external')
    expect(describeAddon(r.manifest).join('\n')).toContain('may reach only: www.bnr.ro')
  })

  it('reads an agent add-on', () => {
    const r = parseAddonManifest({
      titan: 1,
      type: 'agent',
      name: 'invoice-clerk',
      version: '0.2.0',
      description: 'Totals invoices per client.',
      agent: 'agent.md',
      skills: ['skills/monthly-total.md']
    })
    expect(r.ok && r.manifest.agent).toBe('agent.md')
  })

  it.each([
    [{ ...tool, titan: 2 }, '"titan": 1'],
    [{ ...tool, type: 'virus' }, '"type"'],
    [{ ...tool, name: 'Bad Name' }, '"name"'],
    [{ ...tool, version: 'one' }, '"version"'],
    [{ ...tool, description: '' }, 'description'],
    [{ ...tool, agent: 'agent.md' }, "can't have"],
    [{ ...tool, tool: { ...tool.tool, main: '../escape.js' } }, 'tool.main'],
    [{ ...tool, tool: { ...tool.tool, hosts: ['localhost'] } }, 'public host'],
    [{ ...tool, tool: { ...tool.tool, hosts: ['127.0.0.1'] } }, 'public host'],
    [{ ...tool, tool: { ...tool.tool, tools: [] } }, '1 to 20'],
    [{ ...tool, tool: { ...tool.tool, tools: [{ name: 'x1', description: 'd' }] } }, 'risk'],
    [
      {
        titan: 1,
        type: 'skill',
        name: 'ab',
        version: '1.0.0',
        description: 'd',
        skills: ['/etc/passwd.md']
      },
      '.md file'
    ],
    [{ titan: 1, type: 'agent', name: 'ab', version: '1.0.0', description: 'd' }, 'agent file']
  ])('refuses %#', (raw, message) => {
    const r = parseAddonManifest(raw)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain(message)
  })

  it('keeps paths inside the add-on', () => {
    expect(safeAddonPath('skills/a.md')).toBe('skills/a.md')
    expect(safeAddonPath('./tool.js')).toBe('tool.js')
    expect(safeAddonPath('.')).toBe('.')
    for (const bad of ['../a', 'a/../../b', '/a', 'C:/a', 'a\\b', '.git/config', '', 5])
      expect(safeAddonPath(bad)).toBeNull()
  })

  it('allows only public host names', () => {
    expect(addonHost('api.example.com')).toBe('api.example.com')
    for (const bad of [
      'localhost',
      '10.0.0.1',
      'printer.local',
      'a.com:8080',
      'https://a.com',
      '*.a.com'
    ])
      expect(addonHost(bad)).toBeNull()
  })
})
