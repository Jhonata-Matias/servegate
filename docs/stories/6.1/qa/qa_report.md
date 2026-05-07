# QA Review Build — Story 6.1 (HiDream-I1 PoC spike)

**Data da revisão:** 2026-05-06 (UTC)  
**Revisor:** Quinn (@qa — Test Architect)  
**Branch analisada:** `spike/hidream-i1-poc` @ `ddd7451`  
**Comando:** `*review-build 6.1`

**Sinal:** **REJEITADO** *(build de story incompleta — scaffolding aceitável, critérios de aceitação e evidências ainda não fechados)*

---

## Resumo executivo

O trabalho atual entrega bem o **isolamento CON-prod**: handler e runner em `spike/hidream-poc/`, `.gitignore` para artefatos locais e **nenhuma alteração** em `serverless/handler.py` nem `gateway/src/` conforme esperado pela story. Porém **a maior parte dos AC** depende de execução em RunPod (endpoint, medições frias/quentes, custo empírico, 50 PNGs, teardown, regressão ao vivo contra gateway de produção). Essas evidências **não existem** no repositório (e não são versionadas por desígnio). Sob as regras do review-build (subtasks/evidência/testes de critérios de aceitação), o pacote não pode ser **aprovado** como “story concluída”.

Pontos positivos incluem contrato alinhado (`image_b64` + metadata), uso de env para segredos, fixture de 50 prompts e estrutura de relatório sanitizável (`docs/research/...`). Riscos a tratar antes do próximo review: garantir teardown automático quando o circuit breaker dispara (AC parcialmente coberto só pelo operador); alinhar verificação de diff com `origin/main` se `main` local estiver defasado.

---

## Phase 0: Contexto

| Artefato | Estado |
|---------|--------|
| `docs/stories/6.1/spec/spec.md` | **Ausente** (layout Esperado pela task Epic 6 QA; esta story está em arquivo único `6.1.hidream-i1-poc-spike.story.md`) |
| `implementation/implementation.yaml` | **Ausente** |
| Story / AC | Carregados do markdown da story — escopo PoC bem definido |

**Nota:** A ausência da pasta `spec/` não impede revisão técnica, mas quebra conformidade estrita da task `qa-review-build` — tratado como waiver documentado na Phase 10.

---

## Phase 1: Subtasks / tarefas na story

- **Commits:** existe `feat(spike-6.1): scaffold...` (`ddd7451`).
- **File List:** preenchido no Dev Agent Record.
- **Checklists de Tasks:** múltiplas caixas ainda `[ ]` (Tasks 2–7 execução, Task 9 wrap).  
**Resultado:** **incompleto** para um review-build “DONE” estrito → contribui ao **REJECT**.

**Evidência (PoC GPU):**

- Pasta `.aiox/notes/story-6.1/` está **gitignored** — esperado para PNG/JSON custo.
- Logo: **nenhuma** evidência versionada de `cold-start-*.json`, `warm-latency-*.json`, `regression-smoke-*.md` → AC3–AC6 e parte de AC8 pendentes.

---

## Phase 2: Ambiente / build

- **`npm install` + `npm run build` na raiz:** não aplicável (*sem `package.json` na raiz*).
- **`gateway/`:** dependências já presentes na workspace; comandos típicos de build global da task foram **adaptados**.

---

## Phase 3: Testes automatizados

| Suite | Resultado |
|-------|-----------|
| `cd gateway && npm test` | **PASS** — 12 ficheiros, **117 testes** (corrida QA 2026-05-07) |

*Não há suíte dedicada ao Python do spike.*

---

## Phase 4: Browser

**N/A** — sem alterações UI no âmbito do spike 6.1 (`git show ddd7451 --stat` não inclui front-end).

---

## Phase 5: Base de dados

**N/A** — sem migrações.

---

## Phase 6: Code review focado (`spike/hidream-poc`)

**Segredos**

- Credenciais via `RUNPOD_API_KEY` env em `measure.py` / `teardown.sh`; sem literais encontrados nos fontes revisados (**OK**).

**Riscos / melhorias (severidade)**

1. **[MEDIUM]** AC5/Task 6: ao disparar circuit breaker (`BudgetExceeded`), `measure.py` grava ledger e aborta mas **não invoca teardown** nem documenta automatismo equivalente — a story espera teardown após overrun; está dependente do operador correr `teardown.sh`.
2. **[LOW]** Divergência de path: AC8 menciona `packages/sdk/` mas o repo usa `sdk/` (README do spike já aponta `sdk/`). Alinhar wording na story em revisão futura (@sm) — não bloqueante técnico.
3. **[LOW]** `handler.py`: carregamento one-shot dos pesos pode misturar “cold inference” RunPod worker vs primeiro request após reboot — aceitável se metodologia for documentada (**já há notas por logs**).

**Lint global / npm audit**

- Root `npm run lint`/`npm audit` não executados pelo mesmo motivo da Phase 2; escopo gateway coberto por testes.

---

## Phase 7: Regressão

- **Commits do spike apenas (`ddd7451`):** apenas `.gitignore`, `docs/research`, `docs/stories/6.1...`, `spike/hidream-poc/**` → sem toque em caminhos de produção declarados (**OK para CON-prod**).
- **Atenção:** `git diff main...HEAD` na máquina de desenvolvimento inclui commits que estão entre `main` **local desatualizado** e HEAD (por ex. docs `web/` já em `origin/main`). Para auditoria estrita AC8 recomenda-se `git fetch` e uso de `origin/main...HEAD`. O diff **de produção** (`serverless/handler.py`, `gateway/src`, `sdk/`) deve permanecer vazio relativamente ao `main`/merge-base correto.

- **Smoke produção POST /jobs:** **não verificado nesta QA** — depende operador (`regression-smoke-*.md` local).

---

## Phase 8: Issues por severidade

### Crítico

*(nenhum bloqueante de segurança local nos ficheiros do spike)*  

### Alta

1. **AC/execução incompletos:** sem medições GPU, sem manifest/PNGs na árvore (esperadas locais), sem evidência teardown, sem regressão gateway ao vivo.

### Média

1. Tear down não acoplado ao circuit breaker (ver Phase 6).
2. Divergência de baseline `git diff main` quando `main` local ≠ `origin/main`.

### Baixa

1. Alinhar `packages/sdk` vs `sdk` na documentação de AC/story.

---

## Phase 9: Atualizações recomendadas (não aplicadas pela QA)

- `.aiox/status.json`: não atualizado pela QA (opcional conforme infra do projeto).

---

## Phase 10: Sinal e próximos passos

### Sinal: **REJECT**

**Motivo:** critérios de aceitação de medição infra (AC2–AC7), relatório populado com números reais (AC9) e regressão vivada (parte AC8) **não comprovados**; tarefas da story continuam maioritariamente incompletas.

### Próximas ações (para @dev / operador)

1. Subir endpoint isolado conforme README; gravar IDs e timestamps no research doc (sanitização @po antes de mirror público).
2. Correr `measure.py smoke`, depois `all` ou cold/warm; arquivar manifest + PNG locais para Story 6.2.
3. Ao cap hit ou fim bem-sucedido, correr **`teardown.sh`** e guardar evidência (resposta API / screenshot).
4. Produção FLUX: `curl`/HAR em `.aiox/notes/story-6.1/regression-smoke-*.md`.
5. Completar checklists na story → solicitar novo `*review-build 6.1` ou `*review 6.1`.

---

*Gerado por Quinn (@qa) via fluxo qa-review-build (adaptado a story plana sem `spec/spec.md`).*
