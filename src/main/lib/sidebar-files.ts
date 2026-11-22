/**
 * Serving a sidebar app (6.2; decisions §58): `titan117://<id>.apps/…`
 * gives the files of the app's checked build, copied by the engine into
 * `sidebar-apps/<id>/builds/<version>`, and nothing else. Every response
 * carries a content security policy with no network at all: the app talks
 * to Titan117 only through the window's message bridge. The window shows
 * it in a frame sandboxed without `allow-same-origin`, so it has no
 * cookies, storage or access to the window.
 */
import { readFileSync } from 'node:fs'
import { extname, join, normalize, sep } from 'node:path'

export const SIDEBAR_HOST = /^([a-z0-9][a-z0-9-]{0,59})\.apps$/
const BUILD = /^[0-9a-f]{7,40}$/

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml'
}

/** The app's id from a request's host, or null when it isn't a sidebar app's address. */
export function sidebarAppOf(host: string): string | null {
  return SIDEBAR_HOST.exec(host)?.[1] ?? null
}

/** No network, no frames, no forms sent anywhere: only the app's own files. */
export function sidebarCsp(id: string): string {
  const self = `titan117://${id}.apps`
  return [
    "default-src 'none'",
    `script-src ${self}`,
    `style-src ${self} 'unsafe-inline'`,
    `img-src ${self} data: blob:`,
    `font-src ${self} data:`,
    `media-src ${self} data: blob:`,
    "connect-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ')
}

/**
 * The file for a request, inside the app's current build only; a path
 * without an extension gets the app's index.html (its own pages).
 */
export function sidebarFile(root: string, id: string, pathname: string): string | null {
  let build: string
  try {
    build = (JSON.parse(readFileSync(join(root, id, 'current.json'), 'utf8')) as { build?: string })
      .build as string
  } catch {
    return null
  }
  if (typeof build !== 'string' || !BUILD.test(build)) return null
  const base = join(root, id, 'builds', build)
  let path: string
  try {
    path = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (path.includes('\0')) return null
  if (path === '/' || !extname(path)) path = '/index.html'
  const file = normalize(join(base, path))
  return file.startsWith(base + sep) ? file : null
}

/**
 * A sidebar app's frame may load its own address and move within it, never
 * to another app or anywhere else (the window's frame rules refuse the rest).
 */
export function isSidebarNavigation(target: string, current: string): boolean {
  let id: string | null
  try {
    const url = new URL(target)
    if (url.protocol !== 'titan117:') return false
    id = sidebarAppOf(url.host)
  } catch {
    return false
  }
  if (!id) return false
  if (!current || current === 'about:blank') return true
  try {
    const from = new URL(current)
    return from.protocol === 'titan117:' && sidebarAppOf(from.host) === id
  } catch {
    return false
  }
}

export function contentType(file: string): string {
  return TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream'
}

/** A response for `titan117://<id>.apps/<path>`. */
export function sidebarResponse(root: string, id: string, pathname: string): Response {
  const headers = {
    'content-security-policy': sidebarCsp(id),
    'x-content-type-options': 'nosniff',
    // The frame's origin is opaque (sandboxed): its own module scripts are cross-origin to it.
    'access-control-allow-origin': '*',
    'cache-control': 'no-store'
  }
  const file = sidebarFile(root, id, pathname)
  if (!file) return new Response('Not found', { status: 404, headers })
  try {
    return new Response(readFileSync(file), {
      status: 200,
      headers: { ...headers, 'content-type': contentType(file) }
    })
  } catch {
    return new Response('Not found', { status: 404, headers })
  }
}
