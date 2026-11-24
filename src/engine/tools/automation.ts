/**
 * Automation tools (phase 13; decisions §61): schedules in plain words
 * (8.10), web watches (5.5) and recordings that replay without AI (5.6, §8).
 *
 * A schedule or a recording is a standing instruction, so making one asks
 * every time, on the laptop only, like a skill or a new agent. Reading and
 * checking run at once. A replay clicks through a live site, so it asks; its
 * final steps (send, pay, publish) ask every time (decisions §29).
 *
 * Pages and recordings' results are data, never instructions (guardrails §5).
 */
import { PermissionError } from '../lib/folders'
import {
  checkRecording,
  describeStep,
  type Recording,
  type RunResult
} from '../lib/automation/recorder'
import {
  checkName,
  checkWhen,
  describeAction,
  describeWhen,
  type Schedule
} from '../lib/automation/schedule'
import { checkText, checkUrls, MAX_WATCH_PAGES } from '../lib/automation/watch'
import { FINAL_STEP, siteRule } from './browser'
import { defineTool, type ToolContext } from './lib/define-tool'

function when(at: number | null): string {
  return at
    ? new Date(at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
    : '–'
}

function scheduleLine(s: Schedule): string {
  return `- "${s.name}": ${describeWhen(s.when)}; ${describeAction(s.action)}; ${s.enabled ? `next ${when(s.nextAt)}` : 'paused'}${s.lastAt ? `; last ${when(s.lastAt)} (${s.lastNote ?? ''})` : ''}`
}

export const scheduleList = defineTool<Record<string, never>>({
  name: 'schedule_list',
  description:
    'List the schedules: what runs by itself, when, its next time and how the last run went.',
  params: { type: 'object', properties: {}, required: [] },
  risk: 'read',
  permissions: { automation: 'read' },
  describe: () => 'List the schedules',
  async run(_input, ctx) {
    const all = ctx.automation.schedules()
    return {
      output: all.length ? all.map(scheduleLine).join('\n') : 'There are no schedules yet.',
      summary: `Listed ${all.length} schedule(s)`
    }
  }
})

interface ScheduleInput {
  name: string
  when: Record<string, unknown>
  agent?: string
  prompt?: string
  recording?: string
  values?: Record<string, unknown>
  watch?: string
}

function actionOf(input: ScheduleInput): Record<string, unknown> {
  if (input.recording)
    return { kind: 'recording', recording: input.recording, values: input.values }
  if (input.watch) return { kind: 'watch', watch: input.watch }
  return { kind: 'task', agent: input.agent ?? 'Titan', prompt: input.prompt }
}

export const scheduleCreate = defineTool<ScheduleInput>({
  name: 'schedule_create',
  description: `Make a schedule from the user's words (8.10), e.g. "every weekday at 8, brief me on …". It runs by itself while Titan117 is open and catches up once after the laptop was off; times are the laptop's local time. "when" is one of: {"kind":"daily","time":"08:00","days":[1,2,3,4,5]} (days 0 = Sunday … 6 = Saturday; leave days out for every day), {"kind":"monthly","day":1,"time":"09:00"}, {"kind":"interval","minutes":120} (at least 15), {"kind":"once","at":"2026-12-01T09:00"}. What runs is ONE of: "prompt" (a task for "agent", Titan by default; write the prompt as a complete instruction, since the run sees only that), "recording" (a saved recording's name, replayed without AI) or "watch" (a web watch's name, checked and summed up). The user approves every new schedule.`,
  params: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'A short name, e.g. "Morning briefing"' },
      when: { type: 'object', description: 'When it runs (see the description)' },
      agent: { type: 'string', description: 'The agent for a prompt (default Titan)' },
      prompt: { type: 'string', description: 'What the scheduled task should do' },
      recording: { type: 'string', description: 'A recording to replay instead of a prompt' },
      values: { type: 'object', description: "Values for the recording's variables" },
      watch: { type: 'string', description: 'A web watch to check instead of a prompt' }
    },
    required: ['name', 'when']
  },
  risk: 'write',
  laptopOnly: true,
  permissions: { automation: 'write' },
  describe: (input) => `Make the schedule "${input.name}"`,
  assess(input) {
    try {
      const name = checkName(input.name)
      const w = checkWhen(input.when, Date.now())
      const what = input.recording
        ? `replay the recording "${String(input.recording).slice(0, 60)}" without asking each time (its final steps, like send or pay, still ask)`
        : input.watch
          ? `check the watch "${String(input.watch).slice(0, 60)}" and say what changed`
          : `${String(input.agent ?? 'Titan').slice(0, 40)} does this: "${String(input.prompt ?? '').slice(0, 400)}"`
      return {
        risk: 'write',
        // A standing instruction: asked every time, never "always".
        alwaysAsks: true,
        summary: `Make the schedule "${name}". ${describeWhen(w)}, while Titan117 is open: ${what}`
      }
    } catch (error) {
      return { risk: 'write', summary: 'Make a schedule', refuse: (error as Error).message }
    }
  },
  async run(input, ctx) {
    const schedule = ctx.automation.createSchedule({
      name: input.name,
      when: input.when,
      action: actionOf(input)
    })
    return {
      output: `Made the schedule "${schedule.name}": ${describeWhen(schedule.when)}; ${describeAction(schedule.action)}. Next run: ${when(schedule.nextAt)}. It runs while Titan117 is open and catches up once after the laptop was off. The user can pause, run or remove it on the Automations screen.`,
      summary: `Made the schedule ${schedule.name}`
    }
  }
})

