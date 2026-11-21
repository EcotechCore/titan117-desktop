import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import app from '../app.json'
import App from './App'

describe('App', () => {
  it('shows the app name as a heading and a button', () => {
    const html = renderToString(<App />)
    expect(html).toContain(app.expo.name)
    expect(html).toContain('role="heading"')
    expect(html).toContain('role="button"')
  })
})
