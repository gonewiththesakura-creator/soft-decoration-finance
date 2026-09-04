# AI Provider Compatibility

## Status

- Provider: `openai-compatible`
- Base URL: `https://dreamapi.club/v1`
- Primary model: `gpt-5.6-sol`
- Fast model: `gpt-5.4-mini`
- Requested API mode: `auto`
- Resolved API mode: `responses`
- Provider storage: `false`
- Current gate: **PASSED - 8/8 authenticated checks**
- Tested at: 2026-09-03 16:02 CST

The authenticated compatibility suite completed against the configured provider. It did not print or persist the API key or an Authorization header.

## Results

| Test | Status | Latency | Acceptance result |
| --- | --- | ---: | --- |
| Basic generation | Pass | 3636 ms | Primary and fast models both returned the expected response |
| Chinese | Pass | 2544 ms | The model followed a Chinese instruction |
| Structured JSON | Pass | 2634 ms | Strict JSON Schema output parsed successfully |
| Function calling | Pass | 5158 ms | A typed function call was returned |
| Multiple tool calls | Pass | 6328 ms | Two requested tools were returned in one turn |
| Streaming | Pass | 3381 ms | Recognizable SSE output completed; 70,837 bytes received |
| `store=false` | Pass | 2130 ms | The provider accepted a non-stored request |
| Large context basic | Pass | 2652 ms | The provider accepted 11,400 characters and followed the final instruction |

The harness was also validated against disposable local providers: the Responses path passed 8/8; an explicit `404 endpoint_unsupported` selected Chat Completions and passed 8/8; `401 INVALID_API_KEY` stopped immediately without fallback.

During end-to-end UI verification on 2026-09-04, the fast model intermittently returned a retryable HTTP 503 while the primary model remained healthy. Runtime synthesis now switches once to the primary model only for transient transport, rate-limit or 5xx failures. Authentication, authorization and missing-model errors remain visible and do not trigger this model-level fallback.

## Runbook

Set `AI_API_KEY` in `.env.local` on the server only, then run:

```bash
npm run ai:smoke
```

The command emits the resolved endpoint mode, latency and one row per test. A failed test returns a non-zero exit code.

## Auto-mode Rules

`AI_API_MODE=auto` probes `POST /responses` first. It falls back to `POST /chat/completions` only for HTTP `404`, HTTP `405`, or an explicit endpoint unsupported/not implemented error. Authentication, authorization, invalid request, rate-limit and model errors do not trigger fallback.

## Security Notes

- `AI_API_KEY` is server-only and never uses a `NEXT_PUBLIC_` prefix.
- `.env.local` is excluded from Git.
- The compatibility command sanitizes bearer values and the configured key from errors.
- CI uses a mock provider and never contacts the real provider.
- Provider output and business records are untrusted data, not instructions.
