# Outcome Memo — Agentic Coding via Qwen3-Coder-30B (D+30)

> **SKELETON — a preencher pelo owner em 2026-08-24 (30 dias após deploy prod do Story 7.1)**
>
> **Story:** [`docs/stories/7.1.qwen3-coder-vscode-spike.story.md`](../stories/7.1.qwen3-coder-vscode-spike.story.md) · **AC:** 10
> **Brief:** [`docs/brief-agentic-coding.md`](../brief-agentic-coding.md) · **SS:** SS1 target ≥20%
> **Feeds:** ADR-0007 (a autorar após este memo — go/kill/extend)
> **Deploy target date:** 2026-07-25 (referência — ajustar se deploy prod atrasar)
> **Memo write date:** 2026-08-24 (D+30)

---

## Executive Summary

*(preencher em 3-5 linhas: outcome geral, custo real, % PRs migrados, decisão go/kill)*

**Verdict:** GO / KILL / EXTEND (com 15 dias adicionais)

---

## Metric — % PRs T1-T5 migrados

### Counting rule (definido em 2026-07-25)

Um PR é considerado "migrated to Qwen" se:

1. **≥ 50% do código merged** foi originalmente drafted pelo Qwen (via VS Code Copilot chat com modelo `qwen3-coder:30b` selecionado)
2. Owner marcou o commit com trailer `Coauthored-by: Qwen3-Coder <servegate>` OU registrou no `.aiox/notes/agentic-coding-log.md` (append-only diário)
3. PR foi merged em ≥ 1 dos repos: `servegate/gemma4`, `contabhub/onety`, ou qualquer repo pessoal do owner

### Baseline

Período pré-spike (2026-06-25 a 2026-07-24) — 30 dias imediatamente anteriores ao deploy:
- Total PRs owner-authored: **⚠️ PREENCHER** (contar via `gh pr list --author @me --state merged --search "merged:2026-06-25..2026-07-24"`)
- Distribuição T1-T5 pré-spike: **⚠️ PREENCHER**

### Actual (2026-07-25 a 2026-08-24)

- Total PRs owner-authored: **⚠️ PREENCHER**
- PRs migrated (per counting rule): **⚠️ PREENCHER**
- **% migrated: X%** ← **decisão go/kill anchora aqui**
- Distribuição das migrated por bucket:
  - T1 (trivial): X
  - T2 (small): X
  - T3 (medium): X
  - T4 (complex): X ← surpresa se ≥ 3 aqui — modelo passou barreira original
  - T5 (architectural): X ← surpresa se ≥ 1 aqui

### Decision threshold

| % migrated | Verdict | Ação |
|:----------:|:-------:|------|
| **≥ 20%** | GO | Manter endpoint, formalizar ADR-0007 GO, planejar Story 7.2 (evolução) |
| 10-19% | EXTEND | +15 dias extras, revisar setup (prompt engineering? modelo maior?) |
| **< 10%** | KILL | Teardown via `spike/qwen3-coder-vscode/teardown.sh`, ADR-0007 KILL, endpoint deletado |

---

## Cost accounting

### Setup (one-time, Tasks 2-5)

- Endpoint provisioning + smoke: **$⚠️ PREENCHER** (target ≤ $5 per AC6 circuit breaker)
- Weights download runtime: **$⚠️ PREENCHER**

### Steady state (D+0 a D+30)

- Total runtime seconds Qwen endpoint (via cost-ledger.json): **⚠️ PREENCHER**
- Total spend Qwen ($1.22/hr × hours): **$⚠️ PREENCHER**
- Vs budget cap ($60/mo): dentro / acima (delta $X)

### Anthropic delta

- Pre-spike monthly Anthropic spend (baseline): **$⚠️ PREENCHER**
- Post-spike monthly Anthropic spend: **$⚠️ PREENCHER**
- **Delta: -$X (economia real) ou +$X (regressão)** — assumindo Qwen deveria descarregar 40% do fluxo

---

## Quality issues encountered

### Per bucket (contabilize incidentes de alucinação ou output ruim)

