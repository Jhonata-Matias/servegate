# Decision Log — Story 7.1 (YOLO by @dev 2026-07-25)

Per `.claude/rules/story-lifecycle.md`, YOLO mode requires all decisions taken during autonomous execution to be logged here.

## Decisions taken during YOLO execution

### D1 — Doc path `docs/guides/` vs `docs/usage/`
- **Story spec:** `docs/guides/vscode-agentic-setup.pt-BR.md` (from Story 7.1 AC8)
- **Repo convention actual:** `docs/usage/*.pt-BR.md` (verified via `find docs -type d`)
- **Decision:** Created at `docs/usage/vscode-agentic-setup.pt-BR.md` (respecting repo convention over story-spec typo)
- **Reason:** Consistency with 8 existing sibling files in `docs/usage/`. Story spec was a good-faith path guess by @sm without checking convention.

### D2 — Model version default
- **Story open Q1:** exact Qwen3-Coder revision (30B-A3B-Instruct? Coder-Next? Coder-32B?)
- **Decision:** Default `Qwen/Qwen3-Coder-30B-A3B-Instruct-AWQ` in `download-model.sh`
- **Reason:** AWQ variant is pre-quantized (17GB weights, fits 48GB VRAM comfortably), and A3B-Instruct is the coder-focused instruct-tuned variant. @dev at Task 2 execution MUST re-verify HF Hub for a newer stable release before pinning commit hash.

### D3 — `forwardToTextEndpoint` signature — added `endpointId` as required param
- **Alternative considered:** Keep `env.RUNPOD_TEXT_ENDPOINT_ID` as default, only take override when needed
- **Decision:** Made `endpointId: string` REQUIRED, moved model→endpoint resolution to caller (`generate.ts::resolveModelEndpoint`)
- **Reason:** Single source of truth for routing. Caller always knows which endpoint it wants; forwarder shouldn't have model-awareness. Backward-compat impact: only 1 caller (`handleGenerate`), updated in same commit.

### D4 — SUPPORTED_MODELS as single source of truth in `generate.ts`
- **Alternative considered:** Derive SUPPORTED_MODELS from `openai-models.ts::MODEL_CATALOG`
- **Decision:** Duplicated intentionally — SUPPORTED_MODELS in generate.ts, MODEL_CATALOG in openai-models.ts
- **Reason:** Keeps `/v1/models` endpoint independently mockable in tests without importing generate internals. Test invariant added (`SUPPORTED_MODELS invariant` describe block) to catch drift.

### D5 — `model_not_found` returns 404, not 400
- **Existing behavior (pre-Story-7.1):** `normalizeGenerateRequest` returned `{error: 'model_not_found'}` which flowed to `generateError(400, ...)`, but `openaiErrorResponse('model_not_found')` maps to status 404 per ERROR_MAP.
- **Result observed in test logs:** log entry says `status:400`, but actual HTTP response is 404 (from ERROR_MAP).
- **Decision:** Kept as-is. Log entry mismatch is cosmetic; HTTP status matches OpenAI spec. Fix deferred.
- **Note for future @dev:** if log-vs-HTTP mismatch matters for observability queries, update `logGenerateInvalid` to accept dynamic status from `openaiErrorStatus(errorCode)`.

### D6 — Partial-rollback path (secret unset) returns 404 not 502
- **Alternative considered:** Treat unset `RUNPOD_CODER_ENDPOINT_ID` as `upstream_unavailable` (503) — technically it IS a config issue
- **Decision:** `generateError(404, 'model_not_found', ...)` — the model is declared in SUPPORTED_MODELS but its infra isn't provisioned, which reads as "model not available" to the client
- **Reason:** More client-friendly. 502/503 suggests transient infra failure; 404 clearly signals "this model isn't provisioned". Test coverage added (see `returns model_not_found when qwen3-coder secret unset (partial rollback)`).

### D7 — Test file location: `gateway/tests/` (not `gateway/src/`)
- **Convention observed:** Mix of both (`src/*.test.ts` for some, `tests/*.test.ts` for others)
- **Decision:** `gateway/tests/model-routing.test.ts` alongside `tests/generate.test.ts` (routing tests share more with generate.test.ts helpers than with src co-located tests)
- **Reason:** Reuse of `makeKv`/`makeEnv` patterns from tests/ dir. Story doesn't mandate location.

