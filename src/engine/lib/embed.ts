/**
 * Search by meaning (feature 7.4, decisions §51): multilingual-e5-small (MIT,
 * from intfloat; the ONNX copy by Xenova on Hugging Face), about 120 MB,
 * downloaded the first time it's needed and then run on the laptop through
 * transformers.js. Romanian and English (and about 100 other languages).
 * Nothing is sent anywhere to embed a passage or a question.
 */
import type { Embedder } from './doc-index'

export const EMBED_MODEL = 'Xenova/multilingual-e5-small'

export function createLocalEmbedder(options: { modelsDir: string }): Embedder & {
  ready(): boolean
} {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let extractor: Promise<any> | null = null
  let loaded = false

  function load(): Promise<(texts: string[], opts: object) => Promise<{ tolist(): number[][] }>> {
    extractor ??= (async () => {
      const { pipeline, env } = await import('@huggingface/transformers')
      env.cacheDir = options.modelsDir
      env.allowLocalModels = false
      const pipe = await pipeline('feature-extraction', EMBED_MODEL, { dtype: 'q8' })
      loaded = true
      return pipe
    })().catch((error) => {
      extractor = null
      throw error
    })
    return extractor
  }

  return {
    ready: () => loaded,
    async embed(texts, kind) {
      const run = await load()
      // e5 models expect these prefixes.
      const input = texts.map(
        (t) => `${kind === 'query' ? 'query' : 'passage'}: ${t.slice(0, 2000)}`
      )
      const output = await run(input, { pooling: 'mean', normalize: true })
      return output.tolist().map((row) => Float32Array.from(row))
    }
  }
}
