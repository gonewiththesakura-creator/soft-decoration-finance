import { notFound } from "next/navigation";
import { ProcurementWorkspace } from "@/components/procurement-workspace";
import { getProcurementWorkspace } from "@/data/procurement-workspace";
import { getCompanyScope, requireSession } from "@/lib/auth";
import { can } from "@/lib/permissions";

export default async function ProcurementWorkspacePage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) { const [user, query] = await Promise.all([requireSession(), searchParams]); if (!can(user, "skus")) notFound(); const scope = await getCompanyScope(user); const data = await getProcurementWorkspace(user, scope); return <main className="content workspace-page"><div className="page-heading"><div><div className="eyebrow">采购执行</div><h1>采购工作台</h1><p className="page-description">以 SKU 为中心完成询价、比价、选供和采购申请。</p></div></div><ProcurementWorkspace rows={data.rows as Row[]} quotes={data.quotes as Quote[]} canWrite={can(user, "purchase-requests", "write")} initialProjectId={query.projectId ? Number(query.projectId) : undefined} /></main>; }

type Row = Record<string, unknown> & { id: number; projectId: number; companyId: number; supplierId?: number; status: string };
type Quote = Record<string, unknown> & { id: number; skuId: number; supplierId: number; status: string };
