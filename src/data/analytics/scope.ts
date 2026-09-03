import type { SessionUser } from "@/lib/auth";

export function analyticsScope(user: SessionUser, selectedCompanyId: number | null, alias: string, projectExpression?: string) {
  const params: unknown[] = [];
  const conditions: string[] = [];
  const companyId = user.role === "owner" ? selectedCompanyId : user.companyId;
  if (companyId !== null) {
    params.push(companyId);
    conditions.push(`${alias}.company_id=$${params.length}`);
  }
  if ((user.role === "project_manager" || user.role === "designer") && projectExpression) {
    params.push(user.id);
    conditions.push(`EXISTS (SELECT 1 FROM project_members pm_analytics WHERE pm_analytics.project_id=${projectExpression} AND pm_analytics.user_id=$${params.length})`);
  }
  return { clause: conditions.length ? conditions.join(" AND ") : "TRUE", params };
}
