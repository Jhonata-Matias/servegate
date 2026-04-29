# Landing → Docs Portal Refactor — Implementation Spec

**Owner (design):** @ux-design-expert (Uma)
**Owner (impl):** @dev (Dex)
**Date:** 2026-04-29
**Reference:** RunPod docs (https://docs.runpod.io) — captured screenshot
**Trigger:** PR #15 multi-image i2i merged; current `web/landing/index.html` (995 LOC marketing single-page) is undersized for the growing API surface.

---

## Locked decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Replace vs coexist with current landing | **Replace.** `deploy-lp-one.vercel.app/` becomes docs portal. Marketing landing archived. |
| 2 | Stack | **Astro Starlight.** MDX content, built-in dark/light, Pagefind search, Shiki code, Vercel-deployable. |
| 3 | Welcome layout | **Custom card-grid 3×2** replicating RunPod ref (not Starlight `splash` template). |
| 4 | Migration scope V1 | **Lean (5 pages):** Welcome · Quickstart · API Reference · SDK · Errors. Expand later. |
| 5 | Folder | **`web/docs/`** (consistency with `web/landing/`). |
| 6 | Theme | **Dark-only** at V1. Light theme deferred. |
| 7 | Brand identity | **Preserve.** Same charcoal+teal palette, Geist font family, accent color. No tonal redesign. |

---

## Information Architecture (sidebar)

```
servegate docs
├─ Welcome (index)                      ← custom card-grid homepage
├─ Get started
│  └─ Quickstart                        ← curl T2I + i2i in 3 steps
├─ API Reference                        ← single page V1; split into sub-pages V2
│  • POST /jobs (T2I)
│  • POST /jobs (i2i)
│  • POST /jobs (multi-image i2i)       ⭐ NEW (PR #15)
│  • GET /jobs/{id}
│  • Rate limits
├─ SDK (TypeScript)                     ← single page V1
│  • Installation (@jhonata-matias/flux-client@0.4.0)
│  • generate()
│  • edit() — single image
│  • edit() — multi-image               ⭐ NEW (PR #15)
│  • Error classes
└─ Errors                               ← single page V1
   • HTTP status (401/429/502/504)
   • i2i_validation (incl. field: 'image2' discriminator)
```

**5 pages, 3-level hierarchy.** V2 expansion plan: split API Reference and SDK into dedicated sub-pages; add Authentication/Concepts/Releases/Resources.

---

## Design tokens (Starlight CSS overrides)

Map current landing palette to Starlight CSS variables in `web/docs/src/styles/theme.css`:

```css
:root {
  /* Surfaces — match current landing charcoal */
  --sl-color-bg: #0a0a0a;             /* primary background */
  --sl-color-bg-nav: #0a0a0a;
  --sl-color-bg-sidebar: #0a0a0a;
  --sl-color-bg-inline-code: #171717; /* zinc-900 */
  --sl-color-hairline: rgba(255,255,255,0.10);
  --sl-color-hairline-light: rgba(255,255,255,0.05);

  /* Text */
  --sl-color-white: #ffffff;
  --sl-color-gray-1: #fafafa;
  --sl-color-gray-2: #d4d4d4;        /* zinc-300 — body */
  --sl-color-gray-3: #a3a3a3;        /* zinc-400 — muted */
  --sl-color-gray-4: #737373;        /* zinc-500 */
  --sl-color-gray-5: #525252;
  --sl-color-gray-6: #262626;

  /* Accent — preserve current teal/green */
  --sl-color-accent: #14b8a6;        /* teal-500, adjust if landing uses different */
  --sl-color-accent-high: #5eead4;   /* teal-300 — hover/active */
  --sl-color-accent-low: #134e4a;    /* teal-900 — subtle bg */
}

/* Typography — preserve Geist family from current landing */
:root {
  --sl-font: 'Geist', system-ui, sans-serif;
  --sl-font-mono: 'Geist Mono', ui-monospace, monospace;
}
```

> **Note for @dev:** verify exact accent hex by reading current `web/landing/index.html` Tailwind config or computed style of `.text-accent` class. Replace teal placeholder if different.

---

## Implementation phases

### Phase 1 — Setup (~2h)

```bash
cd web/
pnpm create astro@latest docs --template starlight --no-install --no-git --typescript strict
cd docs
pnpm install
pnpm install -D @astrojs/check
```

Configure `astro.config.mjs`:

```js
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://deploy-lp-one.vercel.app',
  integrations: [
    starlight({
      title: 'servegate',
      logo: { src: './src/assets/logo.svg', replacesTitle: false },
      customCss: ['./src/styles/theme.css'],
      social: { github: 'https://github.com/Jhonata-Matias/servegate' },
      sidebar: [
        { label: 'Welcome', link: '/' },
        { label: 'Get started', items: [{ label: 'Quickstart', link: '/quickstart/' }] },
        { label: 'API Reference', link: '/api/' },
        { label: 'SDK (TypeScript)', link: '/sdk/' },
        { label: 'Errors', link: '/errors/' },
      ],
      components: {
        // V1: keep defaults; V2 customize Hero/PageTitle if needed
      },
      defaultLocale: 'en',  // Welcome page mixes pt/en — V1 stays as-is
    }),
  ],
});
```

Vercel: Astro is auto-detected. No `vercel.json` needed unless setting build root. **Action item:** in Vercel project settings, change root from `web/landing/` to `web/docs/` at cutover (Phase 4).

### Phase 2 — Content migration (~5h)

Source: `web/landing/index.html` line ranges (per current file, post-PR #15 update spec).

| Target file | Source section | Notes |
|---|---|---|
| `src/content/docs/index.mdx` | Hero (lines 150-210) | **Custom layout.** Card-grid 3×2 replicating RunPod. Use Starlight `<CardGrid>` + `<Card>` from `@astrojs/starlight/components`. Cards: Quickstart · Authentication (placeholder) · API Reference · SDK · Errors · Releases (placeholder linking to GitHub Releases). |
| `src/content/docs/quickstart.mdx` | Quickstart curl examples (lines ~250-380) | T2I curl + i2i 1-image curl + i2i 2-image curl (NEW). 3 tabs via Starlight `<Tabs>`. |
| `src/content/docs/api.mdx` | API endpoints + tables (lines 380-660) | Includes new row `input_image_b64_2` (optional, second reference image). Polling section unchanged. |
| `src/content/docs/sdk.mdx` | SDK section (lines 670-710) | Bump to `@0.4.0`. Add `edit()` multi-image example. Document `field: 'image2'` discriminator. |
| `src/content/docs/errors.mdx` | i2i_validation + HTTP errors (lines 660-705 + scattered) | Consolidate. Document multi-image error variants. |

**Front-matter template** (each `.mdx`):

```yaml
---
title: <Page Title>
description: <One-line for SEO + sidebar>
---
```

### Phase 3 — Polish (~2h)

- **Welcome card-grid:** custom MDX in `index.mdx` mimicking RunPod 3×2 layout. Each card = icon + title + 1-line description + link.
- **Search:** Starlight ships Pagefind by default. Verify build output indexes correctly.
- **Copy page button:** Starlight has native `<TabItem>` copy; for whole-page copy, install `starlight-copy-page` plugin OR add custom component (V2).
- **Edit on GitHub:** add `editLink: { baseUrl: 'https://github.com/Jhonata-Matias/servegate/edit/main/web/docs/' }` to Starlight config.
- **404 page:** Starlight provides default; customize copy.

### Phase 4 — Cutover (~1h)

1. Vercel preview deploy (push branch, get preview URL, validate all 5 pages).
2. Validate: search works · sidebar links correct · code blocks highlight · multi-image i2i prominent.
3. In Vercel project settings, change **Root Directory** from `web/landing/` → `web/docs/`.
4. Promote preview → production.
5. Move `web/landing/` → `web/_archive/landing-pre-docs-2026-04-29/` (preserve git history; user can purge later).
6. Update `web/docs/README.md` (replaces `web/landing/README.md`).
7. Update repo root `README.md` if it links to docs URL.

---

## Acceptance criteria

- [ ] All 5 pages render with charcoal+teal theme matching current landing visual identity.
- [ ] Sidebar navigation matches IA above; active state highlights current page.
- [ ] Welcome card-grid renders 6 cards (3×2 on desktop, stacked on mobile).
- [ ] Multi-image i2i is documented in API · SDK · Errors (3 places).
- [ ] SDK references show `@jhonata-matias/flux-client@0.4.0`.
- [ ] Pagefind search returns results for "multi-image", "image2", "polling".
- [ ] Lighthouse score ≥ 90 (Performance · Accessibility · Best Practices · SEO).
- [ ] WCAG AA contrast on all text against charcoal background.
- [ ] No broken links (run `pnpm dlx linkinator dist/` post-build).
- [ ] Vercel preview deploy URL shared for review before cutover.

---

## Out of scope (V2 backlog)

- Light theme toggle (currently dark-only).
- Versioned docs (e.g., `/v0.3/api`). For now, single canonical version.
- Authentication, Concepts, Releases, Resources pages.
- API Reference split into per-endpoint sub-pages.
- ADR index page (link from Resources placeholder for now).
- i18n (pt-BR / en parity). Current landing has mixed pt-BR; V1 keeps as-is.
- Custom illustration / hero animation.
- Algolia DocSearch (Pagefind sufficient for V1).

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Vercel root change breaks production briefly during cutover | Test preview thoroughly. Keep `web/landing/` deployable via env var override for emergency rollback. |
| Geist font availability (currently CDN?) | Verify font source in current landing; if Tailwind-bundled, replicate via `src/fonts/`. |
| Tailwind utilities used in current landing don't translate to MDX cleanly | Convert custom blocks to Starlight components (`<Card>`, `<Tabs>`, `<Aside>`, `<LinkCard>`). |
| Search index size on free Vercel | Pagefind is static, no API needed. Negligible. |
| Multi-image i2i examples need real test images | Use HuggingFace public dataset URLs OR base64 placeholders in code blocks. |

---

## Hand-off checklist for @dev

1. Read this spec end-to-end.
2. Read `web/landing/index.html` to extract: exact accent hex, font references, content lines per migration table.
3. Branch: `git checkout -b feat/docs-portal-starlight`.
4. Execute Phase 1 → 2 → 3 → 4 sequentially. Commit per phase.
5. Open draft PR after Phase 2 for content review (Uma + user).
6. Promote PR after Phase 4 cutover validation.
7. Coordinate with @devops for Vercel root directory change.
