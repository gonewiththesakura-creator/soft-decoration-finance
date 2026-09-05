# AI Hardening

## Shared Authorization

`assertProjectAccess(user, projectId)` and `assertWorkflowAccess(user, companyId, projectId, type)` are now shared by normal workflow services and AI tools. Owner access is group-wide. Finance and procurement remain company-scoped and resource-scoped. Project managers and designers must also be explicit project members.

Payment details return account balance fields only to owner and finance. Other authorized roles receive `accountBalance: { accessible: false }`; unavailable balances are never represented as zero.

## AI Data Minimization

Tool outputs use dedicated DTOs. Supplier contact, phone, tax number, address, attachment URLs and unrelated internal fields are excluded. Customer, project, purchase request and payment request output is reduced to IDs, business labels, necessary status, aggregates and risk facts. Payment and purchase approvals expose the decision and time but omit free-form internal comments from model input.

## Numeric Grounding

Every successful tool result contributes an Authorized Facts index for money, percentages, counts and dates. Before persistence and display, the server validates numbers in `summary`, `metrics`, `findings` and `recommendations`:

- unverifiable metrics are removed;
- unverifiable inline numbers are replaced with `[未验证数字已隐藏]`;
- a visible grounding warning is appended;
- evidence remains server-owned and is never accepted from model output.

## Usage Accounting

Each run accumulates usage from primary tool selection, search loops, fast synthesis, repair and successful fallback responses. `ai_runs` stores the full-run input, output and total tokens together with orchestrator-level primary calls, fast calls and fallback count. Provider-internal HTTP retry attempts are transport behavior rather than model-call counters; calls without returned usage cannot invent token values.

## Rate Limits

Limits are checked before a run starts and return HTTP 429 with a stable error code and `Retry-After`:

- `AI_RATE_LIMIT_PER_MINUTE`
- `AI_DAILY_REQUEST_LIMIT`
- `AI_DAILY_TOKEN_LIMIT`
- `AI_OWNER_LIMIT_MULTIPLIER`

The default owner multiplier is five, keeping owner operations above normal employee limits without making the endpoint unlimited.

## AI Operations

The owner-only AI settings page shows today's requests, success rate, failures, degraded responses, average latency, input/output/total tokens, tool calls, error distribution, primary/fast calls and fallback count. It never returns or renders the API key.
