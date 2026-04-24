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

### TD-3.1.3 — Run CodeRabbit self-healing loop on commit `a909447` post-auth

- **Priority:** 🟢 Low
- **Related Story:** 3.1 (qwen-image-edit-i2i)
- **Source:** QA Gate F5 (Round 1), deferred at Round 2 with explicit user approval
- **Description:** CodeRabbit WSL CLI not executed during Story 3.1 dev cycle due to WSL auth not configured. Task 7 requires `wsl bash -c '~/.local/bin/coderabbit --severity CRITICAL,HIGH --auto-fix -t uncommitted'` against commit `a909447`. Expected to report zero CRITICAL/HIGH findings (Round 2 verified via manual analysis + 34/34 pytest green + strict additivity). If CRITICAL/HIGH surface, create follow-up fix story.
- **Suggested Owner:** `@dev`
- **Estimated Effort:** 30 min
- **Tags:** coderabbit, quality-validation, story-3.1, epic-3
- **Unblock Condition:** User runs `~/.local/bin/coderabbit auth login` OR configures `--api-key`
- **Priority Window:** Before Epic 3 closure if possible; otherwise post-release cleanup
- **Created:** 2026-04-24 by `@po` (Round 2 closure handoff)

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