export const scheduleChange = defineTool<{ name: string; action: string }>({
  name: 'schedule_change',
  description: 'Pause, resume, remove or run a schedule now, by its name.',
  params: {
    type: 'object',
    properties: {
      name: { type: 'string', description: "The schedule's name" },
      action: {
        type: 'string',
        description: 'What to do',
        enum: ['pause', 'resume', 'remove', 'run_now']
      }
    },
    required: ['name', 'action']
  },
  risk: 'write',
  permissions: { automation: 'write' },
  describe: (input) =>
    `${{ pause: 'Pause', resume: 'Resume', remove: 'Remove', run_now: 'Run now' }[input.action] ?? 'Change'} the schedule "${input.name}"`,
  async run(input, ctx) {
    const result = ctx.automation.changeSchedule(
      input.name,
      input.action as 'pause' | 'resume' | 'remove' | 'run_now'
    )
    return {
      output: result ? scheduleLine(result) : `Removed the schedule "${input.name}".`,
      summary: `${input.action} on the schedule ${input.name}`
    }
  }
})

export const watchList = defineTool<{ watch?: string }>({
  name: 'watch_list',
  description:
    'List the web watches (pages checked for changes), or with "watch" the latest changes one of them saw.',
  params: {
    type: 'object',
    properties: {
      watch: { type: 'string', description: "A watch's name, for its latest changes" }
    },
    required: []
  },
  risk: 'read',
  permissions: { automation: 'read' },
  untrustedOutput: true,
  describe: (input) => (input.watch ? `Read the watch "${input.watch}"` : 'List the web watches'),
  async run(input, ctx) {
    if (input.watch) {
      const changes = ctx.automation.watchChanges(input.watch)
      return {
        output: changes.length
          ? changes
              .map((c) =>
                [
                  `${when(c.at)}: ${c.url}`,
                  ...c.added.slice(0, 15).map((l) => `+ ${l}`),
                  ...c.removed.slice(0, 15).map((l) => `- ${l}`)
                ].join('\n')
              )
              .join('\n\n')
          : 'No changes seen yet.',
        summary: `Read the watch ${input.watch}`
      }
    }
    const all = ctx.automation.watches()
    return {
      output: all.length
        ? all
            .map(
              (w) =>
                `- "${w.name}": ${w.urls.join(', ')}${w.about ? `; cares about: ${w.about}` : ''}; last checked ${when(w.lastCheckedAt)}, last change ${when(w.lastChangedAt)}`
            )
            .join('\n')
        : 'There are no web watches yet.',
      summary: `Listed ${all.length} watch(es)`
    }
  }
})

export const watchSave = defineTool<{ name: string; urls: string[]; about?: string }>({
  name: 'watch_save',
  description: `Make or change a web watch (5.5): up to ${MAX_WATCH_PAGES} public pages to re-read for changes, e.g. an official page listing new laws, a supplier's price list, a competitor's news page. Prefer the page that LISTS what is new over a home page. "about" says what matters to the user, in their words. Check it with watch_check; to check it regularly, make a schedule with schedule_create (watch).`,
  params: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'A short name, e.g. "Environmental law"' },
      urls: { type: 'array', description: 'The pages to watch (full addresses)' },
      about: { type: 'string', description: 'What matters to the user in these pages' }
    },
    required: ['name', 'urls']
  },
  risk: 'write',
  permissions: { automation: 'write' },
  describe: (input) => `Save the web watch "${input.name}"`,
  assess(input) {
    try {
      const urls = checkUrls(input.urls)
      return {
        risk: 'write',
        summary: `Watch ${urls.length} page(s) as "${checkName(input.name)}": ${urls.join(', ').slice(0, 600)}`
      }
    } catch (error) {
      return { risk: 'write', summary: 'Save a web watch', refuse: (error as Error).message }
    }
  },
  async run(input, ctx) {
    const watch = ctx.automation.saveWatch(input)
    return {
      output: `Saved the watch "${watch.name}" with ${watch.urls.length} page(s). Run watch_check now so later checks have a starting point.`,
      summary: `Saved the watch ${watch.name}`
    }
  }
})

