# Stable Diffusion 3.5 Large — $1M ARR Cliff: Memo de Decisão

| Campo | Valor |
|---|---|
| **ID** | FU-6.1 |
| **Status** | ✅ Decided — REJECT (with watch-list) |
| **Data** | 2026-05-07 |
| **Autor** | @pm (Morgan) |
| **Trigger** | Epic 6 closure / ADR-0006 Open Threads (handoff de @po em 2026-05-07) |
| **Origem** | Brainstorm 2026-05-06 — Path 2 deferida durante seleção HiDream-I1 |
| **Tipo** | Decision memo (não-PRD) — match com a especificação leve do backlog |
| **Audiência** | @architect (próximo brainstorm), @analyst, @po (gestão do backlog) |

---

## 1. Pergunta

> **A cláusula de "commercial license required at $1M annual revenue" da Stability Community License é aceitável para servegate na trajetória alpha → tier paid? Em qual prazo? Se aceitável, SD 3.5L re-entra como candidato no próximo brainstorm de seleção de modelo. Se não, Path 2 fica fechada e apenas Path 3 (fal.ai proxy) permanece em campo.**

Saída requerida: verdict binário `Accept` / `Reject` com justificativa arquitetural rastreável até `recommended-approach.md`.

---

## 2. Contexto — License Fine-Print (verbatim, fetched 2026-05-07)

### 2.1 Fonte primária

`https://stability.ai/community-license-agreement` (Stability Community License — texto oficial em vigor em May 2026).

### 2.2 Cláusula do cliff (verbatim)

> *"generate more than USD $1,000,000 in annual revenue (or the equivalent thereof in Your local currency)"*
>
> *"…whether that revenue is generated **directly or indirectly** from the Stability AI Materials or Derivative Works"*
>
> *"…You or Your Affiliate(s), either individually **or in aggregate**"*

### 2.3 Mecânica do gatilho (verbatim)

> *"any licenses granted to You under this Agreement shall **terminate as of such date**. You must request a license from Stability AI, which Stability AI **may grant to You in its sole discretion**."*

**Sem grace period. Sem direito a continuação. Re-licenciamento é discricionário pela Stability AI.**

### 2.4 Obrigações adicionais (concorrentes ao cliff)

| Obrigação | Substância |
|---|---|
| Atribuição obrigatória | *"prominently display 'Powered by Stability AI'"* em website, UI, blogpost, about page ou docs |
| Notice de copyright | *"Copyright © Stability AI Ltd."* preservado |
| Acceptable Use Policy | Aderência obrigatória ao AUP da Stability AI |
| Não-competição | Proibido usar materiais para criar modelos generativos foundation concorrentes |
| Trade Control Laws | Conformidade obrigatória |

### 2.5 License Stack Audit (gate per memory `feedback_brainstorm_license_audit`)

Componentes do pipeline `StableDiffusion3Pipeline` (verificados via HuggingFace model card 2026-05-07):

| Componente | Origem | Licença | Status |
|---|---|---|---|
| MMDiT (transformer) | `stabilityai/stable-diffusion-3.5-large` | **Stability Community License** | 🔴 Cliff $1M ARR + AUP + atribuição |
| VAE | bundled no repo | **Stability Community License** | 🔴 Mesmo cliff |
| Text Encoder #1 — OpenCLIP-ViT/G | `mlfoundations/open_clip` | MIT-compatible | 🟢 Aceitável |
| Text Encoder #2 — CLIP-ViT/L | `openai/CLIP` | MIT | 🟢 Aceitável |
| Text Encoder #3 — T5-xxl | `google/t5-v1_1-xxl` | Apache 2.0 | 🟢 Aceitável |

**Composite license (most-restrictive component):** Stability Community License.

Diferentemente do caso HiDream-I1 (onde o componente venenoso era o text encoder Llama), aqui o componente venenoso são **os pesos centrais** (MMDiT + VAE) — não há possibilidade conceitual de "swap por encoder limpo". Removendo a Stability Community License do stack, não sobra modelo.

---

## 3. Projeção de Receita servegate (abstract — detail no private mirror)

> 🔒 **Public-repo sanitization note:** seguindo o padrão de [`cost-model-text-gen.md`](../architecture/cost-model-text-gen.md), as projeções numéricas concretas (volumes, $/mês, trajetória de receita por trimestre) são preservadas no mirror privado `Jhonata-Matias/servegate-planning`. Abaixo, apenas as abstrações suficientes para a decisão arquitetural pública.

### 3.1 Cenários considerados (qualitativos)

