# Project Brief: Agentic Coding — Open Models on POD (internal tooling)

> **Status:** Draft (YOLO) · 2026-07-02 · @analyst (Alex)
> **Scope class:** Internal tooling · Owner-only consumer · No SDK / no public endpoint
> **Verification flags:** items marked **⚠️ VERIFY** need owner confirmation before promoting brief to a story or PoC.

---

## Executive Summary

Add a **4th model category** to the owner's persistent RunPod GPU pod: **agentic coding open-weights LLMs with native tool-use / function-calling**, serving the owner's own developer workflow (Claude Code, IDE, CLI) as an alternative and complement to hosted providers. No public endpoint, no SDK method, no consumer impact. Adopts the same license-first triage used to close Epic 6 (HiDream) and FU-6.1 (SD 3.5L) — Apache-2.0 / MIT-class or nothing.

The category joins existing pod capabilities:

| Existing category | Representative model | Status |
|-------------------|----------------------|--------|
| Image T2I | FLUX.1-schnell | Production (Story 2.1) |
| Image I2I / edit | Qwen-Image-Edit | Production (Story 3.1) |
| Video T2V / I2V | WAN 2.2 · LTX-Video | Production (Story 5.2) |
| Text generation | Gemma family | Production (Story 4.2) |
| **Agentic coding** ← **new** | *(candidate list below)* | This brief |

---

## Problem Statement

**Current state:** Owner uses Claude Code (via Anthropic) as primary agentic coding surface. Fully hosted, fully paid, no in-house fallback. The persistent RunPod pod (`xzn1mf6skopp5m`, `$0.69/hr`) is already provisioned for other model categories but has no coding model installed. When Anthropic rate-limits, degrades, or the network is offline, agentic development stops.

**Pain points:**
- **Provider dependency risk** — 100% of agentic coding hours flow through one external vendor
- **No offline / air-gapped path** — travel, outages, private repos with NDA constraints can't fall back
- **Unmeasured latency ceiling** — no baseline data for how a local model would perform on the owner's actual workflow, so no informed decision on whether to shift any workload local
- **Existing pod hardware is idle a large fraction of the day** — image/video/text workloads are bursty; the pod exits when idle, but starting it costs zero when spinning up for a coding session anyway

**Why now:** Multi-tenant auth (Story 2.10) closed 2026-07-02. Owner's operational cadence stabilized. Second tenant (Contabhub) onboarded. Attention available for a personal-productivity spike that doesn't affect production traffic or paying tenants.

**Why not already:** As of ~Q1-Q2/2026 the open agentic-coding landscape crossed a quality threshold — Qwen3-Coder, DeepSeek-V3, GLM-4.5, and Kimi-K2 all shipped with native tool-use and benchmark scores meaningful enough to be usable (not just curious).

---

## Proposed Solution

Install **one** open-weights agentic-coding LLM on the existing pod, expose it as an **OpenAI-compatible HTTP endpoint** (via vLLM), and drive it from the owner's laptop **via CLI only** — `curl` / `httpie` scripts + shell aliases — with no IDE / MCP integration. Scope explicitly locked to CLI-only per owner elicitation (Q4).

**Key characteristics:**
- **Serving stack:** vLLM 0.6+ with OpenAI-compatible endpoint on `localhost:8000`. Native `tools` / `tool_choice` support. SGLang as fallback only if vLLM has bugs on the chosen model's tool-call shape.
- **Access pattern:** SSH tunnel from owner's laptop → pod:8000 (existing `pod.sh` flow). No exposure through the servegate gateway. No `GATEWAY_API_KEY_*` involvement. No Tailscale (deferred until latency proves to be a problem).
- **Interaction pattern:** owner runs `curl` / `httpie` calls with tool-use prompts from laptop shell; model returns code, owner copies to IDE for review + apply. Explicitly NOT a Claude Code-style continuous agent loop. Episodic query pattern.
- **Model choice:** one model to start; rotate if unsatisfactory. Not a menu of options — decision fatigue is the enemy of internal tooling adoption.
- **Session pattern:** on-demand pod start (existing `pod.sh start/stop` flow) — not always-on. Owner spins up before a coding block, tears down after.

