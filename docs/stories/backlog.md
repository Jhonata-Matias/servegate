# Story Backlog

> Items deferred from active stories as follow-ups (📌), tech debt (🔧), or enhancements (✨).
> Prioritized: 🔴 Critical > 🟠 High > 🟡 Medium > 🟢 Low.
> Managed by `@po` via `*backlog-add`, `*backlog-review`, `*backlog-prioritize`, `*backlog-schedule`.

---

## 🔧 Tech Debt

### TD-3.1.2 — Normalize 400 error shape across validation paths

- **Priority:** 🟢 Low
- **Related Story:** 3.1 (qwen-image-edit-i2i)
- **Source:** QA Gate F2 (Round 1), deferred to backlog at Round 2 (Path A + user approval)
- **Description:** `serverless/handler.py:482` returns `{error, message, code}` for `InputValidationError`; `serverless/handler.py:485` returns `{error, code}` for `ValueError`/`TypeError`. Additive, non-breaking, but inconsistent. Unify to always include optional `message` field OR document the distinction in `docs/api/reference.md`.
- **Suggested Owner:** `@dev`
- **Estimated Effort:** 10 min
- **Tags:** error-handling, api-consistency, story-3.1, epic-3
- **Unblock Condition:** None (can be picked up opportunistically)
- **Created:** 2026-04-24 by `@po` (Round 2 closure handoff)

### TD-3.1.3 — Run CodeRabbit self-healing loop post-release on feature/3.1 branch

- **Priority:** 🟢 Low
- **Related Story:** 3.1 (qwen-image-edit-i2i)
- **Source:** QA Gate F5 (Round 1), deferred at Round 2 with explicit user approval; deferral re-affirmed 2026-04-24 Task 10 pre-flight when CodeRabbit returned HTTP 429 `Rate limit exceeded, try after 45 minutes and 59 seconds` (external platform limit, not code defect)
- **Description:** Run `~/.local/bin/coderabbit --prompt-only --base main` against the feature/3.1-qwen-image-edit-i2i branch once rate limit resets. Reviews all 4 commits (a909447 → df12317). Expected zero CRITICAL/HIGH findings — QA Round 4 PASS 94, 42/42 pytest green, pod smoke PASS, commit diff manually reviewed by @qa. Register any surprising findings as follow-up fix stories.
- **Suggested Owner:** `@dev`
- **Estimated Effort:** ~15 min run + 5-15 min findings triage
- **Tags:** coderabbit, quality-validation, story-3.1, epic-3, post-release-gate
- **Unblock Condition:** CodeRabbit platform rate limit window reset (usually 45-60 min after hit) + local CLI auth already configured on 2026-04-24
- **Priority Window:** Before Epic 3 closure if possible; otherwise post-release cleanup
- **Retry Evidence:** `docs/qa/coderabbit-reports/3.1-pre-pr-review-20260424-094556.md` (captures the rate-limit response)
- **Created:** 2026-04-24 by `@po` (Round 2 closure handoff); expanded 2026-04-24 by `@devops` (Task 10 pre-flight rate-limit)

---

## 📌 Follow-ups

### FU-4.2.1 — KV writes/day monitoring + alert at 80% of free-tier ceiling

- **Priority:** 🟡 Medium
- **Related Story:** 4.2 (Gemma Gateway + RunPod text endpoint)
- **Source:** @po Pax review on 2026-04-24 — user question about Cloudflare gateway security + free-tier rate-limit ceiling
- **Context:** Cloudflare Workers KV free-tier hard-cap is **1,000 writes/day per account** (CF docs 2026). Each gateway call (image submit OR text generate) costs ~2 KV writes (`count:` increment + `tokens:` post-flight accounting). At 200 calls/day combined alpha policy we sit at ~20% of quota; 500 calls/day ≈ 100% (service breaks silently — KV writes throttle, rate-limit logic produces stale data).
- **Description:** Add daily observability check to gateway:
  - Read `count:YYYY-MM-DD` and `tokens:YYYY-MM-DD` cumulative writes-equivalent metrics
  - Emit `alert: kv_write_budget_high` log event when daily writes approach 800 (80% of free-tier 1K/day cap)
  - Wire notification (GitHub issue auto-create OR Discord webhook OR email — TBD)
  - Acts as the trigger to upgrade Workers Paid (<incremental cost>, 1M writes/month = 33× headroom)
- **Suggested Owner:** `@dev` (instrumentation in `gateway/src/log.ts` or new `gateway/src/observability.ts`)
- **Estimated Effort:** ~2h implementation + ~30min alert wiring
- **Tags:** observability, rate-limit, free-tier, cost-control, story-4.2, epic-4
- **Trigger:** Story 4.2 close OR first month of Story 4.4 (alpha launch) — whichever comes first
- **Created:** 2026-04-24 by `@po` (Pax)

### FU-4.3.1 — Workers Paid upgrade pre-flight before per-key rate-limit lands

