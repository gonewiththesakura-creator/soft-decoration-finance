# Version Status

## Current: V1.7

- Real data is the default operating mode. Startup bootstraps only one owner account and never inserts Demo business records.
- Demo seeding and destructive Schema rebuild are restricted to explicit `DATA_MODE=demo` commands.
- The real-data reset command requires an exact phrase, creates a compressed database backup and count manifest, preserves the owner account, and verifies that business tables are empty.
- The migration center now has multi-file upload and owner-only server-folder scanning through one staging pipeline.
- SHA-256 fingerprints, source groups, file versions, managed originals, Sheet classifications, business facts, source evidence and expanded lineage are persisted.
- Dashboard, finance and procurement surfaces show a guided real-data empty state instead of fabricated zero-value conclusions.
- Real-mode confirmation requires the exact phrase “确认导入真实数据”; formal import and rollback retain the existing transaction and dependency guards.
- The automated suite covers 59 unit and integration tests, including an isolated real bootstrap/reset cycle.
- The named Qingdao pilot workbook was not found locally; final manual upload and source-data reconciliation remain a user-operated acceptance gate.

See `docs/V1.7-REAL-DATA-PILOT.md` for controls, limits and the remaining manual pilot steps.

## Previous: V1.6

- ZHIHENG DESIGN SYSTEM v2.0 and MOTION v1.0 are now the governed visual and motion sources of truth.
- Project, finance, procurement and executive surfaces use the mineral-white, deep-forest, muted-teal and champagne design language.
- Dashboard, Executive Pulse, Global AI Orb/window and the standalone AI workspace are aligned to the V1.6 hierarchy without changing business behavior.
- Design references are pinned, vendored and attributed for offline review; future standard changes require a human-approved Design System Change Proposal.
- Executive Pulse Core gives the owner dashboard a visible, rule-derived operating-status heartbeat.
- Global AI Orb and non-modal conversation window remain available across authenticated routes with page-aware context and persistent client-side conversation state.
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
