/**
 * SEO built in: the page's title, description, language, canonical link,
 * Open Graph and Twitter tags and structured data (schema.org) come from
 * site.config.json, and every build writes robots.txt and, once the site's
 * address is set, sitemap.xml. Edit site.config.json, not the tags.
 */
import { readFileSync } from 'node:fs'
import type { Plugin } from 'vite'

interface SitePage {
  path: string
  title: string
  description: string
}

interface SiteConfig {
  title: string
  description: string
  lang: string
  /** The published address, e.g. https://example.com (no trailing slash). */
  url: string
  /** An image for link previews: a full address or a path under public/ (1200 × 630 PNG). */
  image: string
  organization: string
  pages: SitePage[]
}

const escape = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

export function readSiteConfig(file = 'site.config.json'): SiteConfig {
  return JSON.parse(readFileSync(file, 'utf8')) as SiteConfig
}

export function headTags(site: SiteConfig): string {
  const base = site.url.replace(/\/$/, '')
  const image = site.image ? (/^https?:/.test(site.image) ? site.image : `${base}${site.image}`) : ''
  const structured = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', name: site.title, description: site.description, ...(base ? { url: base } : {}) },
      { '@type': 'Organization', name: site.organization, ...(base ? { url: base } : {}) }
    ]
  }
  return [
    `<title>${escape(site.title)}</title>`,
    `<meta name="description" content="${escape(site.description)}" />`,
    base ? `<link rel="canonical" href="${escape(base)}/" />` : '',
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${escape(site.title)}" />`,
    `<meta property="og:description" content="${escape(site.description)}" />`,
    base ? `<meta property="og:url" content="${escape(base)}/" />` : '',
    image ? `<meta property="og:image" content="${escape(image)}" />` : '',
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}" />`,
    `<script type="application/ld+json">${JSON.stringify(structured).replace(/</g, '\\u003c')}</script>`
  ]
    .filter(Boolean)
    .join('\n    ')
}

export function robotsTxt(site: SiteConfig): string {
  const base = site.url.replace(/\/$/, '')
  return `User-agent: *\nAllow: /\n${base ? `\nSitemap: ${base}/sitemap.xml\n` : ''}`
}

export function sitemapXml(site: SiteConfig): string {
  const base = site.url.replace(/\/$/, '')
  const urls = site.pages
    .map((page) => `  <url><loc>${escape(base + page.path)}</loc></url>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
}

export function seo(): Plugin {
  return {
    name: 'site-seo',
    transformIndexHtml(html) {
      const site = readSiteConfig()
      return html
        .replace(/<html[^>]*>/, `<html lang="${escape(site.lang || 'en')}">`)
        .replace('</head>', `    ${headTags(site)}\n  </head>`)
    },
    generateBundle() {
      const site = readSiteConfig()
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robotsTxt(site) })
      // Search engines need full addresses: the sitemap waits until the site's address is set.
      if (site.url)
        this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemapXml(site) })
    }
  }
}
