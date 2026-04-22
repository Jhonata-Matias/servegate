# Monitoring & Abuse Response — gemma4 FLUX API (Owner guide)

**Audience:** Project owner (@Jhonata-Matias) operating the Service
**Scope:** day-to-day observability + incident response for alpha phase

This guide is for the owner, not end-user devs. End-user devs should read `dev-onboarding.md`.

---

## Daily checks (~5min/day recommended)

### 1. Gateway logs (`wrangler tail`)

```bash
cd gateway
npm run tail
```

Streams JSON logs in real-time. What to look for:

| Event | Normal baseline | Alert threshold |
|---|---|---|
| `proxy_success` | majority of traffic | sudden drop |
| `auth_failed` | <5% of traffic | spike → potential brute-force |
| `rate_limited` | 0-1/day | sustained → abuse or misconfigured client |
| `proxy_error` | <1% of traffic | spike → upstream RunPod issue |
| `invalid_method` | ~0 | spike → crawler/scanner activity |

### 2. RunPod billing dashboard

Access: https://runpod.io/console/serverless → your endpoint

What to check:
- **Daily cost trending** — alert threshold $10/day (configure email in RunPod settings)
- **Request count vs gateway logs** — should match roughly; big divergence = bypass attempt
- **Worker scaling behavior** — unexpected workersMin>0 = config drift (per ADR-0001 Path A should stay 0)

### 3. KV counter state

```bash
cd gateway
# List today's counter
npx wrangler kv key list --binding=RATE_LIMIT_KV

# Inspect current count
npx wrangler kv key get --binding=RATE_LIMIT_KV "count:$(date -u +%Y-%m-%d)"
```

Expected: count increments linearly through the day, resets after 00:00 UTC (48h TTL auto-cleanup).

## Weekly checks (~15min/week)

### 1. Token hygiene audit

- GitHub PAT (`write:packages`, `repo`) — rotate if >90 days
- RunPod API key — rotate if >90 days or if any suspicion of leak
- Cloudflare API tokens — rotate if >90 days

### 2. Active keys review

```bash
cd gateway
npm run secret:list
```

Confirm only expected secrets present: `GATEWAY_API_KEY`, `RUNPOD_API_KEY`, `RUNPOD_ENDPOINT_ID`.

### 3. Dep updates

```bash
cd sdk
npm outdated

cd ../gateway
npm outdated
```

If security advisories present: `npm audit` and patch critical/high.

## Monthly checks

### 1. Cost reconciliation

Pull RunPod billing export + Cloudflare usage:

```bash
# RunPod via gh CLI if API key authenticated OR web dashboard
# Cloudflare: dashboard → Workers → Overview → usage graph
```

Compare monthly spend vs Epic 2 PRD budget target ($25/mo MVP). Trend upward sustained → consider Path B pivot per ADR-0001 30-day review.

### 2. Access list review

List current GATEWAY_API_KEY issued vs documented onboarding issues. Revoke stale (>90 days inactive OR developer departed).

### 3. Security patch cycle

- GitHub dependabot alerts: triage + merge
- Node.js version: stay on LTS (18/20/22)
- Wrangler: `npm install wrangler@latest` quarterly

## Incident response

### Level 1: Suspected key leak

**Signals:**
- Developer reports key visible in public repo / pastebin
- Abnormal `proxy_success` volume from unexpected IPs
- Owner discovers key in own logs/backups accidentally

**Response (same-day):**

```bash
cd gateway

# 1. Rotate gateway secret IMMEDIATELY
npm run secret:gateway-key  # prompt asks for new value
# enter: new value from `openssl rand -hex 32`

# 2. Confirm old key now returns 401
curl -H "X-API-Key: <OLD_KEY>" $GATEWAY_URL -d '{}' -X POST
# expected: {"error":"invalid_api_key","reason":"mismatch"}

# 3. Notify affected developers via their onboarding issue thread
# "Security incident — rotate your GATEWAY_API_KEY via new issue"

# 4. Document in risk register (Epic 2 PRD Risk Register)
```

**Per-dev key isolation note:** during alpha, only ONE GATEWAY_API_KEY exists (shared across all approved devs). Post-alpha enhancement: per-dev keys → revocation affects only compromised key.

### Level 2: Abuse / rate-limit bypass

**Signals:**
- `rate_limited` spike >10/day (beyond normal 0-1)
- Cost spike detected via RunPod alert
- Single IP responsible for majority of traffic

**Response (within 24h):**

