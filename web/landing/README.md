# servegate API Reference — Landing Page

Standalone single-page HTML landing rendering the servegate API reference (async submit/poll contract). Deployed to Vercel as the public "docs front door".

## File layout

```
web/landing/
├── index.html    ← canonical source (git-tracked)
├── README.md     ← this file
├── .gitignore    ← excludes .vercel/
└── .vercel/      ← Vercel project link (NOT tracked)
```

**No build step.** Single HTML file using Tailwind CDN + iconify-icon. Edit `index.html` directly; no compilation.

## Deploy to Vercel

### Prerequisites

- Vercel CLI: `npm i -g vercel` (or use `npx vercel`)
- `VERCEL_TOKEN` in `gateway/.env` (already present)

### Production deploy

```bash
cd web/landing
VERCEL_TOKEN="$(awk -F= '/^VERCEL_TOKEN=/ {sub(/^VERCEL_TOKEN=/,""); print}' ../../gateway/.env)" \
  vercel deploy --prod --yes --token="$VERCEL_TOKEN"
```

The project is already linked via `.vercel/project.json` to:

- `projectId`: `prj_3fWuhJdefuVcwh4C3AUhgvYFCgMJ`
- `orgId`: `team_6wzyrhYhBkphHCsk9Xu5g9p9`
- `projectName`: `.deploy-lp` (historical; can be renamed via `vercel project rename` if desired)

### Preview deploy (unique URL, not production)

```bash
cd web/landing
vercel deploy --yes --token="$VERCEL_TOKEN"
```

### Local preview (no deploy)

```bash
cd web/landing
python3 -m http.server 8080
# open http://localhost:8080/index.html
```

Or use any static server (`live-server`, VS Code Live Server extension, etc.).

## Content scope

The landing covers:

- **Hero:** status badges, CTAs to quickstart + GitHub repo
- **Quickstart:** 2-step async submit/poll curl example
- **Endpoints reference:** `POST /jobs` and `GET /jobs/{job_id}` full schemas
- **Errors & SDK:** error codes (401/429/502/504/400/500) + TypeScript SDK error classes (`TimeoutError` with `.cause` discriminator, `RateLimitError`, `AuthError`, `NetworkError`, `ValidationError`)
- **Resources:** repo, release, migration guide, dev onboarding, CHANGELOG, ADR-0002

## Updating content after gateway/SDK changes

When gateway contract or SDK error taxonomy changes:

1. Update `index.html` directly (this is plain HTML — no i18n or template layer)
2. Test render locally (see "Local preview" above)
3. Deploy via `vercel deploy --prod` (see "Production deploy")
4. Verify live URL reflects changes

## Security notes

- **No secrets in HTML:** `GATEWAY_API_KEY` is user-supplied in examples (`$GATEWAY_API_KEY` placeholder)
- **CDN dependencies:** Tailwind + iconify loaded from `cdn.tailwindcss.com` and `code.iconify.design` — trust chain inherited from those CDNs
- **`.vercel/` folder not tracked:** per Vercel documentation; contains project link metadata specific to this local clone

## Related

- [Root README](../../README.md) — project overview
- [API Reference markdown](../../docs/api/reference.md) — raw HTTP contract (source of truth)
- [Migration Guide v0.1 → v0.2](../../docs/api/migration-async.md) — upgrade path from legacy sync contract
