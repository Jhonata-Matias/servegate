# ADR-0005: RunPod Network Volume Datacenter Strategy

> **ℹ️ Sanitized version.** Business-sensitive details (unit economics, infrastructure identifiers, pivot thresholds, real measurements) are abstracted per [security audit Section 7](../qa/security-audit-2026-04-22.md) rules. Originals are preserved in private internal mirror. This is the canonical public record.


## Status

**✅ Accepted** — 2026-04-29

Decisão formaliza estado já em vigor desde Story 2.1 (FLUX cold-start mitigation, network volume provisionado em datacenter primário) e estabelece, pela primeira vez, gatilhos observáveis de re-avaliação. Aceita por **@architect (Aria)** após 2ª ocorrência do incidente de capacidade GPU no mesmo datacenter (issue de capacidade tracking-only).

Próxima revisão: **2026-07-29** (90 dias) ou ao primeiro `Pivot Criteria` ser disparado, o que vier antes.

---

## Context

A infraestrutura serverless do servegate (T2I via FLUX, i2i via Qwen-Image-Edit) depende de um único network volume RunPod — `<NETWORK_VOLUME_ID>` (datacenter primário) — onde residem todos os pesos de modelo dos workflows ComfyUI:

- `flux1-schnell.safetensors` — ADR-0001 Path A
- `qwen_image_fp8_e4m3fn.safetensors` — ADR-0003
- `qwen_image_edit_2509_fp8_e4m3fn.safetensors` — pendente, gated por incidente operacional em tracking
- VAE, encoders, Lightning LoRA

Esta decisão de single-volume nasceu implicitamente em **Story 2.1** quando o primeiro pod foi provisionado; nenhuma decisão arquitetural formal foi feita sobre o acoplamento **volume ↔ datacenter**. O acoplamento é uma propriedade da plataforma RunPod: network volumes são fisicamente locais a um datacenter e qualquer pod que os monte deve rodar no mesmo DC.

### O incidente que forçou a formalização

A capacidade de GPU no datacenter primário demonstrou ser cronicamente insuficiente para a carga do projeto:

| Data | Evidência | Impacto |
|---|---|---|
| Ocorrência #1 | Host pinado reportou *"not enough free GPUs"* durante múltiplos retries automatizados (`@devops` Phase 1a, Story 5.1) | Contribuiu ao pivô estratégico documentado na memória do projeto |
| Ocorrência #2 | Mesmo pod, mesmo host, mesmo erro durante deploy rotineiro | Step 1 do checklist de deploy bloqueado; merge-ready PR não pode ir a produção até pesos chegarem ao volume |

**2 ocorrências em janela curta no mesmo pod e mesmo host configuram padrão**, não coincidência. A reincidência é o gatilho que justifica formalizar a decisão *agora*, antes que uma 3ª ocorrência force migração tática sem ADR.

### Fatores que moldam esta decisão

1. **Constitutional Article IV (No Invention)** — múltiplas referências em memória do projeto e em issues operacionais mencionam "ADR-0005 v1.2", mas nenhum arquivo formal existia em `docs/architecture/`. Decisões arquiteturais que vivem só em memória de agente não são auditáveis nem rastreáveis. Esta é a materialização canônica.

2. **Reversibilidade** — migrar volume entre datacenters é operação **não-trivial e não-instantânea**. Toda decisão tática sobre o DC primário deve preservar opcionalidade de migração futura sem refatoração maior.

3. **Blast radius portfólio** — ADR-0003 (i2i) define o volume como infraestrutura **reusável across portfolio** (FLUX-T2I + Qwen-i2i + futuras apps). Migração afeta tudo simultaneamente.

4. **Custo de redundância** — RunPod não oferece replicação automática de network volumes entre datacenters. Multi-DC requer download manual + duplicação de storage à taxa padrão do provider × N datacenters.

---

## Decision

**servegate aceita formalmente o acoplamento single-DC do network volume `<NETWORK_VOLUME_ID>` no datacenter primário com 3 mitigações operacionais documentadas e 4 critérios de pivô observáveis que disparam re-avaliação automática.**

### Componentes da decisão

