# servegate Docs Portal

Astro Starlight–powered documentation portal for [servegate](https://github.com/Jhonata-Matias/servegate). Replaces the prior single-page marketing landing at `web/landing/` and lives at `deploy-lp-one.vercel.app/`.

## File layout

```
web/docs/
├── astro.config.mjs                ← Starlight config + sidebar IA
├── package.json                    ← deps: astro, @astrojs/starlight, sharp
├── tsconfig.json
├── public/                         ← static assets served as-is
└── src/
    ├── assets/                     ← brand assets (logo, favicon)
    ├── content/
    │   ├── config.ts               ← Starlight content collection schema
    │   └── docs/
    │       ├── index.mdx           ← Welcome (custom card-grid 3×2)
    │       ├── quickstart.mdx
    │       ├── api.mdx             ← API Reference (POST /jobs, GET /jobs/{id}, POST /v1/generate)
    │       ├── sdk.mdx             ← TypeScript SDK (@jhonata-matias/flux-client)
    │       └── errors.mdx
    └── styles/
        └── theme.css               ← brand token overrides preserving landing palette
```

## Local development

```bash
cd web/docs
pnpm install
pnpm dev          # http://localhost:4321
```

## Build & preview

```bash
pnpm build        # outputs static site to dist/
pnpm preview      # serve dist/ locally
```

Build artifacts:

- `dist/index.html` (Welcome) and one `<page>/index.html` per slug
- `dist/pagefind/` (search index — built automatically by Starlight)
- `dist/sitemap-index.xml`

## Deploy to Vercel

1. **Vercel project setting:** **Root Directory** = `web/docs/` (NOT `web/landing/` — that path is archived).
2. Astro auto-detected. Build command `pnpm build`, output `dist/`. No `vercel.json` needed.
3. PR previews work out of the box once the root is set.

> **Cutover history:** Initial cutover from `web/landing/` → `web/docs/` happens with the Story 2.9 PR merge. Old landing preserved at `web/_archive/landing-pre-docs-2026-04-29/` for emergency rollback.

## Theme

Dark-only at V1. Palette extracted verbatim from the prior `web/landing/index.html` Tailwind config:

| Token | Value | Notes |
|---|---|---|
| `--sl-color-bg` | `#050505` | obsidian — page background |
| `--sl-color-bg-inline-code` | `#1c1c1c` | charcoal — inline code surface |
| `--sl-color-accent` | `#1d7fe5` | brand blue (NOT teal) |
| `--sl-color-accent-high` | `#4da3ff` | accent hover/active |
| `--sl-font` | Inter (system fallback) | sans-serif |
| `--sl-font-mono` | JetBrains Mono | monospace |

Light theme is V2 backlog (see `docs/stories/backlog.md` ENH-2.9 follow-ups).

## Search

Pagefind ships with Starlight; no API key, fully static. Indexed at build time.

## Contributing

- Content lives in `src/content/docs/*.mdx`. Add a sidebar entry in `astro.config.mjs`.
- Use Starlight components for consistency: `<Card>`, `<CardGrid>`, `<Tabs>`, `<TabItem>`, `<Aside>`, `<Badge>`, `<LinkCard>`.
- Run `pnpm build` before committing — broken links fail the build.

## See also

- [Story 2.9 spec](../../docs/design/landing-docs-portal-refactor.md)
- [Story 2.9 file](../../docs/stories/2.9.docs-portal-refactor.story.md)
- [Astro Starlight docs](https://starlight.astro.build/)
