# Developer Onboarding — servegate FLUX API (Alpha)  *(formerly gemma4)*

> 🌐 **English** | [Português (Brasil)](./dev-onboarding.pt-BR.md)

**Status:** Alpha (invite-only)
**SDK:** `@jhonata-matias/flux-client@0.1.x` (GitHub Packages, private)
**Gateway:** `https://gemma4-gateway.jhonata-matias.workers.dev` *(live since 2026-04-21)*

Get started generating FLUX images via authenticated API in ~15 minutes.

## Before you start

1. **Read the [Terms of Use](../legal/TERMS.md)** — especially the acceptable-use policy
2. **Read the [Privacy Statement](../legal/PRIVACY.md)** — understand what we log and what we don't
3. **Agree with the alpha status** — no SLA, breaking changes expected, SDK v0.x

If those don't work for your use case, please don't request access now; wait for beta or fork the repo.

## Step 1 — Request access (API key)

Access is invite-only during alpha. To request a GATEWAY_API_KEY:

### Option A: GitHub issue (preferred)

1. Go to https://github.com/Jhonata-Matias/servegate/issues/new/choose
2. Select **"Alpha Access Request"** template — fill in the required fields (name, GitHub username, use case, expected volume, ToS/Privacy acknowledgements). Optionally paste a GPG or age public key for encrypted `GATEWAY_API_KEY` delivery.
3. Submit the issue. The owner reviews within **3–7 business days** (manual review — personal project).
4. Owner responds with:
   - `GATEWAY_API_KEY` — delivered via GitHub DM by default, or via the encrypted channel you specified.
   - Your effective rate-limit allocation (default: fair share of 100/day global).
   - Onboarding confirmation.

### Option B: Direct contact

For cases where a public issue isn't appropriate (enterprise NDA evaluation, sensitive disclosure), send a GitHub DM to [@Jhonata-Matias](https://github.com/Jhonata-Matias). Same review process applies.

## Step 2 — Install the SDK

### TypeScript / Node.js 18+

**2a. Configure `.npmrc` in your project:**

```
@jhonata-matias:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Where `GITHUB_TOKEN` is your Personal Access Token with `read:packages` scope:
- Generate at https://github.com/settings/tokens (classic token)
- Select scope: `read:packages`
- Export: `export GITHUB_TOKEN=ghp_xxx...`
- Or add to your `.env` (don't commit)

**2b. Install:**

```bash
npm install @jhonata-matias/flux-client
```

Verify install:
```bash
node -e "console.log(require('@jhonata-matias/flux-client').FluxClient.name)"
# Expected: FluxClient
```

### Python / Colab (without SDK)

See `examples/colab/flux_demo.py` for a standalone Python quickstart using `requests`. Replace the RUNPOD endpoint call with the gateway URL and include `X-API-Key` header.

**Note:** official Python SDK is not in scope for alpha. If needed, you can port the TypeScript SDK patterns (retry + warmup + typed errors) to Python.

## Step 3 — Configure credentials in your app

**Server-side only** — NEVER put GATEWAY_API_KEY in browser JS bundle or client-facing code.

```typescript
// .env (gitignored)
GATEWAY_URL=https://gemma4-gateway.jhonata-matias.workers.dev
GATEWAY_API_KEY=<your-issued-key>
```

```typescript
// server code (e.g., Next.js API route, Express handler, Lambda)
import { FluxClient, ColdStartError, RateLimitError, AuthError } from '@jhonata-matias/flux-client';

const client = new FluxClient({
  apiKey: process.env.GATEWAY_API_KEY!,
  gatewayUrl: process.env.GATEWAY_URL!,
});
```

## Step 4 — First image

```typescript
// Pre-warm on app init to avoid first-request cold start
await client.warmup();
console.log('is warm:', client.isWarm()); // true

