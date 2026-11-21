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
  kind = 'blank'
): string {
  const first = request.trim()
  return [
    `Make a new web app called "${name.trim()}" in the folder ${folder}, with the description "${description.trim()}" (app_create${kind !== 'blank' ? `, kind "${kind}"` : ''}).`,
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