| Bucket | # tasks tentadas | # sucesso | # falha (owner precisou refazer em Claude ou manual) | Notas qualitativas |
|--------|:----------------:|:---------:|:----------------------------------------------------:|--------------------|
| T1 | X | X | X | *(owner comenta padrões — ex: "acerta typos 100%, hesita em imports")* |
| T2 | X | X | X | *(ex: "features simples ok, mas confunde padrões CSS Modules ↔ Tailwind")* |
| T3 | X | X | X | *(ex: "precisa 2-3 iterações; comum errar side effects em hooks React")* |
| T4 | X | X | X | *(ex: "falha frequente em fiscal BR — NFS-e catálogo E0314 inventa códigos")* |
| T5 | X | X | X | *(ex: "não conseguiu propor arquitetura decente; refactors amplos ficam inconsistentes")* |

### Padrões de alucinação recorrentes

- **⚠️ PREENCHER** — ex: "inventa métodos de bibliotecas third-party que não existem (PlugNotas, Banco Inter)"
- **⚠️ PREENCHER** — ex: "às vezes retorna código TypeScript quando repo é JS puro"
- **⚠️ PREENCHER** — ex: "confia demais em regex quando parser AST seria mais robusto"

### Padrões onde surpreendeu (positivos)

- **⚠️ PREENCHER** — ex: "excelente em boilerplate React + tests Vitest"
- **⚠️ PREENCHER** — ex: "converte bem entre CommonJS e ES modules"

---

## Latency profile

- P50 time-to-first-token warm: **X ms** (target ≤ 2s per AC4)
- P95 time-to-first-token warm: **X ms**
- Cold start P50 (após >60s idle): **X s** (impacto no UX?)
- Owner sentiu diferença de latência vs Claude Sonnet? **⚠️ PREENCHER (sim/não/marginal)**

---

## Anthropic usage delta

Se dados disponíveis (Anthropic Console → Usage):

- Pre-spike (jun 26 a jul 24): input tokens X · output tokens Y · $Z
- Post-spike (jul 25 a ago 23): input tokens X · output tokens Y · $Z
- **Delta**: -X% em Anthropic (economia esperada 40%; realizado?)

---

## Decision — feeds ADR-0007

**Verdict:** GO / KILL / EXTEND

**Rationale (2-4 parágrafos owner-authored):**

*(preencher — foque em: a economia real materializou? qualidade foi aceitável no % projetado? existe caminho pra melhorar? riscos escondidos apareceram?)*

**Ações imediatas:**

- [ ] Se GO: mantém endpoint, agenda review 90 dias, considera Story 7.2 (rate-limit KV separado, monitoramento auto, etc)
- [ ] Se KILL: roda `bash spike/qwen3-coder-vscode/teardown.sh`, ADR-0007 formaliza kill
- [ ] Se EXTEND: identifica hipótese específica pra testar (ex: "trocar pra Qwen3-Coder-Next se lançou"), agenda re-review 15 dias

**ADR-0007 será autorada em:**
- Se GO ou KILL: `docs/architecture/adr-0007-agentic-coding-verdict.md` (padrão ADR-0003, ADR-0006)
- Se EXTEND: adiar até segunda janela terminar

---

## Cross-refs

- Story: [`docs/stories/7.1.qwen3-coder-vscode-spike.story.md`](../stories/7.1.qwen3-coder-vscode-spike.story.md)
- Brief: [`docs/brief-agentic-coding.md`](../brief-agentic-coding.md)
- Setup guide: [`docs/usage/vscode-agentic-setup.pt-BR.md`](../usage/vscode-agentic-setup.pt-BR.md)
- Teardown: [`spike/qwen3-coder-vscode/teardown.sh`](../../spike/qwen3-coder-vscode/teardown.sh)
- License audit: [`spike/qwen3-coder-vscode/license-audit.md`](../../spike/qwen3-coder-vscode/license-audit.md)
- PM analysis 2026-07-25 (baseline dados 98 PRs Onety) — em memory session

---

## Change Log

| Date | Author | Change |
|------|--------|--------|
| 2026-07-25 | @dev (YOLO) | Skeleton pre-authored per Story 7.1 AC10 pra reduzir fricção do owner em D+30. Todas as métricas concretas ficam ⚠️ PREENCHER até 2026-08-24. |
| 2026-08-24 | Owner | *(preencher no dia)* |