| Componente | Conteúdo |
|---|---|
| **Volume canônico** | `<NETWORK_VOLUME_ID>` permanece como única source-of-truth para pesos de modelo até Pivot Criteria ser disparado |
| **Affinity de pod** | Pods de produção (workers serverless) escalonados pelo RunPod sem host pin. Pods de development/admin (`pod.sh`) podem manter host pin se reduzir variância de boot, mas **devem** documentar este pin como reversível |
| **Operações I/O-bound** | Downloads de pesos, inspeções de volume, e qualquer operação que **não** requer GPU **devem** preferencialmente usar imagem CPU validada RunPod (`runpod/cpu-base` ou tag corrente), liberando GPUs para inferência real |
| **Mitigações de capacidade** | 3 paths documentados na seção "Known Gotchas & Mitigations", em ordem de blast radius crescente |
| **Triggers de re-avaliação** | 4 critérios mensuráveis na seção "Pivot Criteria"; qualquer um disparado obriga revisão deste ADR |

### O que esta decisão **não** faz

- ❌ **Não migra o volume agora.** Migração é decisão de portfólio que requer ADR próprio (ADR-0006 hipotético) com análise de DC alternativos, janela coordenada com Stories 2.x/3.x/5.x, e plano de rollback.
- ❌ **Não introduz redundância multi-DC.** Custo + complexidade não se justificam no volume atual de produção.
- ❌ **Não muda o handler ou a arquitetura de inferência.** Workers continuam mountando `<NETWORK_VOLUME_ID>` em `/runpod-volume` exatamente como hoje.

---

## Rationale

### Por que aceitar o single-DC em vez de migrar imediatamente

| Fator | Aceitar single-DC | Migrar agora |
|---|---|---|
| Tempo de implementação | 0 (já é o estado atual) | Janela operacional + downtime |
| Blast radius | Contido (incidente isolado) | Portfólio inteiro (T2I + i2i + futuras apps) |
| Risco de troca DC ruim por DC ruim | N/A | Alto sem dados de capacidade real do DC alternativo |
| Reversibilidade da decisão | Total | Parcial (volume migrado tem custo de re-migrar) |
| Article IV compliance | Sim (decisão rastreada) | Sim, mas sem dados que justifiquem o DC escolhido |
| Custo operacional ongoing | Zero incremental | Storage replicado se multi-DC, ou risco de novo single-DC |

A migração só se torna a decisão certa quando **dados observáveis de degradação contínua** justificam pagar o blast radius. Hoje, 2 ocorrências em janela curta estabelecem padrão mas não justificam pular o gate de coleta de dados.

### Por que codificar Pivot Criteria observáveis

A ausência de critérios mensuráveis foi precisamente o que permitiu este acoplamento existir entre Story 2.1 e a 1ª ocorrência sem que ninguém o questionasse. Codificar critérios cria:

- **Disparo automático de re-avaliação** quando o threshold é cruzado, sem depender de memória ou de @architect lembrar
- **Negociação ex-ante** de quando aceitar dor vs migrar — feita agora, em frio, em vez de em pânico durante 3ª ocorrência
- **Audit trail** para futuras stories que dependerem deste volume

### Por que separar operações GPU de operações I/O

A 2ª ocorrência foi causada pela tentativa de fazer download de pesos (operação puramente I/O-bound) em pod GPU pinado a host com escassez. Isso é um anti-pattern arquitetural: workloads CPU competem com workloads GPU pelo mesmo inventário escasso. Codificar a separação reduz a probabilidade da próxima ocorrência **sem** mudar a arquitetura de inferência.

---

## Known Gotchas & Mitigations

### Gotcha 1: Pod resume falha quando host pinado não tem GPU livre

**Sintoma:** `POST /v1/pods/{id}/start` retorna 500 *"not enough free GPUs"*.

**Mitigação tática (ordem recomendada de tentativa):**

| # | Path | Camada que ataca | Quando usar |
|---|---|---|---|
| 1 | **Imagem CPU validada RunPod para downloads** (`runpod/cpu-base:0.0.1` ou tag corrente, com `sshd` configurado) | Operação I/O isolada da GPU | Sempre que a operação não requer GPU (downloads, inspeções, housekeeping) |
| 2 | **Recriar pod sem host pin**, deixando o RunPod escalonar onde houver capacidade dentro do mesmo DC | Affinity pod↔host (não DC) | Quando 1 não se aplica (ex.: precisa GPU para validação real) |
| 3 | **Retry passivo com backoff** (cron periódico até suceder) | Nenhuma — espera capacidade aparecer | Apenas como ponte enquanto 1 ou 2 são preparados; nunca como solução |

