# Decision Log — Story 2.6: Alpha Developer Access Distribution

**Mode:** YOLO (autonomous)
**Started:** 2026-04-22
**Branch:** `feature/2.6-alpha-access-distribution`
**Commit before:** `897a90b` (PO validation Draft → Ready)
**Agent:** Dex (@dev) Opus 4.7 1M context

## Decisions

### D1 — README language: English

- **Decision:** Root README.md written in **English**
- **Reason:** Outsider-facing landing page; matches `sdk/README.md` predominant tone (EN with PT-BR sections); maximizes international dev reach in alpha
- **Alternatives:** PT-BR (rejected — international devs target); bilingual (rejected — maintenance overhead, alpha scope)
- **PO observation reference:** O1

### D2 — Badge approach: shields.io shorthand

- **Decision:** Use `https://img.shields.io/badge/...` static badges (no live data fetching)
- **Reason:** Simple, no external API dependency; status badges are static facts (alpha, MIT, gateway live URL)
- **Alternatives:** Custom dynamic shields (rejected — overengineering for static facts); plain emoji (rejected — less recognizable)

### D3 — Commit granularity: bundled single commit (Task 7)

- **Decision:** Tasks 2+3+4+5 ship em **1 commit** `feat(access): Story 2.6 alpha access distribution artifacts`
- **Reason:** All artifacts serve same goal (access distribution); SIMPLE story doesn't justify split; matches Task 7 plan
- **Alternatives:** Split em 4 commits (rejected — atomic units para SIMPLE story = overkill); split em 2 (README+contact) e (templates+api-ref) (rejected — same reason)
- **PO observation reference:** O3

### D4 — Issue templates: GitHub Forms YAML schema

- **Decision:** Use modern **GitHub Forms** (`.yml`) ao invés de legacy markdown templates (`.md`)
- **Reason:** Forms enforce required fields server-side; better UX para outsider; current GitHub default
- **Alternatives:** Legacy `.md` (rejected — sem field enforcement); mixed (rejected — inconsistente)

### D5 — API reference structure: single doc + curl-first

- **Decision:** `docs/api/reference.md` único, curl-first quickstart no topo, schemas detalhados depois
- **Reason:** Devs scannem reference para "como faço X" — curl é universal; schemas/codes vão como reference table
- **Alternatives:** OpenAPI spec gerada (rejected — overkill alpha, sem swagger UI deployed); split em multiple files (rejected — fragmentation atual já é o problema sendo resolvido)

### D6 — Skip devLoadAlwaysFiles load

- **Decision:** Não carregar `docs/framework/*.md` files (não existem; project não tem framework docs custom)
- **Reason:** Story 2.6 é zero production code (apenas docs/config/release); coding standards files não são load-bearing aqui
- **Alternatives:** Criar files vazios (rejected — invention); load fallback `docs/architecture/*` (rejected — irrelevant scope)

## Files Modified

**Created (commit 48b4fc6):**
- `README.md` (74 lines)
- `.github/ISSUE_TEMPLATE/access-request.yml` (66 lines, GH Forms)
- `.github/ISSUE_TEMPLATE/bug-report.yml` (54 lines, GH Forms)
- `.github/ISSUE_TEMPLATE/feature-request.yml` (43 lines, GH Forms)
- `.github/ISSUE_TEMPLATE/config.yml` (10 lines)
- `docs/api/reference.md` (264 lines)
- `.ai/decision-log-2.6.md` (this file)

**Modified (commit 48b4fc6):**
- `sdk/README.md` — added Contact section + cross-links (+15 lines)
- `docs/usage/dev-onboarding.md` — Step 1 Option A simplified (-25 net lines)

## Tests Run

- ✅ YAML syntax: `python3 yaml.safe_load` for 4/4 issue templates → all pass
- ✅ Pre-flight: SDK package status (private), merge commit existence (9d1f100), clean slate (no `README.md`, no `docs/api/`, no `.github/ISSUE_TEMPLATE/`)
- ⏭ Curl validation deferred to AC7 external smoke (avoids burning 1/100 daily quota during dev)

## HALT Items (require user/external action)

- **Task 6:** SDK visibility flip (GitHub UI / @user)
- **Task 8:** Release v0.1.0-alpha (@devops push tag + gh release create)
- **Task 9:** External smoke validation (@user with clean env or 2nd account)
- **Task 10:** Epic 2 PRD closure (@pm post-Task 9 PASS)
