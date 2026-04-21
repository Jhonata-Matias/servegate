# Decision Log — Story 2.2 (TypeScript SDK `@gemma4/flux-client`)

**Mode:** YOLO (autonomous)
**Started:** 2026-04-21T18:55:00-03:00
**Branch:** `feature/2.2-sdk-flux-client`
**Base commit:** `38d3fcc` (post PRD v0.4 + drafts)

## Pre-flight Decisions (Task 1)

### D1 — SDK location: `sdk/`

- **Alternatives considered:**
  1. `packages/sdk/` (monorepo pattern) — rejected: zero existing `packages/`, no pnpm-workspace, would force monorepo migration (out of scope)
  2. `sdk/` (top-level single-package) — **CHOSEN** — alinha com pattern existente (`serverless/` é top-level)
  3. `clients/typescript/` (multi-language client futuro) — rejected: YAGNI para MVP solo dev
- **Reason:** Repo é flat single-package; minimum surface change

### D2 — Build tool: tsup

- **Alternatives:**
  1. `tsup` — **CHOSEN** — zero-config dual CJS/ESM + types via esbuild; padrão para SDKs modernos (e.g. ai-sdk, vercel libs)
  2. `tsc` direto — rejected: requer dual config para CJS/ESM, mais boilerplate
  3. `unbuild` (rollup-based) — rejected: overhead extra, tsup é suficiente
- **Reason:** Velocidade build + dual bundle out-of-box

### D3 — Test framework: vitest

- **Alternatives:**
  1. `vitest` — **CHOSEN** — fast, ESM-friendly, Jest-compatible API, fake timers built-in (precisamos para retry tests)
  2. `jest` — rejected: ESM ainda problemático em Jest
  3. Node native test runner — rejected: ainda imaturo, sem fake timers convenientes
- **Reason:** Modern, fast, ESM-native; familiar Jest-like API

### D4 — devLoadAlwaysFiles ausentes

- **Status:** Documentado como gap; nem `docs/framework/{coding-standards,tech-stack,source-tree}.md` nem fallback `docs/architecture/{padroes-de-codigo,pilha-tecnologica,arvore-de-origem}.md` existem.
- **Action:** Seguir TS ecosystem standards (strict mode, named exports, named + default exports, JSDoc em public APIs)
- **Backlog:** Criar docs/framework/ files é tech debt para Epic 2 closure

### D5 — Branch strategy

- **Decision:** Feature branch `feature/2.2-sdk-flux-client` (per @sm responsibility for local branches)
- **Reason:** Permite rollback isolado; merge final via @devops handoff

### D6 — License

- **Decision:** MIT (standard SDK license)
- **Reason:** Project é proprietário gemma4 mas SDK pode eventualmente ser open-sourced; MIT default permite ambos

### D7 — Story 2.5 dependency: stub mode

- **Status:** Story 2.5 (gateway) está Ready, não Done. Não bloqueia tasks 1-10 (code, build, README, publish prep).
- **Decision:** Task 11 (integration smoke) marcada como **deferred** até 2.5 Done; smoke test mockado via MSW como prova de contrato
- **Reason:** Per story Task 1 ("OR stubado para dev")

### D8 — Publish step deferred

- **Decision:** Build + npm pack validation sim; `npm publish` real para GitHub Packages **deferred** ao @devops (ou follow-up commit pelo dev) por requerer GH token com `write:packages` scope que não está configurado no ambiente atual
- **Plan:** Task 10 cumpre AC8 modulo o publish final — config + dry-run prontos

## Implementation Log

(populated during execution)
