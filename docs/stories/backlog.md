# Story Backlog

> Items deferred from active stories as follow-ups (📌), tech debt (🔧), or enhancements (✨).
> Prioritized: 🔴 Critical > 🟠 High > 🟡 Medium > 🟢 Low.
> Managed by `@po` via `*backlog-add`, `*backlog-review`, `*backlog-prioritize`, `*backlog-schedule`.

---

## 🔧 Tech Debt

### TD-6.1 — Codify License Stack Audit gate in brainstorming-output template

- **Priority:** 🟡 Medium
- **Related Story:** Epic 6 closure (REJECT-track) — process correction
- **Source:** ADR-0006 Open Threads + memory entry `feedback_brainstorm_license_audit`
- **Description:** Patch `.aiox-core/development/templates/brainstorming-output-tmpl.yaml` to require an explicit "License Stack Audit" section before any Path Synthesis. Audit must enumerate all component dependencies (transformer, encoders, VAEs, schedulers, tokenizers, refiners, safety filters), capture each component's actual LICENSE, derive composite license = most-restrictive component, and cross-reference against `docs/architecture/recommended-approach.md` alternatives-rejected table. Current memory entry captures the rule but is not structurally enforced.
- **Suggested Owner:** `@architect`
- **Estimated Effort:** ~1-2 hours (template patch + 1 example brainstorm refactor for testing)
- **Tags:** brainstorm-framework, template-amendment, license-audit, epic-6, process-correction
- **Unblock Condition:** None (can start anytime); ideally land BEFORE next model-selection brainstorm
- **Created:** 2026-05-07 by @po (Epic 6 closure handoff from ADR-0006 Open Threads)

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

### FU-6.1 — Path 2 (Stable Diffusion 3.5 Large) — $1M ARR cliff impact assessment at servegate scale

- **Priority:** 🟡 Medium
- **Related Story:** Epic 6 closure (REJECT-track) — input for next model-selection brainstorm
- **Source:** ADR-0006 Open Threads + brainstorm 2026-05-06 Path 2 (SD 3.5L deferred during HiDream-I1 selection)
- **Description:** Stability Community License imposes commercial license requirement at $1M annual revenue. Determine whether this cliff is acceptable for servegate at projected alpha → paid tier scale (and on what timeline). If acceptable: SD 3.5L re-enters as candidate for next brainstorm. If not: Path 2 is closed and only Path 3 (fal.ai proxy) remains. Output: lightweight memo deciding the cliff acceptability.
- **Suggested Owner:** `@pm`
- **Estimated Effort:** ~2-4 hours (revenue projection + license fine-print read + memo)
- **Tags:** model-selection, license-evaluation, epic-6-followup, brainstorm-input
- **Unblock Condition:** None — but must complete BEFORE next model-selection brainstorm runs
- **Created:** 2026-05-07 by @po (Epic 6 closure handoff from ADR-0006 Open Threads)

### FU-6.2 — Path 3 (fal.ai proxy) economics revisit

- **Priority:** 🟡 Medium
- **Related Story:** Epic 6 closure (REJECT-track) — input for next model-selection brainstorm
- **Source:** ADR-0006 Open Threads + brainstorm 2026-05-06 Path 3 (fal.ai proxy with 30-50% margin tax noted)
- **Description:** Calculate per-call economics of fal.ai (or Replicate) hosted proxy for FLUX dev quality reference. Compare margin tax (30-50%) vs self-host operational savings at servegate's projected volumes. License-clean path (consumer of hosted SaaS, not weight redistributor). Output: economics matrix for fal.ai vs Replicate vs self-host on quality-comparable models, decisioning whether proxy is sustainable as primary path or only as fallback.
- **Suggested Owner:** `@pm` + `@analyst`
- **Estimated Effort:** ~4-6 hours (rate-card cross-comparison + projection model + memo)
- **Tags:** economics-evaluation, hosted-proxy, epic-6-followup, brainstorm-input
- **Unblock Condition:** None
- **Created:** 2026-05-07 by @po (Epic 6 closure handoff from ADR-0006 Open Threads)

