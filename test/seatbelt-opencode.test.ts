/**
 * OpenCode inside Seatbelt on macOS (decisions §55): the profile it gets.
 * It runs only on a Mac; here the profile's text is checked.
 */
import { describe, expect, it } from 'vitest'

import { opencodeSeatbelt } from '../src/engine/lib/code/opencode'

describe('OpenCode’s Seatbelt profile', () => {
  it('writes only in the project and its own folders, hides credentials and the app’s data except its own', () => {
    const profile = opencodeSeatbelt(
      '/Users/u/project',
      '/Users/u/Library/Titan117/code-engine',
      '/Users/u/Library/Titan117/scratch/code-engine',
      ['/Users/u/Library/Titan117', '/Applications/Titan117.app'],
      '/Users/u/Library/Titan117/components/code/opencode/1.19.6/opencode'
    )
    expect(profile).toContain('(deny default)')
    const write = profile.split('\n').find((l) => l.startsWith('(allow file-write*'))!
    expect(write).toContain('(subpath "/Users/u/project")')
    expect(write).toContain('(subpath "/Users/u/Library/Titan117/code-engine")')
    expect(write).not.toContain('(subpath "/Users/u/Library/Titan117")')
    expect(profile).toContain('(require-not (subpath "/Users/u/Library/Titan117"))')
    expect(profile).toMatch(/require-not \(subpath "[^"]*\.ssh"\)/)
    // Its own home, temp folder and programs stay readable (a later rule wins in Seatbelt).
    const read = profile.split('\n').filter((l) => l.startsWith('(allow file-read*'))
    expect(read.at(-1)).toContain('(subpath "/Users/u/Library/Titan117/components/code")')
    expect(profile).toContain('(allow network*)')
  })
})