export const watchCheck = defineTool<{ watch: string }>({
  name: 'watch_check',
  description:
    "Check a web watch now: re-reads its pages (politely, as robots.txt allows) and lists the lines that are new or gone since the last check. The first check only sets the starting point. Then tell the user what matters to their company, with the page's address; if nothing changed, say so in one line.",
  params: {
    type: 'object',
    properties: { watch: { type: 'string', description: "The watch's name" } },
    required: ['watch']
  },
  risk: 'read',
  permissions: { automation: 'write', network: true },
  untrustedOutput: true,
  describe: (input) => `Check the watch "${input.watch}"`,
  async run(input, ctx) {
    const check = await ctx.automation.checkWatch(
      input.watch,
      async (url) => (await ctx.pages.read(url, { fresh: true })).text
    )
    const changed = check.pages.filter((p) => p.changed).length
    const failed = check.pages.filter((p) => p.error).length
    return {
      output: checkText(check),
      summary: `Checked the watch ${check.watch.name}: ${changed} of ${check.pages.length} page(s) changed${failed ? `, ${failed} couldn't be read` : ''}`
    }
  }
})

function recordingText(r: Recording): string {
  return [
    `Recording "${r.name}" (${r.title}), starts at ${r.url}.`,
    r.variables.length
      ? `Variables: ${r.variables.map((v) => `{{${v.name}}} (${v.label}${v.default ? `, default "${v.default}"` : ''})`).join(', ')}`
      : '',
    ...r.steps.map((s, i) => `${i + 1}. ${describeStep(s)}`),
    '',
    'As JSON (for recording_save):',
    JSON.stringify({
      name: r.name,
      title: r.title,
      url: r.url,
      variables: r.variables,
      steps: r.steps
    })
  ]
    .filter((l, i) => l !== '' || i > 2)
    .join('\n')
}

export const recordingList = defineTool<{ name?: string }>({
  name: 'recording_list',
  description:
    'List the saved recordings (browser steps that replay without AI), or with "name" read one: its steps and variables.',
  params: {
    type: 'object',
    properties: { name: { type: 'string', description: "A recording's name, to read its steps" } },
    required: []
  },
  risk: 'read',
  permissions: { automation: 'read' },
  untrustedOutput: true,
  describe: (input) => (input.name ? `Read the recording "${input.name}"` : 'List the recordings'),
  async run(input, ctx) {
    if (input.name) {
      const recording = ctx.automation.recording(input.name)
      if (!recording) throw new PermissionError(`There is no recording called "${input.name}".`)
      return { output: recordingText(recording), summary: `Read the recording ${recording.name}` }
    }
    const all = ctx.automation.recordings()
    return {
      output: all.length
        ? all
            .map((r) => `- "${r.name}": ${r.title}; ${r.steps.length} steps; starts at ${r.url}`)
            .join('\n')
        : 'There are no recordings yet. The user records one on the Automations screen (Record new).',
      summary: `Listed ${all.length} recording(s)`
    }
  }
})

export const recordingSave = defineTool<{
  name: string
  title?: string
  url: string
  steps: unknown[]
  variables?: unknown[]
}>({
  name: 'recording_save',
  description:
    'Save a recording: browser steps that replay without AI. Use it to fix a broken step of an existing recording (8.4), to add variables (8.3), or to write a new one. Steps: {"action":"goto","url"}, {"action":"click","target"}, {"action":"fill","target","value"} (value may hold {{variables}}), {"action":"fill_login","target","field":"username"|"password","site"} (the saved login from the keychain; NEVER write a password as a value), {"action":"select","target","value"}, {"action":"press","key"}, {"action":"wait_text","text"}, {"action":"pause","note"} (the user does it, e.g. a 2FA code). A target is {"role","name"} (button, link, textbox, checkbox, combobox…), {"label"} for a field, {"text"} or {"css"}; several may be given and are tried in that order. Variables: [{"name","label","default"}]. The user approves every save, with the steps shown.',
  params: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Small letters and dashes, e.g. monthly-report' },
      title: { type: 'string', description: 'What it does, in a few words' },
      url: { type: 'string', description: 'Where it starts' },
      steps: { type: 'array', description: 'The steps, in order' },
      variables: { type: 'array', description: 'Values that change from run to run' }
    },
    required: ['name', 'url', 'steps']
  },
  risk: 'write',
  laptopOnly: true,
  permissions: { automation: 'write' },
  describe: (input) => `Save the recording "${input.name}"`,
  assess(input) {
    try {
      const recording = checkRecording(input, 'an agent')
      return {
        risk: 'write',
        // A standing instruction: asked every time, never "always".
        alwaysAsks: true,
        summary: `Save the recording "${recording.name}" (${recording.steps.length} steps, starting at ${recording.url}): ${recording.steps
          .map((s, i) => `${i + 1}. ${describeStep(s)}`)
          .join('; ')
          .slice(0, 1500)}`
      }
    } catch (error) {
      return { risk: 'write', summary: 'Save a recording', refuse: (error as Error).message }
    }
  },
  async run(input, ctx) {
    const saved = ctx.automation.saveRecording(input)
    return {
      output: `Saved the recording "${saved.name}" (${saved.steps.length} steps). Run it with recording_run, or put it on a schedule with schedule_create.`,
      summary: `Saved the recording ${saved.name}`
    }
  }
})

