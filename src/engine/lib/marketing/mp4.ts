/**
 * A small MP4 writer (ISO/IEC 14496-12 and -14) for the promo video: one
 * H.264 video track and, optionally, one AAC audio track, from samples the
 * browser's own encoders produced. Our own code; no FFmpeg (decisions §62).
 *
 * The file is `ftyp`, `moov`, `mdat`, with the index first so it starts
 * playing at once, and the two tracks interleaved about a second at a time.
 * Frames must arrive in the order they are shown (the encoder is set up
 * without B-frames), so no composition offsets are written.
 */

export interface Mp4Sample {
  data: Uint8Array
  /** A frame that decodes by itself (video). */
  key?: boolean
}

export interface Mp4Video {
  width: number
  height: number
  fps: number
  /** The `avcC` record (WebCodecs' `decoderConfig.description` for H.264). */
  description: Uint8Array
  samples: Mp4Sample[]
}

export interface Mp4Audio {
  sampleRate: number
  channels: number
  /** The AAC AudioSpecificConfig (WebCodecs' `decoderConfig.description`). */
  description: Uint8Array
  /** One AAC frame each: 1024 samples. */
  samples: Mp4Sample[]
}

const AAC_FRAME = 1024
const MOVIE_TIMESCALE = 1000
const MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000]

function u8(...values: number[]): Buffer {
  return Buffer.from(values)
}
function u16(value: number): Buffer {
  const b = Buffer.alloc(2)
  b.writeUInt16BE(value & 0xffff)
  return b
}
function u32(value: number): Buffer {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(value >>> 0)
  return b
}
function zeros(n: number): Buffer {
  return Buffer.alloc(n)
}
function ascii(text: string): Buffer {
  return Buffer.from(text, 'latin1')
}

function box(type: string, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts)
  return Buffer.concat([u32(body.length + 8), ascii(type), body])
}
/** A box with a version and flags. */
function full(type: string, version: number, flags: number, ...parts: Buffer[]): Buffer {
  return box(type, u8(version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255), ...parts)
}

/** An MPEG-4 descriptor: a tag, a length in one to four bytes, and its content. */
function descriptor(tag: number, content: Buffer): Buffer {
  const length: number[] = []
  let n = content.length
  do {
    length.unshift(n & 0x7f)
    n >>= 7
  } while (n > 0)
  for (let i = 0; i < length.length - 1; i++) length[i] |= 0x80
  return Buffer.concat([u8(tag, ...length), content])
}

interface Track {
  id: number
  kind: 'video' | 'audio'
  timescale: number
  /** How long each sample lasts, in the track's timescale. */
  delta: number
  samples: Mp4Sample[]
  sampleEntry: Buffer
  width: number
  height: number
  /** Samples per chunk: about a second. */
  perChunk: number
}

function duration(track: Track, timescale: number): number {
  return Math.round((track.samples.length * track.delta * timescale) / track.timescale)
}

function stbl(track: Track, chunkOffsets: number[]): Buffer {
  const count = track.samples.length
  const chunks = Math.ceil(count / track.perChunk)
  const lastSize = count - (chunks - 1) * track.perChunk
  // Chunks all hold `perChunk` samples, except perhaps the last one.
  const stsc: Buffer[] = [u32(1), u32(Math.min(track.perChunk, count)), u32(1)]
  if (chunks > 1 && lastSize !== track.perChunk) stsc.push(u32(chunks), u32(lastSize), u32(1))
  const keys = track.samples.flatMap((s, i) => (s.key ? [i + 1] : []))
  return box(
    'stbl',
    full('stsd', 0, 0, u32(1), track.sampleEntry),
    full('stts', 0, 0, u32(1), u32(count), u32(track.delta)),
    ...(track.kind === 'video' ? [full('stss', 0, 0, u32(keys.length), ...keys.map(u32))] : []),
    full('stsc', 0, 0, u32(stsc.length / 3), ...stsc),
    full('stsz', 0, 0, u32(0), u32(count), ...track.samples.map((s) => u32(s.data.length))),
    full('stco', 0, 0, u32(chunkOffsets.length), ...chunkOffsets.map(u32))
  )
}

function trak(track: Track, chunkOffsets: number[]): Buffer {
  const video = track.kind === 'video'
  return box(
    'trak',
    full(
      'tkhd',
      0,
      3,
      u32(0),
      u32(0),
      u32(track.id),
      u32(0),
      u32(duration(track, MOVIE_TIMESCALE)),
      zeros(8),
      u16(0),
      u16(0),
      u16(video ? 0 : 0x0100),
      u16(0),
      ...MATRIX.map(u32),
      u32(track.width << 16),
      u32(track.height << 16)
    ),
    box(
      'mdia',
      full(
        'mdhd',
        0,
        0,
        u32(0),
        u32(0),
        u32(track.timescale),
        u32(duration(track, track.timescale)),
        u16(0x55c4), // "und": no language
        u16(0)
      ),
      full(
        'hdlr',
        0,
        0,
        u32(0),
        ascii(video ? 'vide' : 'soun'),
        zeros(12),
        ascii(video ? 'VideoHandler\0' : 'SoundHandler\0')
      ),
      box(
        'minf',
        video ? full('vmhd', 0, 1, zeros(8)) : full('smhd', 0, 0, zeros(4)),
        box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1))),
        stbl(track, chunkOffsets)
      )
    )
  )
}