### FU-6.3 — Llama-replacement feasibility study (HiDream-I1 watch-list condition)

- **Priority:** 🟢 Low
- **Related Story:** Epic 6 closure (REJECT-track) — WATCH-LIST condition #3 (community fine-tune of HiDream backbone on Apache encoder)
- **Source:** ADR-0006 Open Threads + WATCH-LIST re-evaluation conditions
- **Description:** Theoretical study: can the HiDream-I1 diffusion backbone be fine-tuned to use an Apache-licensed text encoder (Qwen, Gemma, Phi, Mistral Apache variant) instead of the Llama 3.1 8B Instruct currently embedded? Engineering cost? Quality cost? Should be triggered ONLY if a community group publishes such a fine-tune (do not commission it from servegate). Mostly a watch-and-wait task — entry exists to ensure we have it on radar if a watch-list signal appears.
- **Suggested Owner:** `@analyst`
- **Estimated Effort:** ~1 hour quarterly check + ~4 hours analysis IF a community fine-tune appears
- **Tags:** hidream-watchlist, encoder-replacement, epic-6-followup
- **Unblock Condition:** Community fine-tune of HiDream backbone on Apache encoder published with parity benchmarks
- **Created:** 2026-05-07 by @po (Epic 6 closure handoff from ADR-0006 Open Threads)

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

### ENH-2.9 — Refactor landing into Astro Starlight docs portal ✅ CLOSED 2026-04-30

