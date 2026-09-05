import { sqlQuery } from "@/db/client";
import type { SessionUser } from "./auth";
import { assertCan, type ResourceKey } from "./permissions";

export type WorkflowType = "purchase" | "payment";

export async function assertProjectAccess(user: SessionUser, projectId: number) {
  const [project] = await sqlQuery<{ companyId: number }>(
    `SELECT company_id AS "companyId" FROM projects WHERE id=$1`,
    [projectId],
  );
  if (!project) throw new Error("项目不存在或无权查看");
  if (user.role === "owner") return;
  if (user.companyId !== project.companyId) throw new Error("项目不存在或无权查看");
  if (user.role === "project_manager" || user.role === "designer") {
    const [membership] = await sqlQuery<{ allowed: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM project_members WHERE project_id=$1 AND user_id=$2) AS allowed`,
      [projectId, user.id],
    );
    if (!membership?.allowed) throw new Error("项目不存在或无权查看");
  }
}

export async function assertWorkflowAccess(
  user: SessionUser,
  companyId: number,
  projectId: number,
  type: WorkflowType,
) {
  const resource: ResourceKey = type === "purchase" ? "purchase-requests" : "payment-requests";
  assertCan(user, resource, "read");
  if (user.role !== "owner" && user.companyId !== companyId) throw new Error("无权查看其他公司申请");
  await assertProjectAccess(user, projectId);
}
