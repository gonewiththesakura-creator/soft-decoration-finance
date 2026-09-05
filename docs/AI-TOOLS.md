# AI Business Tools

The model cannot issue SQL. Every tool below maps to a fixed server implementation and is filtered by role before the provider request.

| Area | Tools | Main role boundary |
| --- | --- | --- |
| Dashboard | `get_dashboard_brief` | Owner, finance, project manager |
| Cash | `get_cashflow_forecast`, `get_company_balances` | Owner, finance |
| Receivables | `get_overdue_receivables`, `get_upcoming_receivables` | Owner, finance, project manager |
| Payables | `get_upcoming_payables` | Owner, finance, procurement, project manager |
| Projects | `get_project_summary`, `get_project_cost_breakdown`, `get_project_procurement_pipeline`, `search_projects` | All roles, with member scope for project manager/designer |
| Project finance | `get_project_health`, `get_project_cash_curve`, `get_project_risks` | Owner, finance, project manager |
| Suppliers | `get_supplier_profile`, `get_supplier_invoice_gap`, `get_supplier_purchase_history` | Owner, finance, procurement |
| Customers | `get_customer_profile`, `get_customer_receivables` | Owner, finance |
| Purchase approval | `get_purchase_request_detail`, `get_purchase_request_risks` | Owner, procurement, project manager, designer |
| Payment approval | `get_payment_request_detail`, `get_payment_request_risks` | Owner, finance, project manager |
| Entity lookup | `search_suppliers`, `search_customers` | Filtered by matching resource permissions |

Tool results contain `summary`, typed business `data` and linkable `evidence`. Tool calls write only the tool name, bounded arguments, result summary, duration and success state to `ai_tool_calls`.

The model-facing `data` object is an AI DTO rather than a database or page object. Supplier contact and tax fields, customer contact fields, attachment URLs, internal approval comments and inaccessible account balances are excluded.

There are no create, update, approval, payment, import or delete tools in V1.5. Suggested actions in model output are links or draft descriptions and require a human to act in the normal business UI.