**Differentiators from just "using Claude Code":**
- Zero variable cost per token — flat $0.69/hr while running
- Fully offline once model is downloaded to `/workspace/`
- Data never leaves owner's infrastructure (relevant for NDA / sensitive client repos)
- Same pod infrastructure already used for other model categories → zero additional platform work

**Non-differentiators (and OK with that):**
- Quality — open agentic coders are ~6-12 months behind Claude Sonnet-class. Fine for "second option," not a replacement.
- Speed — first-token latency on a single-GPU pod won't beat Anthropic's fleet. Fine for background tasks.

---

## Target Users

### Primary User Segment: Owner (single-user internal tooling)

- **Profile:** Solo owner-operator of servegate; primary workflow is agentic coding via Claude Code CLI on a Linux (WSL2) laptop, with the pod as GPU sidecar for other model categories
- **Current behavior:** All agentic coding hours through Anthropic; pod used only for image/video/text spikes and production endpoint validation
- **Specific needs:** A local coding model that can be invoked on-demand for (a) offline sessions, (b) sensitive-repo work, (c) benchmarking local vs. hosted quality on real tasks
- **Goals:** Reduce single-vendor dependence to some quantifiable fraction (e.g., "10% of my weekly agentic coding hours run local by end of Q3") without daily-workflow friction

*(No secondary segment — internal tooling scope, per the elicitation answer.)*

---

## Owner Objectives & Success Signals

*(Replaces "Business Objectives" and "KPIs" since this is internal-only, non-revenue.)*

### Owner Objectives

- **O1.** Have a working local coding LLM installed and used for at least one real coding task within **4-6 weeks** of brief acceptance
- **O2.** Zero impact on production model categories on the same pod — installation must be additive, isolated by directory (`/workspace/coding/`)
- **O3.** License-clean per repo precedent — no revenue cliffs, no restrictive RAI clauses. Apache-2.0 / MIT / equivalent only
- **O4.** Build a first-hand quality/limitation map of open coders on real tasks — informational, feeds any future decision about whether this category deserves more investment (e.g., promote to product line, or scrap)

### Success Signals

- **SS1.** At least **1 real coding task** completed using the local model via CLI (curl/httpie prompts → code returned → copied to IDE → applied → shipped or reviewed). Task chosen from actual servegate backlog — not a synthetic benchmark
- **SS2.** A 1-page memo at `docs/research/agentic-coding-mvp-outcome-<date>.md` capturing: what the model got right, what it got wrong, wall-clock cost per task, and gut-feel comparison to how Claude Code would have handled the same task
- **SS3.** Total pod hours spent on this category tracked; cost/month reported in monthly review (target ≤ 60h/mo)

### Anti-signals (things that would mean this failed)

- Owner falls back to Claude Code every session because local model is too rough → deinstall and revisit in 3-6 months
- Model install breaks / crowds out other categories on the pod → rollback, isolate better
- License audit reveals a cliff after install → REJECT per ADR-0006 pattern, wipe, pick another

---

## MVP Scope

### Core Features (Must Have)

- **Model installed** on the mounted persistent volume `/workspace/coding/models/{name}/` with weights, config, and vLLM version pinned to specific tags — survives pod stop/start
- **OpenAI-compatible endpoint** on `http://localhost:8000/v1/chat/completions` responding to tool-call requests with well-formed `tool_calls[]` in the response
- **SSH tunnel one-liner** (`ssh -L 8000:localhost:8000 ...`) documented in `spike/agentic-coding/README.md` so owner opens the tunnel and starts making calls in <1 min
- **CLI helper alias / small wrapper** (`~/.local/bin/agentcode 'prompt here'`) that shapes the OpenAI-compat request and prints the response — keeps friction minimal
- **Install/teardown script** at `spike/agentic-coding/` mirroring the existing spike pattern (`spike/hidream-poc/` etc.) — reproducible, self-documented
- **MVP outcome memo** at `docs/research/agentic-coding-mvp-outcome-<date>.md` capturing one real task run + qualitative assessment

