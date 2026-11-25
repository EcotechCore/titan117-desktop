/**
 * Images and video (feature 2.7, decisions §59.10) through OpenRouter: our
 * credits, or the user's own OpenRouter key. The result is saved as a file in
 * an allowed folder.
 *
 * Both cost money, so both ask: an image with "always in this task", a video
 * every time and on the laptop only (a video can cost dollars). The prompt is
 * checked for private content before the user is even asked: it leaves the
 * laptop.
 */
import { extensionFor, mediaVia } from '../lib/media'
import { defineTool } from './lib/define-tool'

const ASPECTS = ['1:1', '16:9', '9:16', '4:3', '3:4']

/**
 * Camera moves for a clip (the video studio, 15.15): plain words added to the
 * prompt, which every video model reads. Our own names and wording.
 */
export const CAMERA_MOVES: Record<string, string> = {
  still: 'Locked-off camera, no camera movement.',
  'push-in': 'The camera slowly pushes in towards the subject.',
  'pull-out': 'The camera slowly pulls back to reveal the scene.',
  'pan-left': 'The camera pans slowly from right to left.',
  'pan-right': 'The camera pans slowly from left to right.',
  orbit: 'The camera orbits slowly around the subject.',
  'crane-up': 'The camera rises slowly, like a crane shot.',
  handheld: 'Handheld camera with gentle natural movement.',
  drone: 'An aerial drone shot moving slowly forward.'
}

export function withCamera(prompt: string, camera?: string): string {
  const move = camera ? CAMERA_MOVES[camera] : undefined
  return move ? `${prompt.trim()} ${move}` : prompt
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'media'
  )
}

function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')
}

/** Where to save: the path asked for (its extension fixed to what came back), or a fresh name. */
function savePath(asked: string | undefined, folder: string, prompt: string, ext: string): string {
  const path = (asked ?? '').trim()
  if (!path) return `${folder}/${slug(prompt)}-${stamp()}.${ext}`
  return /\.[a-z0-9]{2,5}$/i.test(path)
    ? path.replace(/\.[a-z0-9]{2,5}$/i, `.${ext}`)
    : `${path}.${ext}`
}

/** The file type the user asked for, so the provider makes that one (a .png stays a PNG). */
function formatOf(path: string | undefined): 'png' | 'jpeg' | 'webp' | undefined {
  const ext = /\.([a-z0-9]{2,5})$/i.exec(path ?? '')?.[1]?.toLowerCase()
  return ext === 'png'
    ? 'png'
    : ext === 'jpg' || ext === 'jpeg'
      ? 'jpeg'
      : ext === 'webp'
        ? 'webp'
        : undefined
}

function money(usd: number): string {
  return usd <= 0 ? 'no charge reported' : usd < 0.01 ? 'under $0.01' : `$${usd.toFixed(2)}`
}

interface MediaInput {
  prompt: string
  path?: string
  model?: string
  aspect_ratio?: string
}

export const imageCreate = defineTool<MediaInput>({
  name: 'image_create',
  description: [
    'Make an image from a description (a picture for a post, a product shot, an illustration) and save it in an allowed folder.',
    'It costs credits (or uses the user’s own OpenRouter key) and asks the user first. Describe the image fully; never put private data in the prompt.',
    'Leave "model" empty unless the user named one.'
  ].join(' '),
  params: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'What the image shows, its style and mood.' },
      path: {
        type: 'string',
        description: 'Where to save it, e.g. images/cake.png. Empty: images/<name>.'
      },
      model: {
        type: 'string',
        description: 'An OpenRouter image model id, only if the user named one.'
      },
      aspect_ratio: { type: 'string', description: 'The shape.', enum: ASPECTS }
    },
    required: ['prompt']
  },
  risk: 'write',
  permissions: { folders: 'write', media: true },
  describe: (input) => `Make an image: "${String(input.prompt ?? '').slice(0, 160)}"`,
  assess(input) {
    return {
      risk: 'write',
      summary:
        `Make an image${input.model ? ` with ${input.model}` : ''}: "${String(input.prompt ?? '').slice(0, 160)}". ` +
        'It costs credits (OpenRouter’s price for the model) and the description leaves this laptop.',
      outgoing: String(input.prompt ?? '')
    }
  },
  async run(input, ctx) {
    const model = await ctx.media.pick('image', input.model)
    const image = await ctx.media.image({
      model,
      prompt: input.prompt,
      aspectRatio: input.aspect_ratio,
      format: formatOf(input.path)
    })
    const path = savePath(input.path, 'images', input.prompt, extensionFor(image.mediaType))
    await ctx.files.writeBytes(path, image.bytes)
    return {
      output: `Saved the image to ${path} (${model}, ${money(image.costUsd)}).`,
      summary: `Made an image with ${model}: ${path} · ${mediaVia(image.via)}`,
      costUsd: image.costUsd
    }
  }
})

export const videoCreate = defineTool<MediaInput & { seconds?: number; camera?: string }>({
  name: 'video_create',
  description: [
    'Make a short video clip from a description and save it in an allowed folder. It takes minutes and can cost dollars,',
    'so it asks the user every time. Prefer images or the free video engine for simple motion graphics; use this when the user wants an AI video clip.',
    'Leave "model" empty unless the user named one.'
  ].join(' '),
  params: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'What happens in the clip, the camera and the style.'
      },
      seconds: {
        type: 'number',
        description: 'Length in seconds (the model decides what it allows).'
      },
      path: { type: 'string', description: 'Where to save it, e.g. videos/intro.mp4.' },
      model: {
        type: 'string',
        description: 'An OpenRouter video model id, only if the user named one.'
      },
      aspect_ratio: { type: 'string', description: 'The shape.', enum: ASPECTS },
      camera: {
        type: 'string',
        description: 'A camera move for the clip (the video studio).',
        enum: Object.keys(CAMERA_MOVES)
      }
    },
    required: ['prompt']
  },
  risk: 'write',
  permissions: { folders: 'write', media: true },
  laptopOnly: true,
  describe: (input) => `Make a video: "${String(input.prompt ?? '').slice(0, 160)}"`,
  assess(input) {
    return {
      risk: 'write',
      summary:
        `Make a ${input.seconds ? `${input.seconds}-second ` : ''}video${input.model ? ` with ${input.model}` : ''}: "${String(input.prompt ?? '').slice(0, 160)}". ` +
        'Video can cost dollars in credits; the description leaves this laptop and the provider keeps it (no zero data retention for video).',
      alwaysAsks: true,
      outgoing: withCamera(String(input.prompt ?? ''), input.camera)
    }
  },
  async run(input, ctx) {
    const model = await ctx.media.pick('video', input.model)
    const video = await ctx.media.video({
      model,
      prompt: withCamera(input.prompt, input.camera),
      seconds: typeof input.seconds === 'number' ? Math.round(input.seconds) : undefined,
      aspectRatio: input.aspect_ratio
    })
    const path = savePath(input.path, 'videos', input.prompt, extensionFor(video.mediaType))
    await ctx.files.writeBytes(path, video.bytes)
    return {
      output: `Saved the video to ${path} (${model}, ${money(video.costUsd)}).`,
      summary: `Made a video with ${model}: ${path} · ${mediaVia(video.via)}`,
      costUsd: video.costUsd
    }
  }
})

export const mediaTools = [imageCreate, videoCreate]
