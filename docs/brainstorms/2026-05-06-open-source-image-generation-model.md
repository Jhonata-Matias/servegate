# Brainstorming Session Results — Open-Source Image Generation Model

**Session Date:** 2026-05-06
**Facilitator:** 🔍 Atlas (Decoder), Business Analyst
**Participant:** Jhonata Matias
**Branch context:** `docs/index-video-mention` · post Story 5.2 (video gateway shipped)

---

## Executive Summary

**Topic:** Selecionar/explorar modelo open-source de geração de imagem para integrar ao gemma4-gateway, expandindo a stack atual (text + embeddings + I2V via LTX-Video) para incluir T2I como 5ª modalidade.

**Session Goals:** Ideation (divergir amplo) com contexto operacional definido — reusar o pattern Servegate gateway estabelecido na Story 5.2 (RunPod serverless + R2 signed URLs + capability discovery + SDK).

**Techniques Used:**
1. Question Storming (20 perguntas críticas em 5 dimensões)
2. Critical Filtering (top 5 perguntas com maior alavancagem decisória)
3. Multi-Path Synthesis (3 paths defensáveis)
4. Assumption Reversal (stress-test do lean inicial após feedback de qualidade)
5. Deep Dive (drill estruturado em HiDream-I1 Dev)

**Total Ideas Generated:** 20 perguntas + 7 modelos candidatos + 3 paths estratégicos + 4 spikes de validação = **34 elementos acionáveis**

### Key Themes Identified
- **Qualidade > velocidade** é o eixo prioritário (rejeição explícita de Flux schnell)
- **Apache-2.0 puro** é a baixa de licença preferida (zero cliffs comerciais)
- **Pattern reuse da Story 5.2** é restrição operacional (RunPod + R2 + capability discovery)
- **Cold start** é trade-off material entre UX (rápido) e custo (warm pod)
- **Ecosystem maturity** de ControlNet/IP-Adapter define se MVP é T2I-only ou full
- **Procedência geopolítica** importa para clientes US-gov/EU regulamentados

---

## Technique Sessions

### Sessão 1 — Question Storming (20 perguntas, 5 dimensões)

**Description:** Antes de gerar respostas, mapear o espaço de incerteza. Perguntas afiadas em 5 dimensões: Modelo & Capacidade, Licença & IP, Infra & Custo, Integração & UX, Estratégia & Roadmap.

**Insights Discovered:**
- O problema não é "qual modelo escolher" — é "qual constraint binda primeiro"
- Licença e cold start são as restrições mais alavancadas
- Contrato SDK é decisão semi-permanente (breaking change risk)

### Sessão 2 — Top 5 Críticas (Atlas Selection)

**Description:** Filtrar das 20 perguntas as 5 com maior alavancagem decisória — aquelas cuja resposta destrava 5+ outras e cujo erro custa retrabalho assimétrico.

**Perguntas selecionadas:**
1. **Q6** — Licença comercial (BLOQUEADORA TOTAL)
2. **Q1** — Classe de output prioritária (ASSIMÉTRICA)
3. **Q11** — Cold start aceitável (BLOQUEADORA UX)
4. **Q13** — Endpoint dedicado vs multiplexado (ALAVANCADA)
5. **Q16** — Contrato SDK (BREAKING CHANGE RISK)

**Insights Discovered:**
- Workers AI catalog hospeda só modelos tier 2 (Flux schnell, SDXL) — incompatível com a constraint de qualidade
- T2I tem expectativa de UX 2-3x mais rápida que I2V
- SDK híbrido sync/async é Pareto-ótimo (cobre 90% dos casos sem fechar futuras opções)

### Sessão 3 — Assumption Reversal (Stress-Test do Lean Inicial)

**Description:** Após feedback "Flux schnell não é suficiente, preciso mais qualidade", reverter cada premissa do lean composto inicial.

**Resultado:** 4 dos 5 leans caíram. Apenas o contrato SDK híbrido sobreviveu. Reconstrução necessária com tier de qualidade superior.

**Notable Connections:**
- "Qualidade alta + Apache-2.0 + comercial OK" forma um triângulo restritivo que elimina Flux dev (non-commercial), Pony/NoobAI (licenças venenosas), Workers AI (sem top-tier)
- HiDream-I1 emerge como única opção que satisfaz os 3 vértices simultaneamente