**Anti-pattern:** Migrar volume para outro DC como reação tática a este sintoma. Migração requer ADR próprio (ver Pivot Criteria).

### Gotcha 2: Imagens minimal Python (e similares) não bootstrappam em RunPod CPU pods

**Causa raiz:** RunPod injeta `PUBLIC_KEY` env e exige `sshd` na porta 22 para o handshake de orquestração. Imagens minimais sem `sshd` ficam com `runtime.uptimeInSeconds: -2` indefinidamente.

**Mitigação:** Usar `runpod/cpu-base` (ou imagem com `sshd` pré-instalado) para qualquer CPU pod.

### Gotcha 3: `pod.sh` cria pods com host affinity por default

**Impacto:** Pod permanece pinado mesmo após termination + recreate da configuração. Se o host pinado degrada, o pod continua tentando ressuscitar nele.

**Mitigação:** TD-5.1.5 (já registrado) deve incluir auditoria de `pod.sh` para tornar host pin **opt-in** em vez de default.

### Gotcha 4: Deploy checklist Step 1 assume GPU pod para download

**Impacto:** Amplifica Gotcha 1 — download (I/O-bound) compete com inferência (GPU-bound) pelo mesmo inventário do DC primário.

**Mitigação:** Atualização cosmética de `docs/deploy/qwen-2509-deploy-checklist.md` Step 1 para listar Path 1 (CPU image) como caminho preferencial. Tracking: PR follow-up após este ADR.

---

## Consequences

### Positivas

- **Single-DC mantém custo de armazenamento mínimo** (1× storage à taxa padrão do provider) — alinhado com volume de produção atual
- **Article IV restaurado** — decisão arquitetural agora rastreada em arquivo canônico, não apenas em memória de agente
- **Mitigações operacionais codificadas** dão ao @devops um runbook explícito de ordem-de-tentativa, removendo decisão tática durante incidentes
- **Pivot Criteria mensuráveis** transformam re-avaliação em gate automático, não em julgamento ad-hoc

### Negativas (aceitas conscientemente)

- **Single-point-of-failure de DC** persiste até Pivot Criteria disparar. Toda a inferência de produção (T2I + i2i) está no DC primário; degradação prolongada do DC paralisa o produto
- **Sem failover automático.** Não há plano de continuidade que não envolva intervenção manual (recreate pod, re-mount, eventualmente migrar volume)
- **Reincidência conhecida não-mitigada.** Aceitamos que uma 3ª ocorrência é provável dentro do próximo ciclo de inventário do DC; mitigamos *operacionalmente*, não *arquiteturalmente*
- **Custo de migração futura é maior do que se tivéssemos provisionado multi-DC desde o início.** Aceitamos pagar este custo se Pivot Criteria justificar

### Neutras

- **Pods de development (`pod.sh`)** podem manter host pin durante a vigência deste ADR; auditoria de tornar opt-in vai para TD-5.1.5
- **Pesos de modelo continuam centralizados em `/runpod-volume/ComfyUI/models/`** sem mudança de path

---

## Pivot Criteria (90-day review — target 2026-07-29)

Este ADR **deve ser revisado** se qualquer um dos critérios abaixo for disparado, **antes** da revisão de 90 dias:

| # | Critério | Mensuração | Ação |
|---|---|---|---|
| 1 | **Múltiplos incidentes de capacidade no mesmo DC dentro de janela rolante de revisão** | Contagem de issues GitHub com label `infra-runpod-capacity` ou referência a "not enough free GPUs" em logs do `@devops` | Iniciar ADR-0006 (DC migration strategy) |
| 2 | **Incidente com duração estendida sem resolução em mesmo turno operacional** | Timestamp de abertura vs timestamp de resolução em issue de capacidade | Acionar Path 1 (multi-DC tático) imediatamente; iniciar ADR-0006 em paralelo |
| 3 | **SLA de deploy excedido em sprints consecutivos** por bloqueio de capacidade | Sprint-end review revela PRs bloqueados em deploy por motivo de capacidade RunPod | Iniciar ADR-0006 |
| 4 | **RunPod anuncia descontinuação ou degradação estrutural do DC primário** | Comunicação oficial do vendor (status page, email, blog) | Iniciar ADR-0006 imediatamente; janela de migração planejada antes do EOL anunciado |