// Generate
try {
  const result = await client.generate({
    prompt: 'a peaceful zen garden with cherry blossoms, photorealistic',
    steps: 4,
    width: 1024,
    height: 1024,
    seed: 42,
  });

  // result.output.image_b64 is the PNG encoded as base64
  console.log('image size:', result.output.image_b64.length);
  console.log('elapsed:', result.output.metadata.elapsed_ms, 'ms');

  // Save or return to client
  const buf = Buffer.from(result.output.image_b64, 'base64');
  // fs.writeFileSync('out.png', buf);
} catch (e) {
  if (e instanceof ColdStartError) {
    // Cold start exceeded retry budget — usually means worker is taking >180s
    // Recommended: surface "server taking longer than usual" UX, retry later
    console.error(`cold timeout after ${e.retry_count} retries (${e.duration_ms}ms)`);
  } else if (e instanceof RateLimitError) {
    // Global daily limit hit (100/day alpha)
    console.error(`rate limit. retry in ${e.retry_after_seconds}s (resets at ${e.reset_at})`);
  } else if (e instanceof AuthError) {
    // API key invalid or revoked
    console.error('auth failed — check GATEWAY_API_KEY');
  } else {
    throw e;
  }
}
```

## Step 5 — Production-ready patterns

### Retry handling

SDK's default retry config is tuned for cold-start scenarios (first attempt 180s, subsequent 30s, max 3 retries, exponential backoff 1s/2s/4s). For your application:

- **Latency-sensitive (web UX):** use `client.warmup()` on app start; display loading state for ≤2min on first user visit
- **Batch processing (scripts):** accept cold penalties; use default retries
- **High-throughput:** be aware of 100/day global cap during alpha

### Input validation

SDK validates `GenerateInput` strictly (no coercion). Common gotchas:

- `steps` must be integer > 0 (FLUX.1-schnell works best with `steps=4`)
- `width`/`height` must be positive integers (recommended: multiples of 64, max ~1536)
- `seed` is optional integer for reproducibility
- `prompt` must be non-empty string

Invalid input throws `ValidationError` pre-network — no cost, immediate feedback.

### Production deployment checklist

Before deploying your app using servegate FLUX API to production:

- [ ] GATEWAY_API_KEY in server-side environment only (not client bundle)
- [ ] Warmup called on app init OR before first expected user request
- [ ] Typed error handling for ColdStartError, RateLimitError, AuthError
- [ ] Graceful UI for cold-start wait (up to 180s first-use)
- [ ] Monitoring: track warmup latency, generate latency, error rates
- [ ] Budget alert: if your usage approaches daily cap, implement queueing
- [ ] Content moderation: FLUX is unfiltered; add classifier before publishing outputs

## Step 6 — Key management

### Rotation

Recommended every 90 days or on-demand if:
- Suspected leak (key visible in error logs, repo, backup)
- Developer departure
- Security incident

**Process:**
1. Request new key via new GitHub issue (mention old key fingerprint, not value)
2. Owner issues new key + revokes old
3. Update `GATEWAY_API_KEY` in your env
4. Redeploy your app
5. Verify old key returns 401; new key returns 200

### Revocation (emergency)

If key compromised **right now**:

1. Open GitHub issue `security-incident` **immediately**
2. Owner rotates gateway secret within hours (same-day response target)
3. Your app will start getting 401s until you update to new key

## Troubleshooting

| Symptom | Likely cause | Action |
|---|---|---|
| 401 Unauthorized | Wrong key or revoked | Check `GATEWAY_API_KEY` env; contact owner |
| 429 Too Many Requests | Global 100/day limit hit | Wait until `reset_at` (next 00:00 UTC); plan within quota |
| 504 Gateway Timeout | Persistent cold (>180s) | Retry in 5 min; if continues, report via issue |
| 502 Upstream Error | RunPod endpoint 5xx | Report via issue — owner investigates |
| Type errors on `import` | `.npmrc` misconfigured | Verify `@jhonata-matias:registry=...` line + token |
| `npm install` 404 | Token lacks `read:packages` | Regenerate GitHub token with correct scope |

## FAQ

**Q: Can I use this in a commercial product?**
A: During alpha, no. The Service is for evaluation only. For commercial use, wait for beta OR contact owner with specifics.

**Q: Is the SDK open source?**
A: SDK source is in the repo under MIT license, but the package is published to a private GitHub Packages registry. You can fork and self-host if needed.

**Q: Can I self-host the gateway?**
A: Yes. Gateway source is in `gateway/` — deploy to your own Cloudflare account following `docs/usage/gateway-deploy.md`. You'll need your own RUNPOD_API_KEY.

**Q: What happens when alpha ends?**
A: No fixed timeline. Beta transition will include: stable SDK v1.0.0, formal SLA, public signup (no invite), potential cost model.

**Q: Can I help / contribute?**
A: Yes! PRs welcome. See existing stories in `docs/stories/` for planned work. Especially useful: Python SDK port, alternative provider integrations, content moderation middleware.

## References

- [Terms of Use](../legal/TERMS.md)
- [Privacy Statement](../legal/PRIVACY.md)
- [Monitoring & abuse reporting](./monitoring.md)
- [Gateway deploy guide (self-host)](./gateway-deploy.md)
- [ADR-0001: Cold-start strategy](../architecture/adr-0001-flux-cold-start.md)
- [SDK CHANGELOG](../../sdk/CHANGELOG.md)

---

**Document version:** 0.1.0-alpha (2026-04-21)
**Next revision trigger:** beta launch OR SDK v1.0.0 OR significant process change