Três cenários foram analisados, ancorados na alpha policy atual (rate-limit global, free-tier KV CF, Phase 0 cost-ceiling) e na trajetória prevista de monetização pós-alpha:

| Cenário | Trajetória | Cliff alcançado? | Prazo aproximado |
|---|---|---|---|
| **Conservador** | Stagnação alpha indefinida | Improvável | N/A |
| **Base** | Alpha → first-paying tier (post-launch ~v0.5+) | Possível eventualmente | Multi-anos |
| **Agressivo** | Alpha → paid tier rápido + crescimento de portfólio | Provável | Curto-médio prazo |

**Observação importante para o cliff:** a cláusula **"directly or indirectly"** + **"in aggregate"** significa que, no momento em que SD 3.5L for embarcado em qualquer rota servegate (T2I premium, fallback de regulamentado, etc.), **toda a receita servegate consolidada conta** — text-gen (Epic 4), I2V (Epic 5), I2I (Epic 3), embeddings, e qualquer modalidade futura. Não é possível segregar "receita-do-SD-3.5L" de "receita-do-resto".

Isso implica que servegate, ao ofertar SD 3.5L mesmo em uma única rota minoritária, herda o cliff sobre o portfólio inteiro.

### 3.2 Onde a projeção mora

- Mirror privado: `Jhonata-Matias/servegate-planning` (`docs/decisions/2026-05-07-sd35l-arr-cliff-memo.private.md` — a ser criado pelo owner se necessário)
- Workbook de unit economics: por hora, mantido fora do repo (planilha do owner)

---

## 4. Análise do Cliff

### 4.1 Three-question framework

Para julgar aceitabilidade, três perguntas independentes:

#### 4.1.1 É um cliff financeiro ou um cliff arquitetural?

**Arquitetural.** Não é "pague mais ao atingir $1M" (cliff financeiro modelável). É **license termination automática + re-licenciamento discricionário pela Stability AI** (cliff arquitetural / vendor-approval gate). Análogo ao caso HiDream-I1 com Llama 3.1 (700M MAU + AUP discricionário) — o gating não é uma planilha, é uma condição que o vendor controla unilateralmente.

#### 4.1.2 Qual o engineering cost de mitigar pós-cliff?

Migrar o servegate para um modelo licença-limpo no momento em que o cliff for atingido **enquanto o produto está em produção** seria custoso em quatro vetores:

1. **Re-treino de prompt/parameter library** — usuários alpha consolidam "qual prompt funciona em qual modelo". Trocar modelo = invalidar essa biblioteca.
2. **Quality regression risk** — se o substituto não atinge paridade, percepção de qualidade degrada visivelmente.
3. **Operational migration** — pesos diferentes na network volume (~16-20 GB upload/download), Docker image rebuild, smoke-tests, rollback playbook, tudo sob pressão de "license terminated".
4. **Comunicação para clientes** — explicação de troca de modelo + atribuição mudando, em janela apertada.

Soma das estimativas: ~3-7 dev-days + risco de quality regression. **Pago num momento desfavorável (já em escala, com receita em jogo).**

#### 4.1.3 Existe alternativa licença-limpa hoje?

Sim — fal.ai / Replicate proxy (Path 3, FU-6.2) consome FLUX dev / Imagen / etc. via SaaS. Margem-tax 30-50%, mas:
- License-clean (consumer de hosted SaaS, não redistribuidor de pesos)
- Sem cliffs no portfólio
- Operational simplicity (sem GPU spend, sem network volume, sem cold-start)
- Trade-off: perpetual per-image invoice + vendor-lock

Path 3 não é aspiracional — é o **fallback realista existente hoje**.

### 4.2 Pattern matching vs precedentes

A constituição informal do servegate, codificada em ADR-0003 line 22:

> *"Commercial license required day one, across the product portfolio. Not a SaaS-TOS license from a hosted API provider, but a license on the model weights that permits perpetual commercial redistribution across multiple products without per-seat / per-MAU caps and without vendor approval rails."*

Confronto direto com cada cláusula da Stability Community License:

| ADR-0003 commitment | Stability Community License | Match? |
|---|---|---|
| "Perpetual commercial redistribution" | Termina em $1M aggregate revenue | ❌ |
| "Without per-seat / per-MAU caps" | $1M revenue cap (análogo) | ❌ |
| "Without vendor approval rails" | Re-licenciamento na sole discretion da Stability | ❌ |
| "Across multiple products" | "Directly or indirectly" + "in aggregate" sobre o portfólio | ❌ |

