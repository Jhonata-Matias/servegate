# servegate

> 🌐 **English** | [Português (Brasil)](./README.pt-BR.md)

**FLUX image-generation API — alpha, authenticated, rate-limited.**

> Formerly `gemma4`. Renamed to reflect the generalized gateway-to-serverless-model pattern. The Cloudflare Worker hostname `gemma4-gateway.jhonata-matias.workers.dev` remains unchanged for SDK compatibility.

[![status: alpha](https://img.shields.io/badge/status-alpha-orange)](./docs/legal/TERMS.md)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue)](./sdk/LICENSE)
[![gateway: live](https://img.shields.io/badge/gateway-live-green)](https://gemma4-gateway.jhonata-matias.workers.dev)
[![SDK: v0.2.0](https://img.shields.io/badge/sdk-v0.2.0-brightgreen)](./sdk/README.md)
[![API: async submit/poll](https://img.shields.io/badge/api-async%20submit%2Fpoll-blue)](./docs/api/migration-async.md)

---

## What is this?

- **A serverless FLUX.1-schnell image-generation API** fronted by an authenticated Cloudflare Worker gateway.
- **For whom:** TypeScript/Node.js developers who want to generate images programmatically without hosting GPU infrastructure.
- **Current status:** Alpha (invite-only). 100 images/day global rate limit. No SLA. Breaking changes expected.

## Quickstart

**Want to make your first API call?** Head to the [Developer Onboarding Guide](./docs/usage/dev-onboarding.md) — 5 steps, ~15 minutes from access request to first image.

The API uses an **async submit/poll** contract (since 2026-04-23, INC-2026-04-23-gateway-504). Submit returns `202 + job_id`; you then poll until the job is `COMPLETED`. The TypeScript SDK handles polling transparently; raw HTTP shown below:

```bash
# 1. Submit job → 202 + {job_id, status_url, est_wait_seconds: "unknown"}
JOB=$(curl -sX POST https://gemma4-gateway.jhonata-matias.workers.dev/jobs \
  -H "X-API-Key: $GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"a zen garden, photorealistic","steps":4,"width":1024,"height":1024,"seed":42}' \
  | jq -r '.job_id')

# 2. Poll every 5s until 200 + {output: {image_b64, ...}} (cold start may take ~130s)
until OUT=$(curl -sf https://gemma4-gateway.jhonata-matias.workers.dev/jobs/$JOB \
  -H "X-API-Key: $GATEWAY_API_KEY" | jq -e '.output.image_b64' 2>/dev/null); do sleep 5; done

echo "$OUT" | tr -d '"' | base64 -d > out.png
```

For the TypeScript path (recommended): `npm install @jhonata-matias/flux-client@^0.2.0` then call `client.generate(...)` — polling is internal. See [Developer Onboarding](./docs/usage/dev-onboarding.md).

## Links

| Resource | Location |
|---|---|
| Developer Onboarding | [docs/usage/dev-onboarding.md](./docs/usage/dev-onboarding.md) |
| API Reference | [docs/api/reference.md](./docs/api/reference.md) |
| Async Migration Guide | [docs/api/migration-async.md](./docs/api/migration-async.md) |
| TypeScript SDK | [sdk/README.md](./sdk/README.md) |
| Python / Colab example | [examples/colab/README.md](./examples/colab/README.md) |
| Terms of Use | [docs/legal/TERMS.md](./docs/legal/TERMS.md) |
| Privacy Statement | [docs/legal/PRIVACY.md](./docs/legal/PRIVACY.md) |
| Monitoring runbook | [docs/usage/monitoring.md](./docs/usage/monitoring.md) |
| Architecture (ADR) | [docs/architecture/adr-0001-flux-cold-start.md](./docs/architecture/adr-0001-flux-cold-start.md) |

## Contact

**Primary channel (access requests, bugs, feature ideas):** [open an issue](https://github.com/Jhonata-Matias/servegate/issues/new/choose) using one of the templates.

**Response SLA (alpha):** 3–7 business days, best-effort. This is a personal project — no enterprise support guarantees during alpha.

**Secure API key delivery:** after access request approval, the owner sends your `GATEWAY_API_KEY` via GitHub DM (preferred) or an encrypted channel you specify (include a GPG/age public key in your issue for encrypted delivery).

**Fallback:** GitHub DM to [@Jhonata-Matias](https://github.com/Jhonata-Matias) — reserved for cases where a public issue isn't appropriate (enterprise NDA concerns, sensitive disclosure).

**Security issues:** please use [private vulnerability reporting](https://github.com/Jhonata-Matias/servegate/security/advisories/new) rather than a public issue.

## Legal + alpha expectations

- **Alpha = invite-only**: access is gated by `GATEWAY_API_KEY` issuance (manual review, 3–7 days).
- **Rate limit**: 100 images/day globally across all users — prevents runaway cost during alpha.
- **Cold start**: first call after idle can take ~130 seconds. The SDK handles this via `warmup()` + transparent async polling (since v0.2.0).
- **No SLA**: personal project, best-effort uptime. Cloudflare Workers + RunPod Serverless provide the underlying platform SLAs.
- **Breaking changes expected** on minor version bumps (pre-1.0). Follow [sdk/CHANGELOG.md](./sdk/CHANGELOG.md).

By using the API you accept the [Terms of Use](./docs/legal/TERMS.md) and [Privacy Statement](./docs/legal/PRIVACY.md).

## License

MIT — see [LICENSE](./sdk/LICENSE) (SDK also covers public API artifacts).
