# Version Status

## Current: V1.5

- Executive owner dashboard with cash outlook, prioritized actions, project health, company funds, aging and maturity drill-downs.
- Real AI Core with OpenAI-compatible Responses/Chat adapter, structured output, streaming, stateless tool calling and multi-round conversations.
- Role-filtered read-only business tools, server-owned evidence, prompt-injection boundaries and AI run/tool audit.
- Shared workflow/project authorization for normal APIs and AI tools.
- Minimized AI DTOs and explicit inaccessible-field semantics.
- Numeric grounding guard for money, percentages, counts and dates.
- Full-run Token accumulation, model-route counters, owner operations dashboard and configurable rate limits.
- Data migration center, safe import/rollback, financial audit, approvals, payments, attachments and project operating ledger remain intact.

## Remaining Hardening

- Object storage direct upload, virus scanning and signed attachment downloads.
- Independent final audited-amount adjustment workspace.
- Scheduled warranty-release jobs; the current status is calculated at query time.
- Async queues, resumable upload and retry for very large workbooks.
- Email, WeCom or DingTalk notifications.
- Production pilot with real company data, provider capacity monitoring and externally managed PostgreSQL.

## Constraints

- The local database is embedded PostgreSQL and one data directory can be opened by only one database service. Multi-instance production deployment should use managed PostgreSQL.
- Seed data is for isolated demonstration only. Production rejects demo seeding by default.
- Financial and approval data uses void, reversal or a new version rather than physical deletion.