function resultText(result: RunResult, recording: Recording): string {
  if (result.passed)
    return `The recording "${recording.name}" ran to the end: ${result.done} step(s) in ${(result.ms / 1000).toFixed(1)} s. The browser ended at ${result.url} ("${result.title}").`
  const failed = recording.steps[(result.failedStep ?? 1) - 1]
  return [
    `The recording "${recording.name}" stopped at step ${result.failedStep} of ${recording.steps.length}${failed ? ` (${describeStep(failed)})` : ' (opening the first page)'}: ${result.error}`,
    `${result.done} step(s) ran before it. The browser is at ${result.url} ("${result.title}").`,
    'To fix it: look at the page with browser_view, find what changed, and propose the corrected steps with recording_save (the user approves the fix). Do not carry out the remaining steps yourself unless the user asks.'
  ].join('\n')
}

/** The hooks every replay gets: final steps and hand-overs ask the user (decisions §29). */
function replayHooks(
  ctx: ToolContext,
  values: Record<string, string>
): Parameters<ToolContext['browser']['replay']>[1] {
  return {
    values,
    login: (site) => ctx.automation.login(site),
    async beforeClick(label) {
      if (!FINAL_STEP.test(label)) return
      const yes = await ctx.ask(
        `Click "${label.slice(0, 80)}"? This is a final step of the recording (it may publish, send or pay).`
      )
      if (!yes)
        throw new PermissionError(
          `You didn't approve "${label.slice(0, 80)}". The recording stopped before it.`
        )
    },
    async pause(note) {
      const yes = await ctx.ask(
        `${note.slice(0, 200)} Do it in the browser window, then approve to let the recording go on.`
      )
      if (!yes) throw new PermissionError('You stopped the recording at its pause.')
    },
    signal: ctx.signal
  }
}

export const recordingRun = defineTool<{ name: string; values?: Record<string, unknown> }>({
  name: 'recording_run',
  description:
    "Replay a saved recording in the browser, without AI: it opens the pages, clicks and fills like the user did, with saved logins from the keychain. It clicks through a live site, so it asks first; a final step (send, pay, publish, order) asks every time, and a pause step hands over to the user. Give values for the recording's variables.",
  params: {
    type: 'object',
    properties: {
      name: { type: 'string', description: "The recording's name" },
      values: { type: 'object', description: 'Values for its variables, by name' }
    },
    required: ['name']
  },
  risk: 'write',
  permissions: { automation: 'write', browser: true },
  untrustedOutput: true,
  describe: (input) => `Replay the recording "${input.name}" in the browser`,
  async run(input, ctx) {
    const recording = ctx.automation.recording(input.name)
    if (!recording) throw new PermissionError(`There is no recording called "${input.name}".`)
    // Every site the recording opens by itself follows the same rules as browser_open.
    const hosts = new Set<string>()
    for (const url of [
      recording.url,
      ...recording.steps.flatMap((s) => (s.action === 'goto' ? [s.url] : []))
    ]) {
      const rule = siteRule(url)
      if (rule === 'never')
        throw new PermissionError(
          "Discord isn't automated: its terms forbid it, so Titan117 never does."
        )
      if (rule === 'forbids') hosts.add(new URL(url).hostname)
    }
    for (const host of hosts) {
      const key = `automation:${host}`
      let yes = ctx.remembered(key)
      if (yes === null) {
        yes = await ctx.ask(
          `${host}'s terms don't allow automation. It may restrict your account. Run it anyway?`
        )
        ctx.remember(key, yes)
      }
      if (!yes) throw new PermissionError(`You chose not to automate ${host}.`)
    }
    const values: Record<string, string> = {}
    for (const [k, v] of Object.entries(input.values ?? {})) values[k] = String(v)
    const result = await ctx.browser.replay(recording, replayHooks(ctx, values))
    return {
      output: resultText(result, recording),
      summary: result.passed
        ? `Replayed ${recording.name}: ${result.done} steps`
        : `Replay of ${recording.name} stopped at step ${result.failedStep}`
    }
  }
})

export const automationTools = [
  scheduleList,
  scheduleCreate,
  scheduleChange,
  watchList,
  watchSave,
  watchCheck,
  recordingList,
  recordingSave,
  recordingRun
]