1. Identify offending IP via `wrangler tail` filter
2. Option A — **temporary IP block** via Cloudflare firewall rule (dashboard → Security → WAF)
3. Option B — **revoke key** used by offender (rotate GATEWAY_API_KEY, new key only issued to non-offenders)
4. Document in risk register + update Terms of Use if new abuse pattern found
5. If sustained volume → consider tighter rate-limit (e.g., 50/day) via code change in `gateway/src/rate-limit.ts` (`DAILY_LIMIT` constant)

### Level 3: Legal / abuse report

**Signals:**
- External complaint about content generated via the Service (DMCA, defamation, etc.)
- Law enforcement inquiry
- NSFW/illegal content report

**Response (same-business-day):**

1. Acknowledge receipt via official channel
2. Capture relevant logs window (timestamp + IP from complaint) via `wrangler tail --format=json` archive
3. **Do NOT proactively share logs with third parties** — require formal legal process (subpoena, court order)
4. If user identifiable via onboarding record, contact dev for explanation
5. Suspend service access if clear violation of Terms
6. Document in repo as sealed issue (label: `legal-incident`, access-restricted)
7. Consult legal counsel if unclear — do not respond alone to legal inquiries

### Level 4: RunPod/Cloudflare outage

**Signals:**
- Gateway returns 502/503/504 across all requests
- RunPod dashboard shows endpoint unhealthy
- Cloudflare status page (https://www.cloudflarestatus.com/) shows incident

**Response:**

1. Check provider status pages first (RunPod, Cloudflare)
2. If isolated to our endpoint: RunPod support ticket
3. If provider-wide: wait; communicate to users via repo README banner
4. Do NOT escalate Path B pivot mid-incident — wait for provider resolution
5. Post-incident: extract metrics (downtime duration) for 30-day review

## Alerting setup (one-time)

### RunPod billing alert

1. Log into RunPod console
2. Settings → Billing → Usage Alerts
3. Configure: email `<owner@email>` when daily usage exceeds $10
4. Verify: test alert flow

### Cloudflare Worker analytics

1. Cloudflare dashboard → Workers & Pages → your worker → Settings → Observability
2. Enable observability (already set in `wrangler.toml`)
3. Dashboard shows: requests/min, errors/min, CPU time distribution

### GitHub issue notifications

1. Repo → Settings → Notifications
2. Enable: new issues with labels `security-incident`, `abuse-report`, `legal-incident`
3. Configure: immediate email + push (via GitHub mobile)

## Disaster recovery

### What to back up (weekly manual, 5min)

- `gateway/wrangler.toml` (KV namespace ID — NOT secrets)
- `gateway/src/` (code — already in git)
- List of issued GATEWAY_API_KEYs with dev identifiers (encrypted password manager)
- RUNPOD_API_KEY, RUNPOD_ENDPOINT_ID (password manager)
- GitHub PAT with `write:packages` (password manager)

### Recovery scenario: Cloudflare account lost

**Time-to-recovery:** ~1 hour

1. Create new Cloudflare account (or recover via support)
2. `wrangler login` with new account
3. `npm run kv:create` → new ID
4. Update `wrangler.toml` with new KV ID
5. Re-add all 3 secrets (`npm run secret:*`)
6. `npm run deploy` → new URL
7. Notify all devs: **new GATEWAY_URL, same API key** (or new key if rotating simultaneously)
8. Redeploy any dependent apps (Story 2.3 demo if live)

### Recovery scenario: RunPod endpoint deleted

**Time-to-recovery:** ~30min

1. Redeploy via Story 2.1 procedure (`serverless/deploy.sh`)
2. New endpoint ID → update `RUNPOD_ENDPOINT_ID` gateway secret
3. No downstream changes needed (gateway abstracts endpoint)

### Recovery scenario: SDK package lost (GitHub Packages deleted)

**Time-to-recovery:** ~10min

1. `cd sdk && npm run build && npm publish` (republish)
2. Notify devs: no action needed if same version, reinstall same version

## Runbook triggers for ADR-0001 Review (2026-05-21)

Per Epic 2 PRD v0.4 "30-Day Review Governance":

| Trigger | Source data | Action |
|---|---|---|
| PT1: volume >1000 imgs/mo sustained 2+ weeks | RunPod billing | Draft Story 2.1.3 (Path B pivot) |
| PT2: web demo bounce rate >40% | Vercel Analytics (after Story 2.3 live) | Pivot Path B OR fix UX |
| PT3: cold p95 >180s | Bench re-run (TD4) | Pivot Path B |
| PT4: >3 complaints about first-use latency | GitHub issue triage | Pivot Path B |

Owner runs review on 2026-05-21. Escalation to @architect if 2+ triggers HIT.

---

## Runbook version

| Version | Date | Notes |
|---|---|---|
| 0.1.0-alpha | 2026-04-21 | Initial monitoring runbook for alpha phase |

Updates: as new abuse patterns discovered OR infrastructure changes.