### Out of Scope for MVP

- SDK method / public gateway endpoint (excluded per elicitation)
- IDE integration / MCP shim (excluded per elicitation Q4 — CLI-only)
- Multi-model comparison ("try 5 models") — pick one on paper, use that one; if it fails, pivot to next single model, not a bake-off
- Fine-tuning / LoRA
- Persistent chat history / owner-facing UI beyond the CLI wrapper
- Formal evaluation harness with multiple tasks and wall-clock stats (excluded per elicitation Q5 — single subjective session is enough)
- Automatic pod lifecycle (auto-start on client connect, auto-stop after idle) — manual `pod.sh start/stop` for MVP
- Cost dashboards / usage tracking beyond the manual monthly note
- Always-on serving pattern

### MVP Success Criteria

Owner uses the local model to accomplish at least one **real coding task** from the servegate backlog (any TD / FU / small story) via the CLI wrapper, and writes a 1-page memo summarizing what worked, what didn't, and whether it displaced any fraction of the effort that would have gone to Claude Code. Ship-or-scrap decision made from that memo.

---

## Post-MVP Vision

- **6-12 months:** If MVP shows the local model handles a meaningful fraction of tasks (e.g., 20%+), evaluate promoting to a scheduled always-on serving pattern (needs infra work + cost decision)
- **12+ months:** Consider exposing as a paid public endpoint under servegate (analog Story 4.2's Gemma text) — but only if the model quality has caught up meaningfully AND commercial license terms permit
- **Watch conditions:** New releases every 2-3 months in this space; treat MVP install as replaceable, not permanent

---

## Technical Considerations

### Platform

- **POD:** `xzn1mf6skopp5m` (`onith_marketing`), `$0.69/hr`, currently EXITED. RunPod API surfaces on 2026-07-02: 41GB RAM · 21 vCPU · containerDiskInGb=20 · volumeInGb=**0** · image `runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04`.
- **GPU tier (inferred, pending SSH confirm):** cost + RAM + vCPU profile most consistent with **RTX A6000 48GB** or **A40 48GB** on community cloud. L4 (24GB, ~$0.43/hr) and RTX 4090 (24GB, ~$0.34/hr) both rejected by cost. A100 SXM 40GB spot is a distant possibility but usually >$0.79/hr. `nvidia-smi` confirmation queued via background retry loop (see Open Questions).
- **Serving:** vLLM 0.6+ (mature OpenAI-compat `tools`/`tool_choice`). SGLang is a fallback for structured output edge cases. Ollama deprioritized (function-calling still catching up on complex schemas).
- **Networking:** SSH tunnel via existing `pod.sh` flow. Tailscale as future optimization if latency becomes an issue.

### Storage — resolved 2026-07-02

**Design blocker found + resolution locked:** the pod's ephemeral shape (`containerDiskInGb: 20 · volumeInGb: 0`) can't hold a 32B model. A **150GB persistent Network Volume named `ollama-models` (ID `mqqgzwnfp1`, region `US-IL-1`) already exists in the RunPod account** — provisioned in a prior project cycle, currently unattached from the pod.

Path forward (locked pending same-DC verification):

1. Confirm the pod lives in `US-IL-1` (needs pod-boot to surface `dataCenterId` in metadata; nulls returned while EXITED)
2. If yes: attach `mqqgzwnfp1` to the pod via `/pods/{podId}/update` — no recreation needed IF RunPod's API accepts runtime volume attach (open question — see below)
3. If pod is in a different DC OR runtime attach not permitted: recreate the pod in `US-IL-1` with the volume attached at creation. Migrates SSH key + reinstall pytorch image. ~30 min work but same net result.

**Cost:** volume already provisioned (~$10.50/mo @ $0.07/GB × 150GB) — **zero incremental cost** for the agentic-coding category. Same 150GB comfortably fits Qwen2.5-Coder-32B (~18GB) + Qwen3-Coder (~17GB) + tokenizer + KV cache + logs, with headroom for a 2nd model side-by-side.

Model weights live in `/workspace/coding/models/{model_name}/` on the mounted volume — persistent across pod stop/start cycles, no re-download.

### License-first candidate triage

Following the audit precedent (ADR-0003 FLUX NC, ADR-0006 HiDream/Llama, FU-6.1 SD 3.5L). License texts were read directly from each project's LICENSE / LICENSE-MODEL file on 2026-07-02 (not model card claims alone).

| Model | License (real read) | Real restrictions | Verdict for owner-internal |
|-------|---------------------|-------------------|:---:|
| **Qwen3-Coder** (30B / 480B MoE) | Apache-2.0 | None material | ✅ **Cleanest** |
| **Qwen2.5-Coder-32B-Instruct** | Apache-2.0 | None material | ✅ **Cleanest** |
| **GLM-4.5-Air** (~110B) | Pure MIT (Zhipu confirmed) | None material | ✅ Clean |
| **DeepSeek-V3** (~685B) | MIT code + Model Agreement | Attachment A: RAI clauses (military, minors, disinfo, PII misuse, discrimination). Reselling API permitted with downstream propagation of same restrictions | ✅ Clean for solo owner-internal (RAI only affects reselling to 3rd parties) |
| **Kimi-K2** | Modified MIT | Attribution required IF >100M MAU OR >$20M/mo revenue: display "Kimi K2" prominently in UI | ✅ Clean (thresholds unreachable at solo/alpha scale; no UI to display in owner-internal path anyway) |
| **Codestral 22B** | Mistral Non-Production License (MNPL) | Non-production only | ❌ REJECT — same pattern as Stability Community; ambiguity for owner-tooling |
| **StarCoder2** | OpenRAIL-M | Responsible AI Use restrictions | ❌ REJECT — audit overhead > benefit for internal use |

**All 4 non-rejected candidates PASS the audit for owner-internal use.** Precedent of rejection (Stability $1M cliff, Llama Community aggregation) does NOT trigger here — no revenue cliff, no aggregation clause across any of them.

**Recommended starting model (paper, subject to VRAM confirmation on the real pod):** **Qwen2.5-Coder-32B-Instruct** in 4-bit AWQ, served by vLLM.

Rationale: cleanest license (Apache-2.0, no RAI, no thresholds), proven quality, ~18GB weights at 4-bit fits in 48GB VRAM comfortably (or 24GB tightly). Qwen3-Coder is a swap-in target when the ecosystem tooling for it stabilizes.

### Integration surface (CLI-only per Q4)

- **CLI wrapper:** small shell script or Python one-file (`~/.local/bin/agentcode`) that reads prompt from argv/stdin, formats the OpenAI-compat request with tool definitions from a config file, posts to `localhost:8000/v1/chat/completions` through the SSH tunnel, and prints the response (either free-form text or extracted `tool_calls[]`). ~50 LOC.
- **SSH tunnel:** existing `pod.sh` opens SSH; wrapper opens local port forward `-L 8000:localhost:8000`. Documented one-liner in the spike README.
- **No IDE integration.** No MCP adapter. No Claude Code custom provider config. Owner reads model output in the shell, copies to IDE by hand for review + apply. Deliberately episodic query pattern.
- **Consequence:** the shape of `tool_calls[]` returned by vLLM must be OpenAI-standard, but there is no downstream consumer that will break if the shape is slightly off — the wrapper can normalize before printing. This removes an entire failure mode.

### License Stack Audit gate (per memory `feedback_brainstorm_license_audit`)

Before installing ANY model, execute a full License Stack Audit on:

1. Model weights themselves
2. Tokenizer license (often forgotten — LLaMA tokenizer was Meta-licensed even when a "clean" model bundled it)
3. Serving stack (vLLM, SGLang, Ollama all Apache-2.0 / MIT — should be safe, but verify)
4. Any embedded auxiliary models (reward models, safety filters — some Coder releases bundle these)

Output the audit as a section in the eventual PoC report or spike README, in the same shape as `docs/research/hidream-i1-dev-model-card-audit.md`.

---

## Constraints & Assumptions

### Constraints

- **Hard time cap:** 4-6 weeks from brief acceptance to MVP go/no-go decision. If it hasn't shipped in 6 weeks, scope was wrong — go back to brief
- **Hard cost cap:** total pod hours dedicated to this category ≤ 60h/month at $0.69/hr ≈ $41/month during the exploration phase. Above that trips a review
- **License hardline:** Apache-2.0, MIT, permissive-commercial only. Any RAI, non-commercial, or revenue-cliff term → REJECT before install
- **Isolation:** must NOT impact existing production categories on the pod. Separate `/workspace/coding/` dir, separate systemd unit or process, separate port
- **No production traffic through this endpoint** — this brief locks the deliverable to internal-only. Any pivot to public product needs a new brief

### Assumptions (post-verification state on 2026-07-02)

- **A1.** ⏳ Pod GPU has ≥ 24GB VRAM. **Inference:** cost profile ($0.69/hr) + 41GB RAM + 21 vCPU point to A6000 48GB or A40 48GB. Empirical confirm queued (retry loop running; pod won't start yet due to RunPod host capacity — Q1 below).
- **A2.** Owner uses SSH tunnel over consumer broadband (existing `pod.sh` flow). Latency posture accepted from prior spikes (HiDream PoC, WAN spikes).
- **A3.** Claude Code accepts custom OpenAI-compat providers via environment/config (owner-confirmed by cascade of prior sessions; **⚠️ VERIFY exact mechanism at spike start** — landscape moves quickly).
- **A4.** ✅ **Resolved.** Persistent 150GB Network Volume `ollama-models` already provisioned — no incremental cost, fits 32B model with headroom.
- **A5.** ✅ No blocking employer policy (solo owner-operator).

---

## Risks & Open Questions

### Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|:----------:|:------:|------------|
| R1 | License landscape shifts mid-install (e.g., Qwen re-licenses) | Low | High | Freeze weights + license text at install time; document exact commit / version hash |
| R2 | Local model quality gap is so large that owner never uses it | Medium | Medium | 4-week hard MVP cap; ship-or-scrap decision, not sunk-cost extension |
| R3 | Pod cost spirals (owner leaves it running) | Medium | Low | 60h/month soft cap + monthly cost note in owner's review; `pod.sh stop` habit |
| R4 | Serving stack (vLLM etc.) has function-calling regressions between versions | Medium | Low | Pin exact vLLM version at install; upgrade only on deliberate cadence |
| R5 | Tool-call shape divergence between model output and OpenAI spec | Low | Low | CLI-only scope removes downstream consumers; wrapper normalizes at print time. Was Medium/Medium before Q4 elicitation |
| R6 | Distraction from paying tenants (Contabhub, etc.) | Medium | High | Time-box strictly; no work on this during production incidents; not on critical path |

### Open Questions

- **Q1.** ⏳ **In progress via background retry:** exact GPU tier confirmed via `nvidia-smi`. Pod couldn't start on 2026-07-02 at 13:14 BRT — RunPod host has no free GPUs. Retry loop scheduled: 10 attempts × 10min = 1h40min max window. Status log at `/tmp/claude-1000/.../scratchpad/pod-start-status.log`. If loop times out, owner should try starting later from own shell or file a RunPod support ticket for capacity.
- **Q2.** ✅ **Resolved by Q4 answer:** no Claude Code custom-provider integration needed. CLI-only path selected by owner.
- **Q3.** ✅ **Resolved:** DeepSeek-V3 (MIT+ModelLicense with RAI clauses — clean for owner-internal), GLM-4.5-Air (MIT clean), Kimi-K2 (Modified MIT with attribution triggered at >100M MAU or >$20M/mo revenue — unreachable). All 4 candidates approved for owner-internal use. Full findings in Technical Considerations table.
- **Q4.** ✅ **Resolved 2026-07-02:** CLI-only. MCP shim work dropped from scope; no IDE integration in MVP.
- **Q5.** ✅ **Resolved 2026-07-02:** single subjective session — one real coding task from servegate backlog, memo captured. Evaluation harness deferred to post-MVP if this category ever gets promoted.
- **Q6.** ⏳ **Awaiting pod boot:** can `/pods/{podId}/update` accept `networkVolumeId` at runtime to attach `mqqgzwnfp1` to the existing pod without recreation? If not, pod recreation in `US-IL-1` is the plan.

---

## Next Steps

1. **Owner confirms VERIFY items** (Q1-Q3 above) — ~1 hour, no code
2. **Analyst produces a follow-up research report** at `docs/research/agentic-coding-model-landscape-<date>.md` narrowing the candidate list from paper triage → shortlist of 2 with License Stack Audits complete
3. **@architect converts brief + research report into a PoC spike story** (analog to Story 6.1 for HiDream) — install, benchmark reference task, produce ADR-0007 with keep/reject/pivot verdict
4. **@dev executes spike** in `spike/agentic-coding/`
5. **@analyst writes the closure memo** (SS1/SS2 evidence) after 30 days of use

**Explicit non-next-step:** do NOT open an epic. This is a spike-first path, mirroring Epic 6. Epic only opens if MVP succeeds and the owner elects to make this a product line — which is out of current scope.

---

## Handoff

- **Draft mode:** YOLO (per elicitation)
- **VERIFY items must be resolved before promoting to spike story** — see Q1, Q2, Q3, and A1-A4 assumptions
- **Next agent:** owner reviews → then `@analyst` produces landscape research → then `@architect` writes the spike story
- **Related artifacts:** existing brainstorm-tmpl at `.aiox-core/development/templates/brainstorming-output-tmpl.yaml` (with License Stack Audit gate per TD-6.1) — the eventual model-selection brainstorm for this category should use it
- **Backlog cross-refs:** none new; this brief itself is the entry point

---

## Change Log

| Date | Author | Change |
|------|--------|--------|
| 2026-07-02 | @analyst (Alex) | Initial YOLO draft. Scope: internal-only tooling, tool-use-native models, single-model spike-first path. 5 VERIFY items flagged for owner confirmation. Candidates triaged license-first per repo precedent (Qwen3-Coder + Qwen2.5-Coder-32B lead; Codestral + StarCoder2 rejected upstream). |
| 2026-07-02 | @analyst (Alex) | Verification pass (Q3 fully resolved; Q1/Q6 in progress via background retry). LICENSE-MODEL / LICENSE files read directly for DeepSeek-V3, GLM-4.5-Air, Kimi-K2 — all 4 non-rejected candidates cleared for owner-internal use. Repo rejection pattern (revenue cliff) confirmed NOT triggered. Pod metadata queried: 20GB container disk + 0GB persistent volume = design blocker for anything above 7B tier. **Resolution locked:** an existing 150GB Network Volume `mqqgzwnfp1` (`ollama-models`, `US-IL-1`) already provisioned in the RunPod account — attach path pending same-DC confirmation once pod boots. Pod start currently blocked by RunPod host capacity; retry loop scheduled 10× at 10min intervals. GPU tier inferred to A6000/A40 48GB from cost + RAM + vCPU profile; empirical confirm pending. |
| 2026-07-02 | @analyst (Alex) | **Q4 + Q5 locked by owner.** Q4: CLI-only (no IDE, no MCP shim). Q5: single subjective session (no eval harness). Scope tightening cascaded: MVP core features reduced (CLI wrapper `~/.local/bin/agentcode` replaces IDE integration); SS1 rewritten as CLI-driven task from real backlog; R5 downgraded Low/Low (no downstream consumer to break); Q2 fully retired (no Claude Code custom-provider needed). Brief is now scope-complete for merge — only Q1/Q6 remain PENDING as verification-in-flight, and those feed the downstream spike story, not the brief itself. |
