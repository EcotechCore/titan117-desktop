/** Clickable links in Titan's answers: only https, without the sentence's punctuation. */
import { describe, expect, it } from 'vitest'

import { pullRequestUrl, splitLinks } from '../src/renderer/src/links-lib'

describe('links in answers', () => {
  it('finds https links and leaves the sentence’s punctuation outside', () => {
    expect(splitLinks('The pull request is open: https://github.com/o/r/pull/6.')).toEqual([
      { text: 'The pull request is open: ' },
      { url: 'https://github.com/o/r/pull/6' },
      { text: '.' }
    ])
    expect(splitLinks('(see https://example.com/a)')).toEqual([
      { text: '(see ' },
      { url: 'https://example.com/a' },
      { text: ')' }
    ])
    expect(splitLinks('https://en.wikipedia.org/wiki/Foo_(bar) and more')).toEqual([
      { url: 'https://en.wikipedia.org/wiki/Foo_(bar)' },
      { text: ' and more' }
    ])
  })

  it('leaves http, other schemes and plain text alone', () => {
    expect(splitLinks('http://example.com javascript:alert(1) file:///c:/x')).toEqual([
      { text: 'http://example.com javascript:alert(1) file:///c:/x' }
    ])
    expect(splitLinks('')).toEqual([])
  })

  it('finds a GitHub pull request address', () => {
    expect(pullRequestUrl('Opened the pull request: https://github.com/o/r/pull/12')).toBe(
      'https://github.com/o/r/pull/12'
    )
    expect(pullRequestUrl('https://github.com/o/r/compare/main...x')).toBeNull()
  })
})
