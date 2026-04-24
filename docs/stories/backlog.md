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

_(empty)_

---

## ✨ Enhancements

_(empty)_

---

## Change Log

| Date | Author | Change |
|------|--------|--------|
| 2026-04-24 | @po (Pax) | Backlog file created. Registered TD-3.1.2 + TD-3.1.3 (both from Story 3.1 Round 2 deferrals). |
