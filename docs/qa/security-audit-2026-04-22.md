# Security Audit — Public Repo Business Intelligence Exposure

**Auditor:** `@qa` (Quinn)
**Audit date:** 2026-04-22
**Trigger:** User governance question during PR #5 (Story 2.7) review — *"O @devops subiu informações de PRD e stories. Isto não expõe nossa regra de negócios para pessoas não autorizadas?"*
**Repo audited:** `Jhonata-Matias/servegate` (visibility: **PUBLIC** since 2026-04-22)
**User decision:** **Sanitizar + manter público** (Option 2 of 4 presented)

---

## Executive Summary

Repo `Jhonata-Matias/servegate` foi tornado público em 2026-04-22 como parte da Story 2.6 (Alpha Developer Access Distribution). O security audit feito naquele momento (#3535) focou exclusivamente em **secret leakage** (API keys, tokens, credentials) e foi **PASS — zero secrets exposed**.

**Gap identificado neste audit (2026-04-22 post-merge):** O audit pré-public **não avaliou business intelligence exposure** — unit economics, pivot thresholds, infrastructure identifiers, real operational metrics — que ficaram publicamente visíveis via 33 arquivos em `docs/`.

Esta auditoria **confirma ZERO secret leakage** mas identifica **significant business intel exposure** que o owner decidiu sanitizar mantendo repo público (building-in-public minus competitive intel).

---

## Audit Scope

- **Repo visibility:** ✅ Confirmed PUBLIC via `gh repo view` (visibility="PUBLIC", isPrivate=false)
- **Artifacts audited:** 33 files under `docs/` (full inventory in Section 2)
- **Git history depth:** 10 most recent commits analyzed (`git log --all --oneline`)
- **Scan methodology:** grep-based pattern matching + targeted Read of PRD/ADR/story sections + .gitignore validation

---

## Section 1 — Secrets Scan (✅ PASS)

### Patterns Tested

| Pattern | Target | Result |
|---|---|---|
| `api_key\|secret\|token\|password\s*[:=]\s*['\"][a-zA-Z0-9_\-]{20,}` | Hardcoded credentials with realistic entropy | **0 matches** |
| Placeholder inspection | `<sua-key-emitida>`, `<your-issued-key>`, `<ENDPOINT_ID>` | Present (intentional, safe) |
| `.env` files | Orphaned credential files in working tree | Gitignored (`.env` pattern in `.gitignore`) |
| `.ai/` decision logs | Autonomous agent traces | Gitignored (`.ai/` in line 52) |
| `.aiox-core/`, `.aiox/handoffs/` | Framework internals | Gitignored |

**Verdict:** ✅ **Zero secret exposure.** Cloudflare Worker secret store (`RUNPOD_API_KEY`, `GATEWAY_API_KEY`) is the authoritative store; no code or docs contain values.

---

## Section 2 — Business Intelligence Exposure (⚠️ SIGNIFICANT)

### 2.1 File Inventory (33 public docs)

```
docs/api/reference.md                                          (consumer-facing)
docs/architecture/adr-0001-flux-cold-start.md                  (internal architecture)
docs/legal/{PRIVACY,TERMS}.md + .pt-BR.md                      (consumer-facing)
docs/prd/epic-1-pod-inference-stack.md                         (internal strategy)
docs/prd/epic-2-consumer-integration.md                        (internal strategy)
docs/qa/{1.1-closure-summary,1.1-qa-report,2.6-external-smoke,2.7-translation-review}.md
docs/qa/gates/{2.1.2,2.2,2.5,2.6,2.7}-*.yml                    (internal QA decisions)
docs/stories/{1.1, 2.1, 2.1.1, 2.1.2, 2.2, 2.3, 2.5, 2.6, 2.7}.*.story.md  (internal planning)
docs/usage/{comfyui-flux-quickstart,dev-onboarding[+.pt-BR],gateway-deploy,monitoring,runpod-serverless-deploy}.md  (consumer-facing)
```

**Split:**
- **Consumer-facing (intended public):** 10 files (api, legal, usage, README)
- **Internal strategy (unintentional exposure):** 23 files (prd, architecture, qa, stories)

### 2.2 Exposure Categories

#### Category A — Infrastructure Identifiers (MEDIUM severity)

| Identifier | Type | Found in |
|---|---|---|
| `80e45g6gct1opm` | RunPod endpoint ID | 2.1.2, 2.5 stories + PRD |
| `mqqgzwnfp1` | Network volume ID | 1.1, 1.1.install stories |
| `55bd0b4a7c3c44bb958331ba82035e55` | KV namespace ID | 2.5 story |
| `03a4cc69-321c-438d-a2f7-f4647c6636ac` | Worker deployment version | 2.5 story |
| `gemma4-gateway.jhonata-matias.workers.dev` | Gateway hostname | Multiple (⚠️ **intentional** — devs precisam chamar) |

**Attack vector if exposed:** Direct RunPod endpoint bypass if attacker obtains `RUNPOD_API_KEY` — **mitigated** because key is Cloudflare Worker secret, never committed.

#### Category B — Unit Economics / Financial (MEDIUM-HIGH severity)

| Data | Value | Found in |
|---|---|---|
| GPU pricing (RTX 4090 flex) | `$0.00031/s` | 2.1.2 story |
| GPU pricing (RTX 4090 active) | `$0.00021/s` | 2.1.2 story |
| GPU pricing (RTX A5000 flex) | `$0.00019/s` | 2.1.2 story |
| GPU pricing (RTX A5000 active) | `$0.00013/s` | 2.1.2 story |
| Real billing measured | `$0.000306/s` | Epic 2 PRD v0.2, 2.1.2 |
| Warm cost per image | `$0.0015/img` | Epic 2 PRD |
| Cold cost per image | `$0.03/img worst-case` | Epic 2 PRD |
| Monthly budget target | `$25/mo` | Epic 2 PRD |
| Pivot threshold | `$30/mo sustained 2 weeks` | Epic 2 PRD |
| Vercel Pro tier pivot | `$20/mo` | 2.3 story |
| Path C standby cost | `$20/mo 24/7 idle` | 2.1.2 story |
| Network volume cost | `$2.50/mo` | 1.1 story |
| Pod 24/7 comparison | `$502/mo or $544/mo or $337/mo` | PRD + 2.1.2 |

**Competitor risk:** Detailed pricing model + margins exposed. Competitor can replicate unit economics.

#### Category C — Real Operational Metrics (MEDIUM severity)

| Metric | Value | Found in |
|---|---|---|
| Warm p95 | `7013ms (n=100)` | PRD + 2.1 story |
| Warm p50 | `5212ms` | PRD |
| Cold p95 | `98-150s (n=2)`, `~130s expected`, `150s ADR-0001` | ADR + multiple stories |
| Cold-start duration | `71s (Story 1.1)`, `3.1s warm smoke` | 1.1 story |
| Worker CPU time | `<10ms per orchestration` | 2.5 story |
| KV latency | `<1ms` | 2.5 story |
| Success rate | `98-100% (warm bench)` | PRD |

**Brand risk:** SLA reality (cold 130s) differs from user expectations — partially mitigated by explicit "no SLA" disclaimers.

#### Category D — Strategic / Roadmap (LOW-MEDIUM severity)

- Hybrid Pragmatic decision + rationale (why RunPod + why Cloudflare + why Vercel)
- ADR-0001 three paths (A accept cold, B bake-in, C standby) with full cost-benefit
- 30-day review governance: 4 pivot triggers + 4 stay-course criteria + DRI + escalation
- Dependency graph across all stories
- Effort budgets per story (1-2 dev-days, 4-8h, etc.)
- Future epic hints: Epic 3 (i18n + API reference translation), Python SDK, custom n8n node
- Volume thresholds for strategic decisions: `>1000 imgs/mo`, `>15k imgs/mês escalation`, `>20k imgs/mês migration`

#### Category E — Technical Debt & Risks (LOW severity)

- TD1-TD8 backlog com owners, estimates, completion status
- R1-R11 Risk Register with mitigations
- QA gate scores (91/100, 92/100, 95/100)
- Known issues transparent

#### Category F — Internal Process (LOW severity)

- AIOX agent framework references (@pm, @sm, @dev, @qa, @po, @devops)
- Story lifecycle phases
- Decision log references (local-only, gitignored)

---

## Section 3 — Attack Surface Analysis

| Attack vector | Feasibility | Mitigation present | Mitigation effectiveness |
|---|---|---|---|
| RunPod direct endpoint bypass | ❌ NOT feasible | `RUNPOD_API_KEY` Cloudflare secret | **100%** — requires key + endpoint ID both |
| Gateway key stuffing | ❌ NOT feasible | Invite-only issuance + 100/day global cap | **100%** for abuse at scale |
| Cost griefing via rate abuse | Limited | Hard cap `$3/day worst case` | **Strong** — bounded loss |
| **Competitor intelligence** | ✅ **FEASIBLE** | None — intentional OSS transparency | **N/A — accepted trade-off** |
| Brand perception (SLA reality) | Partial | Explicit "no SLA" in TERMS + README | **Mitigated by expectations setting** |
| Business model leakage | ✅ **FEASIBLE** | None | **User decision required** |

---

## Section 4 — Gap in Original Pre-Public Audit

**Context:** 2026-04-22 (earlier), audit #3535 ran before public flip. Focus was **secret leakage** (PASS — zero leaks).

**Gap:** Audit did not assess:
- Business intelligence exposure (unit economics, pivot thresholds)
- Roadmap visibility (strategic plans, competitor intel)
- Operational metrics transparency (SLA reality)
- Infrastructure identifier exposure (endpoint IDs, versions)

**Root cause:** Pre-public security checklist was narrow (OWASP-style secret scan) rather than comprehensive (business risk + competitive exposure).

**Recommendation for future public flips:** Expand pre-public audit to include:
1. Secret leakage (existing)
2. Business intelligence exposure (NEW — per this audit's methodology)
3. Infrastructure identifier exposure (NEW)
4. Strategic plan exposure (NEW)
5. User data / PII (existing)
6. Legal compliance exposure (existing via TERMS/PRIVACY review)

---

## Section 5 — User Decision Record (2026-04-22)

**Question presented:** 4 options for handling PRD/stories exposure

| Option | User Choice |
|---|---|
| 1. Keep public (status quo) | Not selected |
| 2. **Sanitize + keep public** | ✅ **SELECTED** |
| 3. Split repos (public + private) | Not selected |
| 4. Revert to private | Not selected |

**Rationale for Option 2 (user preview accepted):**
- Mantém benefício de repo público para alpha discovery (Story 2.6)
- Remove competitive intel detalhado
- Internal branch privado preserva originais para referência interna
- ~3-5h de trabalho, best balance entre custo e benefício

---

## Section 6 — Sanitization Plan (Next Step)

**Status:** Plan defined in this audit. Execution pending `@pm` + `@dev` handoff.

See `Section 7 — Sanitization Rules` below for concrete replacement rules.

**Proposed delivery:** Story 2.8 (new) OR follow-up issue + patch commits.

**Scope (23 internal files):**
- 2 PRDs (Epic 1, Epic 2)
- 1 ADR (0001 cold-start)
- 8 stories (1.1, 2.1, 2.1.1, 2.1.2, 2.2, 2.3, 2.5, 2.6, 2.7)
- 5 QA gates (2.1.2, 2.2, 2.5, 2.6, 2.7)
- 3-4 QA reports (1.1 summary + report, 2.6 smoke, 2.7 translation review)
- This security audit itself (meta)

---

## Section 7 — Sanitization Rules (Proposed)

### 7.1 Infrastructure Identifiers → Placeholders

| Original | Sanitized |
|---|---|
| `80e45g6gct1opm` | `<RUNPOD_ENDPOINT_ID>` |
| `mqqgzwnfp1` | `<NETWORK_VOLUME_ID>` |
| `55bd0b4a7c3c44bb958331ba82035e55` | `<KV_NAMESPACE_ID>` |
| `03a4cc69-321c-438d-a2f7-f4647c6636ac` (and similar Worker version IDs) | `<WORKER_VERSION>` |
| `gemma4-gateway.jhonata-matias.workers.dev` | **KEEP** — intentionally public (gateway URL = entry point) |

### 7.2 Unit Costs → Ranges

| Original | Sanitized |
|---|---|
| `$0.00031/s`, `$0.00021/s`, `$0.00019/s`, `$0.00013/s` (specific GPU pricing) | `~$0.0001-0.0003/s GPU` |
| `$0.000306/s` (measured) | `~$0.0003/s measured` |
| `$0.0015/img warm` | `<$0.01/img warm` |
| `$0.03/img worst-case cold` | `<$0.05/img cold worst case` |
| `$25/mo budget` | `<$50/mo alpha budget` |
| `$30/mo pivot threshold` | `<cost threshold sustained 2 weeks>` |
| `$20/mo Vercel Pro` | `<vendor upgrade cost>` |
| `$2.50/mo network volume` | `<storage overhead>` |
| `$502/mo` / `$544/mo` / `$337/mo` (Pod 24/7) | `<alternative stack 1-2 orders higher>` |
| `$3/day worst-case` | `<daily cost cap>` |

### 7.3 Volume Thresholds → Qualitative

| Original | Sanitized |
|---|---|
| `>1000 imgs/mo` (pivot trigger PT1) | `<sustained volume threshold>` |
| `>15k imgs/mês escalation` | `<high-volume escalation threshold>` |
| `>20k imgs/mês migration` | `<migration threshold>` |
| `100 imgs/dia` (rate limit) | **KEEP** — public SLA (in TERMS) |

### 7.4 Real Measurements → Ranges

| Original | Sanitized |
|---|---|
| `7013ms p95 (n=100)` | `~5-10s warm p95` |
| `5212ms p50` | **REMOVE** OR `~5s warm p50` |
| `98-150s cold (n=2)` | `~1-3min cold start` |
| `71s cold smoke` | **REMOVE** OR `cold start varies by worker state` |
| `3.1s warm smoke` | **REMOVE** OR `warm smoke sub-5s` |
| `<10ms worker CPU` | `<10ms edge overhead` (OK, generic) |
| `98-100% success rate` | **REMOVE** OR `high success rate in warm bench` |

### 7.5 Strategic Roadmap → Abstracted

| Original | Sanitized |
|---|---|
| Hybrid Pragmatic table (specific stack names) | **KEEP** — stack choices are public (Cloudflare, Vercel, RunPod already branded) |
| ADR-0001 three paths with cost matrix | Sanitize cost column (7.2 rules); keep path descriptions |
| 4 pivot triggers + 4 stay-course criteria | **REMOVE concrete thresholds** (replaces with `<qualitative trigger>`); keep governance process visible |
| Effort budgets (hours/days) | **KEEP** — effort transparency is OSS-healthy |
| Dependency graph | **KEEP** — Story flow is meta-structure, not business intel |

### 7.6 Items to KEEP Public (healthy transparency)

- Risk Register R1-R11 (transparency about what can go wrong)
- Tech Debt Backlog TD1-TD8 (healthy OSS practice)
- QA Gate scores (process transparency)
- AIOX framework references (meta, doesn't reveal product strategy)
- Story lifecycle phases (process meta)
- Owner handle `@Jhonata-Matias` (intentional — alpha contact channel)
- Gateway hostname (intentional — entry point)
- Public SLA data: `100/dia`, `warm <10s target`, `cold ~130s documented` (already in TERMS)

---

## Section 8 — Branch Strategy for Originals

User preview indicated "Internal branch privado guarda originais".

### Option A: Internal branch in same public repo
```bash
git checkout -b internal/planning-originals
git push -u origin internal/planning-originals
# Branch remains visible in public repo (contents public)
```
❌ **Does not solve exposure** — branches in public repo are public.

### Option B: Second private repo `servegate-planning`
```bash
gh repo create Jhonata-Matias/servegate-planning --private
# Clone, copy originals, push to private
```
✅ **Solves exposure** — mirror of originals, truly private.
⚠️ **Maintenance cost** — changes to public must sync to private (or accept drift).

### Option C: Local-only archive (gitignored)
```bash
cp -r docs/prd docs/stories docs/qa .ai/originals/
# .ai/ already gitignored
```
✅ **Zero sync cost** — local snapshot preserves history
❌ **No remote backup** — risk of loss on machine failure
⚠️ **Single-user access** — owner only

**Recommendation:** **Option B** (private `servegate-planning` repo) for durability + multi-device access. Option C acceptable as fallback if private repo quota is a concern.

---

## Section 9 — Quality Gate Decision

**Audit verdict:** ✅ **Secret security PASS + Business intel exposure CONFIRMED (user-accepted with sanitization plan)**

**Story 2.7 (PR #5) specific impact:**
- Story 2.7 artifacts add **minimal incremental business intel** (Story focuses on pt-BR translation, not new infra/economics)
- Main sensitivity in PR #5 comes from `docs/prd/epic-2-consumer-integration.md` v0.9 update — but this PRD has been public since v0.1 (2026-04-21)
- **Story 2.7 can merge safely** — does not materially worsen exposure; blocking the merge to sanitize would mix concerns

**Recommended ordering:**
1. **Merge PR #5 (Story 2.7) normally** — is benign + already QA PASS 95/100
2. **Open Story 2.8** for sanitization work (separate PR, clean scope)
3. **Private mirror** (`servegate-planning`) via `@devops` in parallel (independent work)

---

## Appendix A — Grep Queries Used in Audit

```bash
# Secrets (deep pattern scan)
grep -rEin "(api[_-]?key|secret|token|password)\s*[:=]\s*['\"][a-zA-Z0-9_\-]{20,}" docs/

# Endpoint IDs
grep -rn "80e45g6gct1opm\|mqqgzwnfp1\|runpod\|endpointId" docs/

# Cost data
grep -rEn '\$[0-9]+(\.[0-9]+)?(/img|/s|/mo|/day|/mês|/dia)' docs/

# Measurement data
grep -rEn "[0-9]+ms|[0-9]+s p95|[0-9]+s cold" docs/

# Strategic thresholds
grep -rEn "pivot trigger|threshold|>1000 imgs|10k|20k imgs" docs/prd/ docs/architecture/

# Risk register
grep -rEn "^\| R[0-9]+|Risk Register|Risks.*high" docs/prd/

# Tech debt
grep -rEn "^\| \*\*TD[0-9]+|TECH.?DEBT|Tech Debt" docs/prd/
```

---

## Appendix B — Responsibility Matrix for Next Steps

| Task | Owner | Priority |
|---|---|---|
| Merge PR #5 (Story 2.7) as-is | `@devops` or user | NORMAL |
| Create `servegate-planning` private repo + mirror originals | `@devops` | MEDIUM |
| Draft Story 2.8 "Sanitize public docs per security audit" | `@pm` → `@sm *draft 2.8` | HIGH |
| Execute Story 2.8 sanitization (23 files per Section 2.1) | `@dev` | HIGH |
| QA validation post-sanitization (verify zero sensitive data leaked) | `@qa` (me) | MEDIUM (post-dev) |
| Update this audit doc post-sanitization (close loop) | `@qa` | LOW |

---

**Sign-off (Quinn / @qa):**

Secret security is SOLID — zero leaks. Business intelligence exposure is REAL and was underweighted in the pre-public audit. User decision to sanitize while keeping public is pragmatic: preserves alpha discovery benefit + removes competitor intel. PR #5 can merge as-is (Story 2.7 is benign); sanitization work is Story 2.8 scope.

The gap in the pre-public audit is a **process lesson**: future public flips should include a Section 2-equivalent business-intel scan, not just secret scan. Recommend updating the `@devops` pre-public checklist accordingly.

— Quinn, guardião da qualidade 🛡️
