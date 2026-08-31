import type { SessionUser } from "./auth";

export function companyCondition(scope: number | null, alias = "t", startIndex = 1) {
  return scope === null
    ? { sql: "TRUE", params: [] as unknown[], nextIndex: startIndex }
    : { sql: `${alias}.company_id = $${startIndex}`, params: [scope] as unknown[], nextIndex: startIndex + 1 };
}

export function projectAccessCondition(user: SessionUser, projectAlias = "p") {
  if (user.role !== "project_manager" && user.role !== "designer") return { sql: "TRUE", params: [] as unknown[] };
  return {
    sql: `EXISTS (SELECT 1 FROM project_members pm_scope WHERE pm_scope.project_id = ${projectAlias}.id AND pm_scope.user_id = $1)`,
    params: [user.id] as unknown[],
  };
}