function videoEntry(video: Mp4Video): Buffer {
  return box(
    'avc1',
    zeros(6),
    u16(1),
    zeros(16),
    u16(video.width),
    u16(video.height),
    u32(0x00480000),
    u32(0x00480000),
    u32(0),
    u16(1),
    zeros(32),
    u16(0x0018),
    u16(0xffff),
    box('avcC', Buffer.from(video.description))
  )
}

function audioEntry(audio: Mp4Audio): Buffer {
  const decoderConfig = descriptor(
    0x04,
    Buffer.concat([
      u8(0x40), // MPEG-4 audio
      u8(0x15), // an audio stream
      zeros(3),
      u32(0),
      u32(0),
      descriptor(0x05, Buffer.from(audio.description))
    ])
  )
  const es = descriptor(
    0x03,
    Buffer.concat([u16(0), u8(0), decoderConfig, descriptor(0x06, u8(0x02))])
  )
  return box(
    'mp4a',
    zeros(6),
    u16(1),
    zeros(8),
    u16(audio.channels),
    u16(16),
    zeros(4),
    u32(audio.sampleRate << 16),
    full('esds', 0, 0, es)
  )
}

/** The whole MP4 file. Throws when there is nothing to write. */
export function writeMp4(video: Mp4Video, audio?: Mp4Audio | null): Buffer {
  if (!video.samples.length) throw new Error('The video has no frames.')
  if (!video.samples[0].key) throw new Error('The video must start with a key frame.')
  if (video.description.length < 7) throw new Error('The video’s H.264 settings are missing.')
  if (audio && audio.sampleRate > 0xffff) throw new Error('That sample rate is too high for MP4.')

  const tracks: Track[] = [
    {
      id: 1,
      kind: 'video',
      timescale: video.fps * 1000,
      delta: 1000,
      samples: video.samples,
      sampleEntry: videoEntry(video),
      width: video.width,
      height: video.height,
      perChunk: video.fps
    }
  ]
  if (audio && audio.samples.length)
    tracks.push({
      id: 2,
      kind: 'audio',
      timescale: audio.sampleRate,
      delta: AAC_FRAME,
      samples: audio.samples,
      sampleEntry: audioEntry(audio),
      width: 0,
      height: 0,
      perChunk: Math.max(1, Math.round(audio.sampleRate / AAC_FRAME))
    })

  // The order of the data: one chunk of each track in turn, about a second each.
  const order: { track: number; from: number; to: number }[] = []
  const chunkCount = tracks.map((t) => Math.ceil(t.samples.length / t.perChunk))
  for (let c = 0; c < Math.max(...chunkCount); c++)
    tracks.forEach((t, i) => {
      if (c < chunkCount[i])
        order.push({
          track: i,
          from: c * t.perChunk,
          to: Math.min((c + 1) * t.perChunk, t.samples.length)
        })
    })

  const ftyp = box('ftyp', ascii('isom'), u32(0x200), ascii('isomiso2avc1mp41'))
  const movieDuration = Math.max(...tracks.map((t) => duration(t, MOVIE_TIMESCALE)))
  const moov = (offsets: number[][]): Buffer =>
    box(
      'moov',
      full(
        'mvhd',
        0,
        0,
        u32(0),
        u32(0),
        u32(MOVIE_TIMESCALE),
        u32(movieDuration),
        u32(0x00010000),
        u16(0x0100),
        zeros(10),
        ...MATRIX.map(u32),
        zeros(24),
        u32(tracks.length + 1)
      ),
      ...tracks.map((t, i) => trak(t, offsets[i]))
    )

  // The index's size doesn't depend on the offsets' values, so it is built twice.
  const placeholder = tracks.map((_, i) => new Array<number>(chunkCount[i]).fill(0))
  let at = ftyp.length + moov(placeholder).length + 8
  const offsets: number[][] = tracks.map(() => [])
  const data: Uint8Array[] = []
  for (const chunk of order) {
    offsets[chunk.track].push(at)
    for (const sample of tracks[chunk.track].samples.slice(chunk.from, chunk.to)) {
      data.push(sample.data)
      at += sample.data.length
    }
  }
  const mdatSize = at - (ftyp.length + moov(placeholder).length)
  if (at > 0xffffffff) throw new Error('The video is too large for this writer (over 4 GB).')
  return Buffer.concat([ftyp, moov(offsets), u32(mdatSize), ascii('mdat'), ...data])
}