### Sessão 4 — Multi-Path Synthesis (3 caminhos defensáveis)

**Description:** Após reversão, mapear 3 paths estratégicos com filosofias distintas: best open / pragmatic premium / rent quality.

**Ideas Generated (Modelos candidatos qualidade-first):**
1. HiDream-I1 Full (17B MoE, Apache-2.0, ★★★★★) — top open, alto custo infra
2. HiDream-I1 Dev (distilled, Apache-2.0, ★★★★½) — sweet spot
3. Stable Diffusion 3.5 Large (8B, Stability Community, ★★★★½) — cliff em $1M ARR
4. Sana 1.5 (NVIDIA, 4.8B, Apache-2.0, ★★★★) — eficiente, qualidade boa
5. Lumina-Image 2.0 (2.6B, Apache-2.0, ★★★★) — pequeno + qualidade
6. Kolors (Kuaishou, 2.6B, comercial OK, ★★★½) — bilíngue
7. Flux.1 dev via proxy fal.ai/Replicate (★★★★★, margin tax 30-50%)

### Sessão 5 — Deep Dive HiDream-I1 Dev

**Description:** Após escolha do Path 1, drill estruturado em 6 dimensões: anatomia, hardware/custo, ecosystem gap, benchmarks, integração no gateway pattern, riscos.

**Insights Discovered:**
- L40S (48GB VRAM, ~$0.79/h serverless) é sweet spot operacional — FP16 confortável, custo/imagem ~$0.001-0.002
- Cold start estimado 30-60s para 17B params — exige flashboot ou warm pod tier
- Ecosystem ControlNet/IP-Adapter é **6-12 meses atrás** de Flux/SDXL — MVP precisa ser T2I-only
- Procedência chinesa (HiDream-AI) introduz vetor de compliance para clientes regulamentados
- Apache-2.0 nos weights ≠ training data clean — auditoria de model card é obrigatória

---

## Idea Categorization

### Immediate Opportunities
*Ideas ready to implement now*

1. **Spike PoC — HiDream-I1 Dev em RunPod L40S**
   - Description: Deploy controlado em ambiente de spike, validar inference real, cold start, custo/imagem
   - Why immediate: Sem PoC, qualquer commitment de Story é especulação. PoC é 1-2 dias de esforço.
   - Resources needed: 1 dev (+@architect consultoria), conta RunPod, ~$5-20 de GPU time

2. **Blind A/B blind vs Flux dev (via fal.ai)**
   - Description: 50 prompts diversos no domínio servegate (photorealistic + design assets), avaliação humana pareada
   - Why immediate: Resolve a incerteza de "HiDream realmente bate Flux dev?" — base para decisão final
   - Resources needed: ~$5 fal.ai créditos, 2-3h de avaliação humana, planilha de scoring

3. **Auditoria de model card + training data disclosure**
   - Description: Ler model card HiDream-I1 oficial, identificar disclosures de training data, mapear riscos de litigation/compliance
   - Why immediate: Apache-2.0 nos weights não cobre dados de treino. Servegate herda riscos via T&C.
   - Resources needed: 2-3h de @analyst (Atlas) + revisão @legal se aplicável

### Future Innovations
*Ideas requiring development/research*

1. **Story 5.3 — Image Generation Endpoint**
   - Description: Endpoint dedicado HiDream-I1 Dev no gateway, capability discovery extension, SDK `generateImage()` híbrido sync/async
   - Development needed: Novo Dockerfile (handler customizado), R2 lifecycle PNG/WebP, rate limiting com peso por resolução
   - Timeline estimate: 2-3 sprints após PoC validado

2. **Story 5.4 — Quotas + Observability Image Modality**
   - Description: Daily quota separada de video, métricas de cost/image, P50/P95 latency tracking, R2 signed URL TTL
   - Development needed: Pondera unit por resolução × steps (ex. 1024² @ 28 steps = 1 unit; 2K @ 50 steps = 4 units)
   - Timeline estimate: 1 sprint após Story 5.3

3. **Story 5.5 — ControlNet/IP-Adapter (quando ecosystem amadurecer)**
   - Description: Adicionar i2i, inpainting, ControlNet pose/depth/canny ao endpoint
   - Development needed: Aguardar comunidade portar ControlNet para HiDream (estimativa Q3-Q4 2026); novo handler routing
   - Timeline estimate: 2-3 sprints, dependente de external timing

