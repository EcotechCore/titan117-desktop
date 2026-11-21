/**
 * Starting points per kind of business (6.8) and the brand kit applied to a
 * new app (6.8 with 15.1, decisions §56.17). A starter is guidance the
 * coding engine follows (sections and pages), on the same code template; the
 * brand kit sets the app's colours, font, tone of voice and logo.
 */

export const STARTERS = [
  {
    id: 'blank',
    label: 'Blank',
    description: 'Just the template; you say what to build.',
    sections: [],
    pages: []
  },
  {
    id: 'restaurant',
    label: 'Restaurant, café or bakery',
    description: 'Menu with prices, opening hours, location and reservations by phone.',
    sections: [
      'a welcome with what makes the place special',
      'the menu or products, with prices',
      'opening hours',
      'address with directions in words',
      'how to reserve or order (phone, email)'
    ],
    pages: [{ path: '/', title: 'Home' }]
  },
  {
    id: 'shop',
    label: 'Shop (a catalogue)',
    description: 'Products with photos and prices; customers order by phone or email.',
    sections: [
      'a welcome',
      'product categories',
      'products with name, price and a short description',
      'how to order and delivery',
      'contact'
    ],
    pages: [
      { path: '/', title: 'Home' },
      { path: '/products', title: 'Products' },
      { path: '/contact', title: 'Contact' }
    ]
  },
  {
    id: 'services',
    label: 'Services (trades, consultants, clinics)',
    description: 'What you offer, prices or packages, trust, and how to book.',
    sections: [
      'a clear promise in one sentence',
      'the services with short descriptions and prices or "from" prices',
      'why choose us (experience, certificates, reviews the user provides)',
      'the area served',
      'how to book (phone, email) and a frequently asked questions list'
    ],
    pages: [
      { path: '/', title: 'Home' },
      { path: '/services', title: 'Services' },
      { path: '/contact', title: 'Contact' }
    ]
  },
  {
    id: 'portfolio',
    label: 'Portfolio',
    description: 'Your work, about you, and how to hire you.',
    sections: ['a short introduction', 'selected work with a line each', 'about', 'contact'],
    pages: [
      { path: '/', title: 'Home' },
      { path: '/work', title: 'Work' },
      { path: '/about', title: 'About' }
    ]
  },
  {
    id: 'landing',
    label: 'Landing page',
    description: 'One product, event or offer, and one thing to do.',
    sections: [
      'a headline and one call to action',
      'three benefits',
      'how it works in three steps',
      'questions and answers',
      'the call to action again'
    ],
    pages: [{ path: '/', title: 'Home' }]
  }
] as const

export type StarterId = (typeof STARTERS)[number]['id']

export const FONTS = {
  system: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  rounded: "ui-rounded, 'SF Pro Rounded', 'Segoe UI', system-ui, sans-serif",
  mono: "ui-monospace, 'Cascadia Code', Menlo, Consolas, monospace"
} as const

export interface BrandKit {
  /** Main colour for buttons and links, `#rrggbb`. */
  primary: string
  /** A second colour for highlights, `#rrggbb`. */
  accent: string
  font: keyof typeof FONTS
  /** How the company talks, in a few words ("warm and plain", "formal"). */
  tone: string
  /** A logo file inside the allowed folders (PNG, SVG, JPEG or WebP), or empty. */
  logo: string
}

export const DEFAULT_BRAND: BrandKit = {
  primary: '#ff6347',
  accent: '#1f2937',
  font: 'system',
  tone: '',
  logo: ''
}

const HEX = /^#[0-9a-fA-F]{6}$/

/** A brand kit with every field checked; anything odd falls back to the default. */
export function cleanBrand(
  input: Partial<Record<keyof BrandKit, unknown>> | null | undefined
): BrandKit {
  const text = (v: unknown, max: number): string =>
    typeof v === 'string' ? v.trim().slice(0, max) : ''
  return {
    primary:
      typeof input?.primary === 'string' && HEX.test(input.primary)
        ? input.primary
        : DEFAULT_BRAND.primary,
    accent:
      typeof input?.accent === 'string' && HEX.test(input.accent)
        ? input.accent
        : DEFAULT_BRAND.accent,
    font:
      typeof input?.font === 'string' && input.font in FONTS
        ? (input.font as BrandKit['font'])
        : 'system',
    tone: text(input?.tone, 200).replace(/[\r\n]+/g, ' '),
    logo: text(input?.logo, 1000)
  }
}

export const LOGO_TYPES: Record<string, string> = {
  '.png': 'png',
  '.svg': 'svg',
  '.jpg': 'jpg',
  '.jpeg': 'jpg',
  '.webp': 'webp'
}

/** The stylesheet's theme block with the brand's colours and font. */
export function themeCss(brand: BrandKit): string {
  return [
    '@theme {',
    `  --color-brand: ${brand.primary};`,
    `  --color-accent: ${brand.accent};`,
    `  --font-sans: ${FONTS[brand.font]};`,
    '}'
  ].join('\n')
}

/** The part of AGENTS.md that tells a coding agent about this site's starter and brand. */
export function agentNotes(starter: StarterId, brand: BrandKit, logoFile: string | null): string {
  const s = STARTERS.find((x) => x.id === starter) ?? STARTERS[0]
  const lines = ['', '## This site', '']
  if (s.id !== 'blank') {
    lines.push(`- **Kind of site:** ${s.label}. ${s.description}`)
    lines.push(`- **Sections to have:** ${s.sections.join('; ')}.`)
    if (s.pages.length > 1)
      lines.push(
        `- **Pages:** ${s.pages.map((p) => `${p.title} (\`${p.path}\`)`).join(', ')}. Add each to \`site.config.json\` "pages".`
      )
  }
  lines.push(
    `- **Brand:** the main colour is \`${brand.primary}\` (\`bg-brand\`, \`text-brand\`), the second \`${brand.accent}\` (\`bg-accent\`, \`text-accent\`); the font is set in \`src/index.css\`. Keep text readable on them (contrast 4.5:1).`
  )
  if (brand.tone) lines.push(`- **Tone of voice:** ${brand.tone}.`)
  if (logoFile) lines.push(`- **Logo:** \`public/${logoFile}\`, with alt text naming the company.`)
  return lines.join('\n') + '\n'
}
