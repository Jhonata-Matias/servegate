# Epic 1 — Pod Inference Stack

**Status:** Draft
**Owner:** @pm (Morgan)
**Created:** 2026-04-20
**Project:** gemma4

---

## Goal

Estabelecer e operar um stack de inferência multi-modalidade (texto + imagem) num único Pod RunPod auto-hospedado, consumível via API por aplicações externas (incluindo squads do projeto e integracoes futuras com n8n).

## Why (motivacao)

- Squad `deep-research` precisa de LLM backend para auxiliar fases do pipeline (sintese, classificacao)
- Necessidade adicional surgida: geracao de imagem por API (decisao tomada apos research em wf-quick-research, 2026-04-20)
- Self-hosted reduz custo recorrente vs. APIs comerciais (OpenAI/Anthropic/Replicate) e elimina vendor lock-in
- GPU RTX 4090 24GB ja disponivel no Pod existente (`xzn1mf6skopp5m`)

## Scope

**In scope:**
- Runtime de LLM (ja em producao): Ollama 0.21.0 + qwen2.5-coder:14b (porta 11434)
- Runtime de geracao de imagem: ComfyUI + FLUX.1-schnell (porta 8188)
- Persistencia em network volume (`/workspace`)
- Integracao no boot do Pod via `/workspace/start.sh`
- Controle ciclo-de-vida do Pod via `pod.sh` (start/stop/up/ssh) — ja entregue

**Out of scope (este epic):**
- LoRAs, ControlNets, custom nodes do ComfyUI
- Autenticacao em endpoints
- Mapeamento publico de portas (depende de @devops + RunPod template)
- Integracao com n8n-master ou outras aplicacoes consumidoras (epic separado)
- Modelos adicionais (SDXL, SD 3.5) — adicionar como story separada se necessario

## Success Criteria

- [ ] ComfyUI responde em `0.0.0.0:8188` apos boot completo
- [ ] FLUX.1-schnell carrega e gera imagem em <30s para prompt baseline
- [ ] Ollama continua respondendo em `:11434` (coexistencia validada)
- [ ] `/workspace/start.sh` sobe ambos automaticamente apos `pod.sh up`
- [ ] Setup sobrevive a stop/start completo do Pod (persistencia em network volume)
- [ ] Documentacao de uso (workflow JSON exemplo + comando curl) entregue

## Stories

| ID | Titulo | Status | Owner |
|---|---|---|---|
| 1.1 | Install ComfyUI + FLUX.1-schnell on Pod | Review (impl @dev — aguarda @qa) | @dev |
| 1.x | (futuras stories conforme necessidade) | — | — |

## Constraints (cross-story)

- **VRAM:** 24 GB total — Ollama (qwen 14b ~9 GB) e FLUX (schnell ~10-12 GB) **nao cabem simultaneos em VRAM**. Estrategia: Ollama keep-alive curto (5min default ja configurado), descarrega quando ocioso, FLUX carrega sob demanda.
- **Disco:** Container `/` apenas 20 GB (efemero); todo install pesado em `/workspace` (network volume, 253 TB livres, persistente).
- **Licenca:** Apenas modelos com licenca **commercial-friendly** (Apache 2.0, OpenRAIL-M, ou equivalente). FLUX.1-schnell = Apache 2.0, validado.
- **Boot order:** Ollama nao deve falhar se ComfyUI falhar e vice-versa (independencia de servicos).

## References

- Research report: execucao do `wf-quick-research` em 2026-04-20 (no chat history; nao gravado em arquivo)
- Pod control script: `/home/jhonata/projetos/gemma4/pod.sh`
- Boot script: `/workspace/start.sh` (no Pod)
- Constitution: `.aiox-core/constitution.md` (Articles I-VI)
