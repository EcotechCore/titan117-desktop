// Helpers for the Apps screen (kept apart from components for fast refresh).

/** What Titan is asked to do; app_build and the approvals do the rest. */
export function appBuildRequest(folder: string, request: string): string {
  return `In the web app ${folder}: ${request.trim()}\n\nUse the app builder (app_build) with this request. When it's done, tell me what changed and whether the checks pass.`
}

/** A new app from the template, then its first build. */
export function appCreateRequest(
  folder: string,
  name: string,
  description: string,
  request: string,
  kind = 'blank',
  target: 'web' | 'mobile' | 'desktop' = 'web'
): string {
  const first = request.trim()
  const how =
    target === 'web'
      ? `app_create${kind !== 'blank' ? `, kind "${kind}"` : ''}`
      : `app_create, target "${target}"`
  return [
    `Make a new ${target} app called "${name.trim()}" in the folder ${folder}, with the description "${description.trim()}" (${how}).`,
    first
      ? `Then build it with the app builder (app_build): ${first}`
      : 'Then stop: I will say what to build.'
  ].join(' ')
}

/** An element picked in the preview (6.9). */
export interface PickedElement {
  tag: string
  text: string
  classes: string
  path: string
  html: string
  page: string
}

/** A visual edit: the picked element and the change, for app_build's quick mode. */
export function visualEditRequest(folder: string, element: PickedElement, change: string): string {
  return [
    `In the web app ${folder}, change one element I picked in the preview, on the page ${element.page}:`,
    `- element: <${element.tag}>${element.text ? ` with the text "${element.text.slice(0, 120)}"` : ''}`,
    element.classes ? `- its classes: ${element.classes.slice(0, 200)}` : '',
    `- where: ${element.path}`,
    '',
    `The change: ${change.trim()}`,
    '',
    'Use the app builder (app_build) with quick set to true, and pass all of the above as the request.'
  ]
    .filter((line, i) => line || i > 3)
    .join('\n')
}

export const PREVIEW_SIZES = [
  { id: 'phone', label: 'Phone', width: 390, height: 844 },
  { id: 'tablet', label: 'Tablet', width: 820, height: 1180 },
  { id: 'desktop', label: 'Desktop', width: 1440, height: 900 }
] as const

export type PreviewSize = (typeof PREVIEW_SIZES)[number]['id']

/** Only the preview's own address on this laptop may be shown in the frame. */
export function isLocalPreview(url: string): boolean {
  return /^http:\/\/127\.0\.0\.1:\d{2,5}\/$/.test(url)
}

export type GitHost = 'cloudflare' | 'netlify' | 'vercel'

export interface HostGuide {
  name: string
  /** The host's own page to start from. */
  start: string
  steps: string[]
  /** What the user should know before choosing it. */
  note: string
}

/**
 * Publishing from the app's GitHub repository with the host's own Git
 * connection (6.15, decisions §56.26): every push to main publishes the site.
 * The steps and setting names are the hosts' own (checked 21 Nov 2026).
 */
export function hostGuide(
  host: GitHost,
  app: { repo: string; owner: string; name: string }
): HostGuide {
  const repo = `${app.owner}/${app.repo}`
  if (host === 'cloudflare')
    return {
      name: 'Cloudflare',
      start: 'https://dash.cloudflare.com/?to=/:account/workers-and-pages/create',
      steps: [
        'In Cloudflare, open Workers & Pages and press Create application.',
        `Choose GitHub, let Cloudflare reach your repositories if it asks, and pick ${repo}.`,
        `Name the project exactly ${app.name} (the name in the site's wrangler.jsonc).`,
        'Build command: npm run build. Deploy command: leave npx wrangler deploy.',
        'Press Save and Deploy. The site gets an address ending in workers.dev.'
      ],
      note: 'Free plan: 3,000 build minutes a month, plenty for a small site. Node 22 comes from the site’s .nvmrc file.'
    }
  if (host === 'netlify')
    return {
      name: 'Netlify',
      start: 'https://app.netlify.com/start',
      steps: [
        'In Netlify, choose Add new project, then Import a Git repository.',
        `Choose GitHub, follow the prompts to let Netlify reach your repositories, and pick ${repo}.`,
        'Branch: main. Build command: npm run build. Publish directory: dist.',
        'Press Publish. The site gets an address ending in netlify.app.'
      ],
      note: 'Its free plan has no commercial-use limit. Node 22 comes from the site’s .nvmrc file.'
    }
  return {
    name: 'Vercel',
    start: 'https://vercel.com/new',
    steps: [
      'In Vercel, press New Project.',
      `Pick ${repo} (if it isn’t listed, use Adjust GitHub App Permissions and add it).`,
      'Framework Preset: Vite. Build Command: npm run build. Output Directory: dist.',
      'Press Deploy. The site gets an address ending in vercel.app.'
    ],
    note: 'Vercel’s free Hobby plan is for personal, non-commercial use: a company’s site needs Pro. A private repository in a GitHub organisation can’t deploy to Hobby. Node comes from the site’s package.json.'
  }
}

export type Store = 'apple' | 'google' | 'microsoft'

export interface StoreGuide {
  name: string
  start: string
  cost: string
  steps: string[]
}

/**
 * Publishing an app in the user's own developer account (6.16, 6.17;
 * decisions §57.13), checked on the stores' own pages on 21 Nov 2026. The
 * user submits it themselves: Apple's guideline 4.2.6 rejects apps from an
 * app generation service unless the app's owner submits them.
 */
export function storeGuide(store: Store, app: { title: string }): StoreGuide {
  if (store === 'apple')
    return {
      name: 'App Store (iPhone)',
      start: 'https://developer.apple.com/programs/enroll/',
      cost: '$99 a year',
      steps: [
        'Join the Apple Developer Program with your Apple Account. As a company you need a D-U-N-S number (free from Dun & Bradstreet, up to 5 business days).',
        `In App Store Connect, add a new app named "${app.title}" with its own bundle ID.`,
        'Make the iPhone build (with Expo EAS in your own Expo account, or on a Mac with Xcode). Titan117 will prepare it when store builds arrive.',
        'Add screenshots, a description, a privacy policy address and what data the app collects.',
        'Submit it for review yourself, from your own account: Apple rejects apps from app builders unless their owner submits them (guideline 4.2.6).'
      ]
    }
  if (store === 'google')
    return {
      name: 'Google Play (Android)',
      start: 'https://play.google.com/console/signup',
      cost: '$25 once',
      steps: [
        'Create a Google Play developer account. A company account needs a D-U-N-S number; a personal one needs your ID.',
        `In Play Console, create the app "${app.title}".`,
        'A new personal account must first run a closed test with at least 12 testers for 14 days before it can publish.',
        'Upload the Android build (an .aab), with screenshots, a description, a privacy policy and the data safety form.',
        'Send it for review; it usually takes up to seven days.'
      ]
    }
  return {
    name: 'Microsoft Store (Windows)',
    start: 'https://partner.microsoft.com/dashboard/registration',
    cost: 'Free',
    steps: [
      'Open a developer account in Partner Center: "Company" for a business (a D-U-N-S number helps verification).',
      `Reserve the name "${app.title}".`,
      'Upload the signed installer (code signing comes with your Windows certificate), with screenshots and a description.',
      'Submit it for certification.'
    ]
  }
}