### Moonshots
*Ambitious, transformative concepts*

1. **Multi-Model Capability Router**
   - Description: Router inteligente que escolhe modelo baseado em tag de prompt: photorealistic → HiDream, illustration → Sana, batch → Flux schnell
   - Transformative potential: Diferenciação real vs Replicate/fal.ai — eles são marketplaces, servegate vira "managed orchestration"
   - Challenges to overcome: 3x infra cost, complexidade de capability routing, manter qualidade consistente entre modelos

2. **Fine-tune servegate brand-pack**
   - Description: LoRA fine-tunada em estilo servegate/clientes enterprise, distribuído como capability premium
   - Transformative potential: Vendor lock-in positivo — "saída do servegate = perda de estilo treinado"
   - Challenges to overcome: Custo de training (~$500-2000 por LoRA), pipeline de curation de dataset, IP de datasets

3. **gemma4 LLM como prompt-rewriter pipeline**
   - Description: Usar gemma4 LLM próprio para reescrever prompts antes de gerar imagem (estilo Imagen 3 / DALL-E 3 prompt expansion)
   - Transformative potential: Combina text + image em pipeline único, melhora prompt adherence sem trocar modelo de imagem
   - Challenges to overcome: Latência adicional (+1-2s), tuning fino do prompt-rewriting, A/B comprovar que melhora qualidade

### Insights & Learnings

- **Constraint trinity:** Qualidade alta + Apache-2.0 + comercial OK reduz universo a essencialmente HiDream — implicação: monitorar lançamentos para opções alternativas (lock-in mitigation)
- **Pattern reuse paga:** Story 5.2 estabeleceu RunPod + R2 + capability pattern reusável — Story 5.3 herda ~70% da infra-as-code
- **Knowledge cutoff é risco:** HiDream lançou meados de 2025 — battle scars limitados, ecosystem em formação. Validação empírica não é opcional.
- **Ecosystem gap pode virar moat:** Ser early-mover em produção HiDream serializada cria expertise antes que Flux/SD-equivalente surja com licença limpa
- **Procedência chinesa precisa ser disclosure-by-default** no T&C para evitar surpresa em clientes US-gov/EU regulamentados

---

## Action Planning

### Top 3 Priority Ideas

#### #1 Priority: Spike PoC HiDream-I1 Dev
- **Rationale:** Toda decisão downstream (Story 5.3, infra commitment, SDK design) depende de validar empiricamente o lean composto. Sem PoC, é especulação.
- **Next steps:**
  1. @devops provisiona pod L40S serverless RunPod
  2. @dev escreve handler mínimo (T2I-only, Diffusers backend)
  3. @analyst (Atlas) define 50 prompts de teste (photorealistic + design assets)
  4. Medir: cold start P50/P95, inference time, custo/imagem, qualidade subjetiva
- **Resources needed:** 1 dev, ~$5-20 GPU time, 1-2 dias
- **Timeline:** Próximo sprint (1-2 dias de esforço)

#### #2 Priority: Blind A/B HiDream Dev × Flux dev
- **Rationale:** Feedback explícito "Flux não é suficiente" precisa de validação numérica antes de commitar. Se HiDream Dev empatar com Flux dev, decisão é segura. Se ficar abaixo, voltar ao tabuleiro.
- **Next steps:**
  1. Selecionar 50 prompts representativos (mix de cenários reais de cliente)
  2. Gerar pares HiDream Dev (PoC) × Flux dev (fal.ai proxy)
  3. Avaliação blind por 2-3 humanos, scoring 1-5 em: aesthetic, prompt adherence, artifact-free
  4. Calcular win rate; aceitar HiDream se >= 45% (paridade) considerando licença favorável
- **Resources needed:** ~$5 fal.ai, 3-4h humano, planilha scoring
- **Timeline:** Mesmo sprint do PoC (paralelo)

#### #3 Priority: Handoff para @pm — Epic Image Generation
- **Rationale:** Brainstorm forneceu insumo suficiente para criação de Epic. Próximo passo na cadeia AIOX é @pm definir escopo, KPIs e sequenciamento de stories.
- **Next steps:**
  1. @pm consome este doc + outputs do PoC (quando prontos)
  2. @pm executa `*create-epic` com brief consolidado
  3. Epic propõe Stories 5.3 → 5.4 → 5.5 (T2I → quotas/obs → ControlNet)
  4. @sm cria primeira story (Story 5.3) seguindo SDC workflow
