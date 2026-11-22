/**
 * What a web app needs to live in the Titan117 sidebar (6.2; decisions
 * §58): the `titan` SDK (`src/titan.ts`), a `titan.json` saying what data
 * it keeps and reaches, and notes in its AGENTS.md for the coding engine.
 */

/** The SDK's source, bundled into the engine as text. */
export const SDK_SOURCE: string = Object.values(
  import.meta.glob('./templates/sidebar/titan.ts.tmpl', {
    query: '?raw',
    import: 'default',
    eager: true
  }) as Record<string, string>
)[0]

export const SDK_PATH = 'src/titan.ts'
export const MANIFEST = 'titan.json'
export const AGENTS_MARK = '## In the Titan117 sidebar'

export const AGENTS_NOTES = `
${AGENTS_MARK}

This app runs in the Titan117 sidebar. Keep its data with the \`titan\` SDK in \`src/titan.ts\` (don't edit that file):

- \`titan.db.list('contacts', { where: { city: 'Cluj' }, orderBy: 'name', limit: 100 })\`, \`get\`, \`count\`, \`insert\`, \`update\` (a field set to null is removed) and \`remove\`. Records are JSON objects; each gets an \`id\`, \`_created\` and \`_updated\`.
- Collection names: lowercase letters, digits and \`_\` (\`contacts\`, \`order_lines\`). List every collection the app keeps in \`titan.json\` under "collections".
- Another sidebar app's data: \`titan.db.list('inventory/items')\` (that app's id, a slash, its collection). Name it in \`titan.json\` under "reads" (or "writes" to change it); the user agrees before the app gets it.
- \`titan.agent.ask('…')\` opens Titan with a request the user can send.
- \`const text = await titan.ai.ask('…')\` gives a short answer as a string from the user's AI model (summaries, drafts, sorting text). Only when the request needs it: set \`"ai": true\` in \`titan.json\`; it costs credits and the user agrees first. Show a loading state and the error if it fails.
- Look: use the theme colours in \`src/index.css\` (the brand kit) for buttons and accents, never black buttons; quiet borders, white cards, compact tables.
- No \`fetch\`, no other websites, no localStorage: inside the sidebar the app has no network and its data lives only in \`titan.db\`. Outside the sidebar (preview, tests) \`titan.db\` keeps records in memory, so tests work.
- Show a short message while data loads and when a list is empty; catch errors from \`titan.db\` and show them.
- The sidebar is about 900 pixels wide or more: a compact layout with a table or list and a form works well.
`

/** A new `titan.json`. */
export function manifestText(title: string): string {
  return (
    JSON.stringify(
      { name: title, icon: 'app', collections: [], reads: [], writes: [], ai: false },
      null,
      2
    ) + '\n'
  )
}
