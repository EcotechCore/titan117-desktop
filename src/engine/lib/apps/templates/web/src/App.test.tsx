import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import App from './App'
import site from '../site.config.json'

describe('App', () => {
  it('shows one main heading with the site title', () => {
    const html = renderToString(<App />)
    expect(html.match(/<h1/g)).toHaveLength(1)
    expect(html).toContain(site.title)
  })
})
