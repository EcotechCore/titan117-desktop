/**
 * Visual edit in Titan117's preview (only while previewing, never in a
 * build): when Titan117 turns it on, hovering outlines an element and a
 * click sends a short description of it (tag, text, classes, where it is)
 * to the Titan117 window, which asks for the change. Nothing leaves the
 * laptop; a built site doesn't contain it.
 */
import type { Plugin } from 'vite'

const PICKER = `(() => {
  let on = false
  let parentOrigin = null
  let box = null
  const outline = (el) => {
    if (!box) {
      box = document.createElement('div')
      box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #ff6347;background:rgba(255,99,71,.08);border-radius:3px'
      document.documentElement.appendChild(box)
    }
    const r = el.getBoundingClientRect()
    box.style.left = r.left + 'px'
    box.style.top = r.top + 'px'
    box.style.width = r.width + 'px'
    box.style.height = r.height + 'px'
    box.style.display = 'block'
  }
  const clear = () => { if (box) box.style.display = 'none' }
  const pathOf = (el) => {
    const parts = []
    for (let n = el; n && n.nodeType === 1 && n !== document.body && parts.length < 8; n = n.parentElement) {
      let part = n.tagName.toLowerCase()
      if (n.id) part += '#' + n.id
      const same = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName) : []
      if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(n) + 1) + ')'
      parts.unshift(part)
    }
    return parts.join(' > ')
  }
  window.addEventListener('message', (e) => {
    if (e.source !== window.parent || !e.data || e.data.type !== 'titan117:pick') return
    on = !!e.data.on
    parentOrigin = e.origin
    document.documentElement.style.cursor = on ? 'crosshair' : ''
    if (!on) clear()
  })
  document.addEventListener('mouseover', (e) => { if (on && e.target instanceof Element) outline(e.target) }, true)
  document.addEventListener('click', (e) => {
    if (!on || !(e.target instanceof Element) || !parentOrigin) return
    e.preventDefault()
    e.stopPropagation()
    const el = e.target
    window.parent.postMessage({
      type: 'titan117:picked',
      element: {
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 200),
        classes: typeof el.className === 'string' ? el.className.slice(0, 300) : '',
        path: pathOf(el),
        html: el.outerHTML.slice(0, 600),
        page: location.pathname
      }
    }, parentOrigin)
  }, true)
})()`

export function titan117Dev(): Plugin {
  return {
    name: 'titan117-visual-edit',
    apply: 'serve',
    transformIndexHtml: () => [{ tag: 'script', children: PICKER, injectTo: 'body' }]
  }
}