- **Resources needed:** @pm 2-4h, @sm 1-2h após PoC
- **Timeline:** PoC → Epic creation (1 sprint) → Story 5.3 draft (sprint seguinte)

---

## Reflection & Follow-up

### What Worked Well
- Question Storming antes de Idea Generation expôs constraints invisíveis (licença trinity)
- Feedback do usuário "Flux não é suficiente" matou um lean precoce — Assumption Reversal recuperou rapidamente
- Estruturação por path (Best Open / Pragmatic Premium / Rent Quality) deu vocabulário compartilhado para escolha
- Honesty markers ⚠️ verify destacaram onde knowledge cutoff exige validação empírica

### Areas for Further Exploration
- **HiDream training data disclosure:** Auditoria de model card pendente, pode invalidar escolha se houver red flags de litigation
- **ControlNet ecosystem timing:** Quando comunidade portará para HiDream? Decisão pode antecipar Story 5.5 ou empurrá-la para Q4 2026
- **Cold start mitigation:** Flashboot resolve? Ou exige warm pod tier diferenciado por plano (Free vs Pro)?
- **Procedência chinesa + compliance:** Mapeamento explícito de quais clientes/segmentos exigem alternativa (ex. fallback SD 3.5L para regulamentados)
- **Workers AI catalog evolution:** CF pode adicionar HiDream/SD3.5 no futuro próximo — rever decisão se acontecer

### Recommended Follow-up Techniques
- **First Principles** sobre cold start: o que UX realmente exige? Onde o usuário tolera espera vs onde abandona?
- **Role Playing** com personas: dev integrando SDK, ops monitorando custos, cliente final esperando imagem
- **Five Whys** sobre licença Apache-2.0 strict: por que esse é o piso? Há cenários onde Stability Community License é aceitável?

### Questions That Emerged
- HiDream-I1 tem versão "Image Edit" (E1) — entra no escopo do MVP ou Story separada?
- Quais formatos de output suportar? PNG (qualidade), WebP (tamanho), AVIF (futuro)? Multi-format na mesma request?
- Streaming de progresso de denoising é diferenciador suficiente para complexidade extra no SDK?
- Hash-cache no R2 (mesmo prompt + seed + params = mesma URL) é otimização viável ou viola UX (clientes esperam unicidade)?
- Como precificar: por imagem fixa, ou ponderado por resolução × steps?

### Next Session Planning
- **Suggested topics:**
  1. Pós-PoC: revisão dos resultados empíricos + decisão final de modelo
  2. Cold start strategy deep-dive (flashboot vs warm pod tiers)
  3. SDK contract design (`generateImage` shape + capability discovery extension)
- **Recommended timeframe:** 1-2 semanas após início do PoC
- **Preparation needed:**
  - PoC results (latência, custo, qualidade subjetiva)
  - Blind A/B scoring planilha
  - Auditoria de model card concluída
  - Draft de Epic do @pm para validação cruzada

---

## Handoff para @pm (Morgan)

**Trigger sugerido:** `@pm *create-epic` com input deste doc + resultados do PoC.

**Brief consolidado para Epic:**
- **Nome sugerido:** "Epic 6 — Image Generation Modality (Servegate Gateway)"
- **Goal:** Adicionar T2I como 5ª modalidade ao gemma4-gateway, mantendo pattern reuse Story 5.2
- **Modelo recomendado:** HiDream-I1 Dev (Apache-2.0, distilled, L40S serverless)
- **Pré-condições para start:** PoC validado + auditoria model card OK
- **Stories esperadas:** 5.3 (T2I endpoint + SDK) → 5.4 (quotas/obs) → 5.5 (ControlNet, dependent timing)
- **Riscos top:** Cold start UX, ecosystem maturity, procedência geopolítica, training data disclosure
- **KPIs propostos:** P95 cold start <30s, P50 inference <5s, custo/imagem <$0.005, qualidade A/B win rate >=45% vs Flux dev

---

*Session facilitated using the AIOX-Method brainstorming framework — Atlas the Decoder*
