import { NextResponse } from "next/server";
import { bindMigrationContext } from "@/data/data-migration";
import { getSession } from "@/lib/auth";
import type { ImportScope } from "@/data/import-intelligence";

export async function POST(request: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  try {
    const body = await request.json();
    const scope = String(body.scope ?? "") as ImportScope;
    if (!(["PROJECT", "COMPANY", "MASTER"] as string[]).includes(scope)) throw new Error("请选择有效的数据归属");
    const result = await bindMigrationContext({
      batchId: Number(body.batchId),
      scope: scope as Exclude<ImportScope, "PENDING">,
      projectId: body.projectId ? Number(body.projectId) : null,
      projectName: String(body.projectName ?? ""),
      projectCode: String(body.projectCode ?? ""),
      createProject: Boolean(body.createProject),
      companyId: body.companyId ? Number(body.companyId) : null,
      companyName: String(body.companyName ?? ""),
      createCompany: Boolean(body.createCompany),
      overrideConflict: Boolean(body.overrideConflict),
    }, user);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "数据归属确认失败";
    const labels: Record<string, string> = {
      PROJECT_CONTEXT_REQUIRED: "项目数据必须先新建或选择目标项目",
      PROJECT_NOT_FOUND: "未找到匹配项目，请选择已有项目或确认新建",
      COMPANY_CONTEXT_REQUIRED: "公司级数据必须先新建或选择公司",
      COMPANY_NOT_FOUND: "未找到匹配公司，请选择已有公司或确认新建",
    };
    return NextResponse.json({ error: labels[message] ?? message }, { status: message === "FORBIDDEN" ? 403 : 400 });
  }
}