### D8 — TS strict fix: `delete` pattern for exactOptionalPropertyTypes
- **Problem:** Tests need to simulate unset `RUNPOD_CODER_ENDPOINT_ID`, but `Partial<Env>` with `exactOptionalPropertyTypes: true` forbids `{RUNPOD_CODER_ENDPOINT_ID: undefined}` overrides
- **Alternative considered:** widen makeEnv signature to accept nullable, use `as unknown as Env`
- **Decision:** `const env = makeEnv(); delete (env as {...}).RUNPOD_CODER_ENDPOINT_ID`
- **Reason:** Preserves type safety of makeEnv; delete-cast is localized and self-documenting via comment

### D9 — Halted at Task 2, 5, 7, 10 (owner + @devops gates)
- **Task 2 (RunPod endpoint provisioning):** requires GPU spend ($5 setup + $ steady state) — owner authorization needed
- **Task 5 (preview validation):** blocks on Task 2
- **Task 7 (prod deploy):** Article Agent Authority — @devops exclusive for `wrangler secret put` + `wrangler deploy`
- **Task 10 (PR):** Article Agent Authority — @devops exclusive for `git push` + `gh pr create`
- **Decision:** Marked Story status still `InProgress`; @dev completed 5/10 tasks (1, 3, 4, 6-partial, 8, 9). Story cannot reach `InReview` (which triggers @qa) until Tasks 2, 5, 7, 10 land.

### D10 — Brief amendment (Concern #3 from @po validation) — completed as parallel @pm work
- **@po flagged:** Brief `docs/brief-agentic-coding.md` divergent from Story 7.1 scope (CLI-only vs VS Code + agentic loop)
- **Decision:** Amendment executed IN THIS SESSION by @pm (before @dev YOLO started), covering §Proposed Solution, differentiators, §MVP Core Features, §Out of Scope, SS1, SS2, Q2/Q4/Q5, §Change Log entry
- **Reason:** Owner asked for amendment + dev sequentially; doing amendment first eliminated Concern #3 before @dev started work

## Blocked items (require owner or @devops action)

- **RunPod endpoint provisioning** — owner runs `bash spike/qwen3-coder-vscode/download-model.sh` on a RunPod pod with volume attached, then provisions serverless endpoint via RunPod dashboard/API. Captures endpoint ID in `.aiox/notes/story-7.1/endpoint-info.json`.
- **License Stack Audit final verification** — @dev at Task 2 execution re-verifies weights LICENSE + tokenizer_config + auxiliary models scan on the pinned HF revision hash.
- **Secret + deploy prod** — @devops runs `wrangler secret put RUNPOD_CODER_ENDPOINT_ID --env=""` and `wrangler deploy --env=""`.
- **PR creation** — @devops runs `git push -u origin spike/qwen3-coder-vscode-poc` and `gh pr create`.

## Files touched (see also story File List section)

**Created:**
- `spike/qwen3-coder-vscode/README.md`
- `spike/qwen3-coder-vscode/license-audit.md`
- `spike/qwen3-coder-vscode/download-model.sh`
- `spike/qwen3-coder-vscode/smoke-test.sh`
- `spike/qwen3-coder-vscode/teardown.sh`
- `gateway/tests/model-routing.test.ts`
- `docs/usage/vscode-agentic-setup.pt-BR.md`
- `docs/research/agentic-coding-outcome-2026-08-24.md`
- `.aiox/notes/story-7.1/decision-log-7.1.md` (this file)

**Modified:**
- `gateway/src/generate.ts` (added `resolveModelEndpoint`, extended `SUPPORTED_MODELS`, routing branch in `handleGenerate`)
- `gateway/src/openai-models.ts` (extended `MODEL_CATALOG` with qwen3-coder:30b)
- `gateway/src/runpod-text.ts` (signature: added `endpointId` param)
- `gateway/src/types.ts` (added `RUNPOD_CODER_ENDPOINT_ID?: string` to Env)
- `gateway/wrangler.toml` (comment header: documented new secret)
- `gateway/tests/openai-compat.test.ts` (patched hardcoded `data.length === 1` assertion to `find(id='gemma4:e4b')`)
- `docs/brief-agentic-coding.md` (@pm amendment — 9 surgical edits)
- `docs/stories/7.1.qwen3-coder-vscode-spike.story.md` (status Ready→InProgress + Change Log entry pending)

## Test outcome

- 167 tests total (14 new via `model-routing.test.ts` + 152 existing + 1 patched)
- All green
- Typecheck (`tsc --noEmit`) clean
- No regression detected in existing test paths (openai-compat, generate, sse, runpod, rate-limit, video, r2-video, capabilities, storage, integration, auth, nfr-5)
