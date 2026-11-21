# How this site is built

Made with Titan117's app builder. Notes for anyone (or any coding agent) changing it.

- **Stack:** React 19, TypeScript, Vite, Tailwind CSS 4. Small shadcn/ui-style components live in `src/components/`; join classes with `cn()` from `src/lib/cn.ts`.
- **Commands:** `npm run dev` (preview), `npm run typecheck`, `npm run build`, `npm test`. All four must pass.
- **SEO is built in:** the title, description, language, canonical link, Open Graph tags, structured data, `robots.txt` and `sitemap.xml` come from `site.config.json` (see `seo.ts`). Change them there, never by hand in `index.html`. Each page gets one `<h1>`, images get `alt` text, and headings go in order.
- **Accessibility and speed:** semantic HTML (`main`, `nav`, `header`, `footer`), labels on form fields, enough colour contrast, no layout that breaks on a phone, images sized and lazy-loaded.
- **Tests:** `src/*.test.tsx` with Vitest; render with `react-dom/server` (no browser needed).
- **Keep `titan117-dev.ts`** in `vite.config.ts`: it lets Titan117's preview pick elements for visual edits, only while previewing.
- **No secrets** in the code or in `.env` files committed to git.