**4 de 4 cláusulas violadas.** Mesmo padrão arquitetural que rejeitou:
- HiDream-E1.1 (Llama Community, ADR-0003 alternatives-rejected)
- HiDream-I1 Dev (Llama Community, ADR-0006, 2026-05-07 — instância imediatamente anterior)
- FLUX dev / Kontext / Fill / Redux (FLUX Non-Commercial, ADR-0003)
- BFL hosted API (vendor-controlled SaaS TOS, ADR-0003)
- SD 3.5 Medium/Large (Stability Community, ADR-0003 alternatives-rejected — **mesma decisão sendo agora reconfirmada**)

Aceitar SD 3.5L agora seria a **terceira inversão consecutiva** da posição arquitetural sobre license-stack veto, dois dias após formalizar o gate na ADR-0006.

### 4.3 Argumento contra (steel-man do "Accept")

Foi considerado: **"servegate vai demorar muito para chegar a $1M ARR; aceitar o cliff dá quality boost imediato; trocamos depois"**.

Razões para rejeitar este argumento:

- O cliff não é "pague mais", é **license terminated** — o produto fica em violação enquanto a discussão com Stability acontece. Risco regulatório/contratual com clientes corporativos.
- A cláusula "indirectly" amplia o cliff para **toda a receita servegate**, não só receita do SD 3.5L — colocando em risco modalidades já em produção (text-gen, video).
- Pattern coherence custa baixa: quando há um modelo com a mesma promessa de qualidade sob licença limpa (Path 3 proxy via fal.ai), a regressão de aceitação é puramente uma compressão de margin tax — modelável e reversível, ao contrário de license termination.
- Article IV (No Invention) e Article V (Quality First) da AIOX Constitution: aceitar uma licença que viola portfolio commitment para ganhar quality boost de curto prazo desestabiliza a base arquitetural justamente em momentos de growth.

---

## 5. Decisão

> ### ✅ **REJECT — SD 3.5L (Stable Diffusion 3.5 Large) não re-entra como candidato em próximo brainstorm de seleção de modelo T2I para servegate, sob a licença atual (Stability Community License em vigor 2026-05-07).**

**Implicações imediatas:**

1. **Path 2 do brainstorm 2026-05-06 está fechada.** Próximo model-selection brainstorm parte de um espaço reduzido a Path 3 (proxy hosted) + watch-list para emergências de novos candidatos Apache.
2. **FU-6.1 (este memo) — entregue.** Backlog atualizado para CLOSED.
3. **FU-6.2 (Path 3 economics) ganha prioridade efetiva** — torna-se a única alternativa de quality tier com licença limpa em campo. Recomendação: ser executada antes do próximo brainstorm.
4. **Watch-list condicionado** — ver §6.2 abaixo.
5. **Nenhuma mudança em produção.** Decisão é documental, sem impacto em código, infra, ou contratos vigentes.

### 5.1 Confiança da decisão

- **Architectural reasoning:** alta — license-stack audit é evidência primária verbatim, recém-fetched.
- **Trajectory dependence:** baixa — decisão é robusta a qualquer cenário de receita por causa da cláusula "directly or indirectly" + automatic termination + discretionary re-licensing. Não há trajetória observável onde o cliff é confortável.
- **Reversibility:** alta — se Stability mudar termos, este memo é re-aberto via watch-list (§6.2).

---

## 6. Implicações Estratégicas

### 6.1 Próximo brainstorm de seleção de modelo

Quando convocado, o próximo brainstorm parte com:

- **Path 1 (HiDream-I1 family):** rejeitada via ADR-0006 (Llama 3.1 Community) — só re-entra se watch-list HiDream disparar.
- **Path 2 (SD 3.5 Large):** rejeitada via este memo (Stability Community $1M cliff) — só re-entra se watch-list Stability (§6.2) disparar.
- **Path 3 (fal.ai proxy):** candidata default. Bloqueador para candidatura: economics revisitada via FU-6.2.
- **Novos candidatos Apache:** qualquer modelo lançado entre 2026-05-07 e a data do próximo brainstorm que satisfaça License Stack Audit puro Apache (e.g., Sana 1.5, Lumina-Image 2.0, Z-Image-Edit, Step1X-Edit, ou novidade ainda não lançada).

**Recomendação de cadência:** próximo brainstorm não deve ser convocado **até FU-6.2 estar fechada** (Path 3 economics modeladas), para evitar repetir o erro de 2026-05-06 (decisão sobre path principal sem custo concreto da fallback).

### 6.2 Watch-list — condições para re-abertura de SD 3.5L

