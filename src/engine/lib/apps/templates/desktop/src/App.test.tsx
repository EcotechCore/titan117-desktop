import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import App from './App'
import app from '../app.config.json'

describe('App', () => {
  it('shows one main heading with the app name and a button', () => {
    const html = renderToString(<App />)
    expect(html.match(/<h1/g)).toHaveLength(1)
    expect(html).toContain(app.name)
    expect(html).toContain('<button')
  })
})
