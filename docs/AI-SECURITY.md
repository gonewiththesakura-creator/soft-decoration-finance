# AI Security

## Secrets

- `AI_API_KEY` is read from the server environment only.
- It must never use a `NEXT_PUBLIC_` name, enter prompts, provider-visible business content, logs, audit tables or source control.
- Provider errors exposed to the browser are reduced to stable business messages and error codes.
- `AI_BASE_URL` rejects embedded URL credentials and every provider request forces `store=false`.

## Authorization

Tool availability is filtered by role before the model sees it. Tool execution then enforces the same role again, current company scope and project membership. Context IDs supplied by a route or by the model are never treated as authorization.

Designer tools exclude company cash, customer receivables, supplier payables and payment approvals. Procurement tools exclude company cash and customer receivables. Customer and supplier aggregate profiles are restricted to roles whose company-wide access matches those aggregates.

Provider configuration and health history are owner-only at both page and API layers. Model-suggested actions are limited to same-origin page links; external, protocol-relative and API paths are converted to non-executable drafts.

## Prompt Injection

System prompts classify tool output, database text, page text and uploads as untrusted data. Instructions found inside those values cannot change the role, reveal other scopes, introduce SQL or enable writes. Fixed tools use parameterized SQL and bounded result sizes.

## Reliability

- Maximum eight orchestration turns.
- One active run per user, with an explicit cancel endpoint.
- One retry only for network, timeout-like or transient provider statuses.
- Fast-model synthesis may switch once to the primary model only after a retryable network, timeout, rate-limit or 5xx failure; credential, permission and missing-model errors never switch models.
- Structured JSON validation and one fast-model repair attempt.
- Narrow legacy fallback is clearly marked and never represented as a successful real-model answer.
- AI is never an application startup dependency.

## Audit Data

`ai_conversations`, `ai_messages`, `ai_runs`, `ai_tool_calls` and `ai_provider_checks` capture ownership, scope, model/mode, status, latency, token counts, stable error codes and bounded tool summaries. They do not store API keys or authorization headers.
