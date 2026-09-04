# AI Architecture

## Request Flow

1. `/api/ai` authenticates the user, resolves the current company scope, enforces one active run per user and opens an SSE response.
2. The orchestrator loads the last 20 messages, adds the role prompt and current page context, then calls the server-side Provider.
3. The model may select only tools registered for the current role. Each selected tool repeats company, permission and project-membership checks before reading data.
4. Search tools may continue into a bounded lookup loop (maximum eight turns). Once business data is resolved, tool results are normalized into a fresh fast-model synthesis request as untrusted data. This avoids relying on vendor-specific tool-continuation behavior.
5. The final answer must match the business response JSON Schema. Invalid JSON receives one repair attempt with the fast model.
6. The API streams business statuses and one final structured response. Conversations, messages, runs and tool-call summaries are written to audit tables.

## Provider Adapter

`OpenAICompatibleProvider` owns all provider-specific payloads. It supports Responses and Chat Completions, streaming, structured output, function tools, `store=false`, timeouts and one retry for network, 408, 429 or 5xx errors.

For stateless Responses tool loops, the adapter requests encrypted reasoning content and replays all prior response output items, including reasoning and function calls, before appending function outputs. This keeps multi-tool continuations valid while provider-side storage remains disabled.

`AI_API_MODE=auto` starts with Responses. Chat Completions is selected only for 404, 405 or an explicit endpoint unsupported/not implemented error. Authentication, authorization, bad requests and model errors remain visible and never trigger endpoint switching.

The application does not contact the provider during startup or page rendering. Core dashboards and ledgers remain available when AI is unavailable.

## Models

- `AI_MODEL_PRIMARY` handles intent analysis and business-tool selection.
- `AI_MODEL_FAST` synthesizes bounded tool results, handles health checks and repairs malformed JSON.
- If fast-model synthesis has a retryable transport, rate-limit or 5xx failure, the already-authorized tool results are synthesized once by the primary model. Authentication, permission and missing-model errors never trigger this fallback.
- Models are configured in server environment variables only; UI code never names or selects models.

## UI Surfaces

- `/ai`: formal multi-round workspace with conversation history.
- Global Copilot: route-aware drawer available from the top bar.
- Dashboard Daily Brief, Project AI and Finance AI: explicit on-demand analysis panels.
- Payment Risk Review: read-only review inside the payment approval detail.
- `/ai/settings`: owner-only provider status and connection-test history.

The V1.0 keyword service is retained as `legacy-rule-engine.ts`. It is used only after a real provider failure, only for its narrow supported questions, and every such answer is marked `degraded`.