- **Status:** ✅ **CLOSED** — delivered via Story 2.9 (PR #19 + #20 merged 2026-04-29/30). Production live at `deploy-lp-one.vercel.app/`.
- **Story:** [`docs/stories/2.9.docs-portal-refactor.story.md`](2.9.docs-portal-refactor.story.md) — Status: Done. QA gate PASS 96.
- **Final delivery:** Astro Starlight portal at `web/docs/` with 5 pages (Welcome · Quickstart · API Reference · SDK · Errors). Brand identity preserved (`#1d7fe5` accent + Inter/JetBrains Mono — corrected from spec's hypothesized teal+Geist after reading actual landing config). Multi-image i2i documented in 3 places. Lighthouse 100/100/100/100 across all 5 pages, zero axe-core violations. Old landing archived to `web/_archive/landing-pre-docs-2026-04-29/`. Vercel project rootDirectory cutover from `null` → `web/docs` via API + git-source deploy.
- **Closure metadata:**
  - **Effort actual:** ~14h end-to-end (vs estimated ~9-12h). Drift driven by Codex sandbox blocker on Phase 1 (resolved by main session pivot, documented as memory) + 2 unplanned QA rounds + 1 user-reported bug fix pre-cutover.
  - **PRs:** #19 (main implementation, 7 commits squash-merged) + #20 (archive + tooling, 1 commit squash-merged)
  - **Merge commits on main:** `b2171ab` (PR #19) + `88424f8` (PR #20)
  - **V2 follow-ups:** consolidated as ENH-2.10 below.
- **Created:** 2026-04-29 by `@po` (Pax) · **Closed:** 2026-04-30 by `@po` (Pax)

### ENH-2.10 — Docs portal V2 polish (post-Story-2.9 follow-ups)

- **Priority:** 🟢 Low (bundle of nice-to-haves, none individually urgent)
- **Related Story:** Successor to ENH-2.9 / Story 2.9. Triggered post-cutover during pre-cutover review + UX signoff caveats.
- **Source:** Story 2.9 Dev Notes "V2 backlog" + UX review caveats (`docs/qa/2.9-ux-review.md`) + design decision artifacts during the cutover sweep.
- **Description:** Bundle of polish items deferred from Story 2.9 V1. Each can be picked individually and become a small standalone story when prioritized. Sub-items (priority order):

  | # | Item | Trigger to schedule | Effort |
  |---|---|---|---|
  | 1 | **Bundle Inter + JetBrains Mono via `@fontsource/*`** | First feedback "fonts look weird on Windows" or any cross-OS fidelity issue | ~30min |
  | 2 | **Light theme support** (revert ThemeSelect override, add light-mode token bindings, run Lighthouse) | Once accessibility audit requests light mode OR non-dev-audience feedback | ~3-4h |
  | 3 | **Custom `IconLinkCard` atom** (Starlight component override accepting `title` + `description` + `href` + `icon`) | If 3+ alpha users say emoji prefixes feel unprofessional or want SVG icons back | ~30-45min |
  | 4 | **Custom 404 page** (replace Starlight default with branded copy + helpful links to top pages) | Anytime — small UX polish | ~30min |
  | 5 | **ADR index page** linked from Welcome `Resources` slot or sidebar | When `docs/architecture/adr-*.md` count ≥ 5 (currently 5 ADRs already, threshold met) | ~1h |
  | 6 | **Dedicated sub-pages: Authentication, Concepts, Releases, Resources** (currently linked from Welcome card-grid to GitHub external) | When content for any one is ready (e.g., per-key rate-limit per ADR-0004 makes Auth page valuable) | ~1h per page |
  | 7 | **API Reference split into per-endpoint sub-pages** (`/api/jobs/`, `/api/generate/`, etc.) | When current single-page api.mdx exceeds ~500 LOC (currently ~200 LOC, threshold not met) | ~2h |
  | 8 | **i18n parity (pt-BR ↔ en)** — translate the 5 pages | When alpha BR adoption signals demand mirror Story 2.7's pt-BR-onboarding | ~4-6h |
  | 9 | **"Copy page" plugin** (e.g., `starlight-copy-page` or custom) | Quality-of-life polish, low signal value alone | ~30min |
  | 10 | **Versioned docs** (`/v0.4/api/`, `/v0.5/api/`) | First time a breaking SDK change makes "this version of the docs" relevant | ~2-3h setup + ongoing |
  | 11 | **Algolia DocSearch** (replace Pagefind) | Only if Pagefind perf or relevance becomes an issue at scale (>50 pages) | ~1-2h |

- **Suggested Owner:** `@dev` for impl + `@ux-design-expert` for design review on items 2, 3, 4
- **Estimated Effort (full bundle):** ~15-25h cumulative if all done in one push (unlikely — typically picked individually as triggers fire)
- **Tags:** docs, astro-starlight, web-docs, polish, v2, epic-2
- **Trigger:** Open. No blockers. Each item has its own trigger condition above; pull from this entry as needed.
- **Created:** 2026-04-30 by `@po` (Pax) at Story 2.9 close-out.

---

## Change Log

| Date | Author | Change |
|------|--------|--------|
| 2026-04-24 | @po (Pax) | Backlog file created. Registered TD-3.1.2 + TD-3.1.3 (both from Story 3.1 Round 2 deferrals). |
| 2026-04-24 | @po (Pax) | Added FU-4.2.1 (KV writes/day monitoring) + FU-4.3.1 (Workers Paid upgrade pre-flight) following user's gateway security + rate-limit ceiling question on Story 4.2. CF Workers Free hard-cap = 100K req/day + 1K KV writes/day; KV writes is the active constraint at ~500 calls/day combined ceiling. Recommended alpha policy: 300 calls/day combined for 3× headroom. |
| 2026-04-29 | @po (Pax) | Added ENH-2.9 (Refactor landing into Astro Starlight docs portal) following @ux-design-expert spec. Triggered by multi-image i2i merge (PR #15) needing docs update + user reference to RunPod docs portal pattern. Spec at `docs/design/landing-docs-portal-refactor.md`. |
| 2026-04-30 | @po (Pax) | **Closed ENH-2.9** — delivered via Story 2.9 (PR #19 main impl + PR #20 archive/tooling, both merged). QA gate PASS 96. Production live at `deploy-lp-one.vercel.app/` with new Astro Starlight docs portal. Effort actual ~14h (vs estimated ~9-12h, +2-5h drift driven by Codex sandbox blocker recovery + 2 QA rounds + 1 pre-cutover bug fix). **Added ENH-2.10** consolidating 11 V2 polish follow-ups (font bundling, light theme, IconLinkCard atom, custom 404, ADR index, dedicated sub-pages, API split, i18n, versioned docs, Algolia, "Copy page") with individual trigger conditions per item. |