**Disparo de qualquer critério obriga:**
1. Comentário de status no issue raiz que disparou (ou abertura de issue de tracking se foi o critério #4)
2. Atualização da seção `Status` deste ADR para `🔶 Under Re-evaluation`
3. Inicialização de ADR-0006 dentro de 1 sprint

---

## Alternatives

### Alternativa A — Migrar `<NETWORK_VOLUME_ID>` para outro DC agora

**Descrição:** Provisionar volume novo em DC alternativo, copiar todos os pesos via pod intermediário, atualizar `serverless/deploy.sh` e templates RunPod para apontar ao novo volume, deprovisionar o atual.

**Por que rejeitada (hoje):**
- Sem dados de capacidade real do DC alternativo, troca um DC ruim por possivelmente outro DC ruim
- Blast radius portfólio inteiro (T2I + i2i + futuras apps) por um sintoma ainda contido
- Janela operacional de migração + risco de downtime durante swap de templateId
- Custo de re-download dos pesos entre DCs, dependendo de cobrança de egress

**Quando reconsiderar:** Pivot Criteria #1, #2, #3 ou #4 disparado.

### Alternativa B — Multi-DC com volume replicado

**Descrição:** Provisionar 3 volumes nomeados (DC primário + 2 alternativos), com pesos sincronizados manualmente. Endpoints serverless escolhem volume conforme DC do worker.

**Por que rejeitada (hoje):**
- 3× custo de armazenamento por benefício marginal no volume atual
- Sincronização manual cria risco de drift de pesos entre DCs (hash mismatch → inferência divergente)
- Complexidade de orquestração que RunPod não oferece nativamente

**Quando reconsiderar:** Volume de produção atinge `<<scale threshold>>` em reqs/mês (custo de redundância dilui-se) **ou** SLA de uptime contratual exigir failover automático.

### Alternativa C — Bake pesos na imagem Docker (eliminar volume)

**Descrição:** Voltar à decisão rejeitada de ADR-0001 Path B — empacotar `flux1-schnell` + `qwen_image_*` direto na imagem `gemma4-flux-serverless`.

**Por que rejeitada:**
- Imagem cresce muito além do AC2 da Story 2.1 (<15 GB)
- Cold start de pod aumenta proporcionalmente ao pull da imagem maior
- Cada bump de modelo (ex.: Qwen 2509) requer re-build + re-push da imagem, multiplicando overhead de release
- ADR-0001 já rejeitou este path com análise quantitativa

**Quando reconsiderar:** Nunca, no escopo deste ADR. Decisão estrutural separada se algum dia precisar.

### Alternativa D — Provider alternativo (Modal, Replicate, fly.io GPU)

**Descrição:** Migrar inferência inteira para outro provider serverless com volume management diferente.

**Por que rejeitada (hoje):**
- Escopo muito além de `<NETWORK_VOLUME_ID>` — afeta ADR-0001, ADR-0003, ADR-0004, todo o handler, deploy scripts, SDK
- Sem dados de que provider alternativo resolve o problema de capacidade (provider X pode ter o mesmo padrão em região Y)
- Constitutional Article IV — não há evidência empírica neste codebase para justificar

**Quando reconsiderar:** TD-5.1.5 (RunPod platform investigation post-pivot) deve incluir benchmark mínimo de 1 provider alternativo. Se RunPod falhar no Pivot Criteria #4, esta alternativa volta a ser viável.

---

## References

- `docs/architecture/adr-0001-flux-cold-start.md` — decisão original que provisionou o volume canônico (Story 2.1, Path A)
- `docs/architecture/adr-0003-image-to-image-model-selection.md` — segundo consumidor do volume (Qwen-Image-Edit)
- `docs/deploy/qwen-2509-deploy-checklist.md` — Step 1 bloqueado por este acoplamento; cosmético update pendente para citar Path 1 (CPU image)
- TD-5.1.5 — RunPod platform investigation (registrado em backlog de tech debt)
- Incidente de capacidade RunPod (1ª ocorrência) — referenciado em issue tracking, contexto histórico do pivô estratégico

---

## Change Log

| Versão | Data | Autor | Mudanças |
|---|---|---|---|
| 1.0 | 2026-04-29 | @architect (Aria) | Initial — Accepted. Formaliza acoplamento volume↔DC já em vigor desde Story 2.1, codifica 3 mitigações operacionais e 4 critérios de pivô observáveis. Restaura Article IV (No Invention) compliance — referências prévias a "ADR-0005 v1.2" em memória do projeto não tinham arquivo canônico correspondente. |