- **Priority:** 🟠 High (blocks Story 4.3+ if per-key rate-limit is in scope)
- **Related Story:** 4.3 (SDK + examples — anticipated per-key rate-limit need per ADR-0004 Implementation Notes)
- **Source:** @po Pax review on 2026-04-24 — user question about Cloudflare gateway security + free-tier rate-limit ceiling
- **Context:** When Story 4.3+ implements per-key rate-limit (KV key format `tokens:{api-key-hash}:{date}` per ADR-0004 §Implementation Notes "Future (Story 4.3+): Per-key, multi-tier budgets"), each gateway call costs **3+ KV writes** (global `count:` + global `tokens:` + per-key `tokens:hash:`). Free-tier ceiling drops from ~500 calls/day → ~333 calls/day. Plus Story 4.3 SDK + example traffic typically pushes daily volume up. Need to upgrade infra BEFORE the code change ships.
- **Description:** Before any Story 4.3 work that adds per-key rate-limit:
  - Validate budget approval for Workers Paid (<incremental cost> = $60/yr)
  - @devops upgrades CF account: Workers Free → Workers Paid via dashboard
  - Verify monthly quota: 10M requests, 1M KV writes — covers 30K calls/day comfortably
  - Document upgrade in deploy runbook + post-mortem
- **Suggested Owner:** `@po` (budget approval) + `@devops` (CF account upgrade + verification)
- **Estimated Effort:** ~30min budget decision + ~10min CF dashboard upgrade + ~10min verification
- **Tags:** infra-upgrade, rate-limit, paid-tier, cost, blocker-for-4.3, epic-4
- **Trigger:** Story 4.3 kickoff (before any per-key code change is committed)
- **Cost Impact:** +<incremental cost> recurring (covered within Phase 0 cost-model headroom: alpha projection $12-15/mo + $5 = $17-20/mo, still well under <alpha cost ceiling>)
- **Created:** 2026-04-24 by `@po` (Pax)

---

## ✨ Enhancements

### ENH-2.9 — Refactor landing into Astro Starlight docs portal

- **Priority:** 🟡 Medium
- **Related Story:** Future Story 2.9 (docs portal). Derived from Story 2.3 (web-demo-nextjs-vercel) + Story 2.7 (pt-BR-dev-docs) lineage. Trigger: PR #15 multi-image i2i merged — current `web/landing/index.html` (995 LOC single-page marketing) is undersized for the growing API/SDK surface.
- **Source:** @ux-design-expert (Uma) front-end spec on 2026-04-29 after user reference (RunPod docs portal screenshot) + multi-image feature merge requiring docs update.
- **Description:** Replace single-page marketing landing at `deploy-lp-one.vercel.app/` with a 3-column docs portal (sidebar nav · centered content · TOC) built with Astro Starlight (MDX content, Pagefind search, Shiki code highlight, dark-only V1). Migration scope V1 = 5 pages (Welcome · Quickstart · API Reference · SDK · Errors). Welcome uses custom card-grid 3×2 replicating RunPod ref. Brand identity preserved (charcoal+teal palette, Geist fonts). Multi-image i2i documented in API · SDK · Errors. New folder `web/docs/`; old landing archived to `web/_archive/landing-pre-docs-2026-04-29/`. Vercel project root cutover from `web/landing/` → `web/docs/`.
- **Spec:** [`docs/design/landing-docs-portal-refactor.md`](../design/landing-docs-portal-refactor.md) — 7 locked decisions, IA, design tokens (Starlight CSS overrides), 4-phase implementation plan (~9-12h), 9 acceptance criteria, V2 backlog (light theme, versioned docs, Authentication/Concepts/Releases/Resources pages, ADR index, i18n parity), 5 risks with mitigations, 7-step hand-off checklist.
- **Suggested Owner:** `@dev` (implementation across 4 phases) + `@devops` (Vercel root directory change at cutover) + `@ux-design-expert` (review of Welcome card-grid + content polish)
- **Estimated Effort:** ~9-12h total (Phase 1 setup ~2h · Phase 2 content migration ~5h · Phase 3 polish ~2h · Phase 4 cutover ~1h)
- **Tags:** docs, astro-starlight, landing, web-docs, multi-image-i2i, epic-2, consumer-integration
- **Pre-condition for dev kickoff:** Spec is complete and locked. Recommended: `@sm *draft` to create formal Story 2.9 with this spec as Dev Notes input before `@dev *develop`. Alternative: `@dev *develop-preflight docs/design/landing-docs-portal-refactor.md` directly (faster but bypasses Story validation gate).
- **Trigger:** Open. Can start any sprint. No external blockers.
- **Created:** 2026-04-29 by `@po` (Pax) on user request after `@ux-design-expert` (Uma) handed off the front-end spec.

---

## Change Log

| Date | Author | Change |
|------|--------|--------|
| 2026-04-24 | @po (Pax) | Backlog file created. Registered TD-3.1.2 + TD-3.1.3 (both from Story 3.1 Round 2 deferrals). |
| 2026-04-24 | @po (Pax) | Added FU-4.2.1 (KV writes/day monitoring) + FU-4.3.1 (Workers Paid upgrade pre-flight) following user's gateway security + rate-limit ceiling question on Story 4.2. CF Workers Free hard-cap = 100K req/day + 1K KV writes/day; KV writes is the active constraint at ~500 calls/day combined ceiling. Recommended alpha policy: 300 calls/day combined for 3× headroom. |
| 2026-04-29 | @po (Pax) | Added ENH-2.9 (Refactor landing into Astro Starlight docs portal) following @ux-design-expert spec. Triggered by multi-image i2i merge (PR #15) needing docs update + user reference to RunPod docs portal pattern. Spec at `docs/design/landing-docs-portal-refactor.md`. |
