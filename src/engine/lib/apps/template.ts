/**
 * Starting points for new apps (6.8), one per target (decisions §7). The web
 * template (6.1): React, TypeScript, Vite and Tailwind CSS, small
 * shadcn/ui-style components, SEO built in from one config file (14.1). The
 * mobile template (6.3, decisions §57): Expo SDK 58 and React Native,
 * previewed in the browser through react-native-web and on a phone in Expo
 * Go. Each has a test and a lockfile so every new app installs the same
 * checked package versions. Their files live beside this module and are
 * bundled into the engine as text.
 */
const WEB = import.meta.glob('./templates/web/**/*', {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>
const MOBILE = import.meta.glob('./templates/mobile/**/*', {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>

/** What an app is built for (decisions §7): one target per project. */
export type AppKind = 'web' | 'mobile'
export const APP_KINDS: readonly AppKind[] = ['web', 'mobile']

export const TEMPLATE_VERSION = 'web@1'
export const TEMPLATE_VERSIONS: Record<AppKind, string> = {
  web: TEMPLATE_VERSION,
  mobile: 'mobile@1'
}

export interface TemplateInput {
  /** The package name: lowercase letters, digits and dashes. */
  name: string
  title: string
  description: string
  /** The site's language, e.g. `en` or `ro`. */
  lang: string
}

/**
 * Files saved under other names so they travel inside the bundle as plain
 * text: a dot file, and stylesheets (a bundler would process a `.css`).
 */
const RENAMED: Record<string, string> = { gitignore: '.gitignore', nvmrc: '.nvmrc' }
const TEXT_SUFFIX = /\.tmpl$/

/** `My Bakery!` → `my-bakery`; never empty. */
export function slugOf(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
  return slug || 'my-app'
}

/** Text that goes inside a JSON string. */
const jsonText = (value: string): string => JSON.stringify(value).slice(1, -1)

/** The web template's files, filled in: relative path → content. */
export function webTemplate(input: TemplateInput): Map<string, string> {
  return fill(WEB, 'web', input)
}

/** The mobile template's files (Expo), filled in: relative path → content. */
export function mobileTemplate(input: TemplateInput): Map<string, string> {
  return fill(MOBILE, 'mobile', input)
}

function fill(
  source: Record<string, string>,
  folder: AppKind,
  input: TemplateInput
): Map<string, string> {
  const values: Record<string, string> = {
    name: slugOf(input.name),
    title: jsonText(input.title.trim().slice(0, 120)),
    description: jsonText(input.description.trim().slice(0, 300)),
    lang: /^[a-z]{2}(-[A-Z]{2})?$/.test(input.lang) ? input.lang : 'en'
  }
  const files = new Map<string, string>()
  const prefix = `./templates/${folder}/`
  for (const [key, content] of Object.entries(source)) {
    const relative = key.slice(prefix.length)
    const path = RENAMED[relative] ?? relative.replace(TEXT_SUFFIX, '')
    files.set(
      path,
      // Only the JSON files carry values; everything else reads them from site.config.json.
      path.endsWith('.json') || path.endsWith('.jsonc')
        ? content.replace(/\{\{(name|title|description|lang)\}\}/g, (_, k: string) => values[k])
        : content
    )
  }
  return files
}