| Condição | Re-abertura? | Owner | Notas |
|---|---|---|---|
| Stability AI relança SD 3.5L sob Apache 2.0 puro (ou MIT) | ✅ SIM | @architect | License Stack Audit completo + nova brainstorm session |
| Stability AI remove o cliff $1M sem substituí-lo por outro vendor-approval gate | ✅ SIM | @architect | Re-leitura do termo + audit |
| Stability AI publica termos commercial-license públicos previsíveis (sem "sole discretion"), com preço fixo modelável | 🟡 TALVEZ | @pm | Vira decisão de economics (FU análogo a FU-6.2), não architectural — pode ser elegível como tier premium pago |
| Stability AI altera a cláusula "directly or indirectly" para excluir receita de outras modalidades não-SD | 🟡 TALVEZ | @architect | Reduz materialidade do cliff; re-avaliar |
| Tempo isolado (6m, 12m, 24m, 36m) | ❌ NÃO | — | Tempo não é fato arquitetural (mesma lógica de ADR-0006) |
| Servegate atinge ou se aproxima de $1M ARR no cenário base | ❌ NÃO | — | Não inverte a lógica — reforça (mais a perder com termination event) |

**Watch cadence:** @architect re-checks na convocação de cada novo brainstorm de seleção de modelo de imagem.

### 6.3 Atualizações em outros documentos

| Documento | Atualização requerida |
|---|---|
| `docs/architecture/recommended-approach.md` | Linha 72 já marca "SD 3.5 Medium/Large | Stability Community ($1M cap) | Not pure commercial". Pode-se adicionar referência cruzada a este memo (não-bloqueador). |
| `docs/stories/backlog.md` | FU-6.1 → CLOSED com link para este memo (executado neste handoff). |
| `docs/architecture/adr-0006-hidream-i1-poc-verdict.md` | Open Thread "SD 3.5L $1M ARR cliff impact assessment" → CLOSED via este memo (atualização opcional). |
| Memória `feedback_brainstorm_license_audit` | Já registrada — este memo é prova-de-aplicação do gate. |

### 6.4 Ausência de impacto em código/infra

- ✅ Zero alteração em `serverless/handler.py`
- ✅ Zero alteração em `gateway/`
- ✅ Zero alteração em `sdk/`
- ✅ Zero alteração em RunPod endpoints
- ✅ Zero alteração em Cloudflare Workers KV / R2
- ✅ Zero alteração em qualquer caminho de produção atual (FLUX schnell T2I, Qwen-Image-Edit i2i, Gemma text-gen, LTX-Video I2V)
- ✅ Zero gasto de orçamento (decisão documental)

---

## 7. Referências

### Primárias

- [Stability AI Community License](https://stability.ai/community-license-agreement) — texto oficial verbatim, fetched 2026-05-07
- [stabilityai/stable-diffusion-3.5-large model card](https://huggingface.co/stabilityai/stable-diffusion-3.5-large) — License Stack Audit source, fetched 2026-05-07

### Internas — instâncias próximas do mesmo padrão

- [`adr-0006-hidream-i1-poc-verdict.md`](../architecture/adr-0006-hidream-i1-poc-verdict.md) — REJECT precedent (Llama 3.1 Community), 2026-05-07
- [`adr-0003-image-to-image-model-selection.md`](../architecture/adr-0003-image-to-image-model-selection.md) — Portfolio commitment formal codification, 2026-04-23
- [`recommended-approach.md`](../architecture/recommended-approach.md) — alternatives-rejected table, line 72 (SD 3.5 Medium/Large rejection precedent)

### Internas — origem deste FU

- [`docs/brainstorms/2026-05-06-open-source-image-generation-model.md`](../brainstorms/2026-05-06-open-source-image-generation-model.md) — Path 2 (SD 3.5L) deferred during HiDream-I1 selection
- [`docs/stories/backlog.md`](../stories/backlog.md) — FU-6.1 entry (Created: 2026-05-07 by @po)

### Memória relevante

- `feedback_brainstorm_license_audit` — License Stack Audit gate (gate aplicado neste memo)
- `feedback_pre_public_audit` — sanitization rules para projeções numéricas (aplicado em §3)

### Companion / next steps

- **FU-6.2** (Path 3 fal.ai proxy economics) — backlog priority elevated as effective consequence of this memo
- **TD-6.1** (codify License Stack Audit in brainstorming-output template) — backlog item já registrado; este memo serve como evidência de uso

---

## Change Log

| Data | Autor | Mudança |
|---|---|---|
| 2026-05-07 | @pm (Morgan) | Criação inicial. REJECT verdict via License Stack Audit + portfolio commitment confronto. Closes FU-6.1. |
