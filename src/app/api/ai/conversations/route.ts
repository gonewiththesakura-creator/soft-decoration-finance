import { createConversation, listConversations } from "@/ai/storage";
import { getCompanyScope, getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";

export async function GET() {
  const user = await getSession();
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  if (!can(user, "ai")) return Response.json({ error: "无权使用 AI 查询" }, { status: 403 });
  return Response.json({ conversations: await listConversations(user, await getCompanyScope(user)) });
}
export async function POST(request: Request) {
  const user = await getSession();
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  if (!can(user, "ai")) return Response.json({ error: "无权使用 AI 查询" }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { title?: unknown; pageContext?: unknown };
  const context = body.pageContext && typeof body.pageContext === "object" ? body.pageContext as Record<string, unknown> : {};
  const conversation = await createConversation(user, await getCompanyScope(user), String(body.title ?? "新对话"), context);
  return Response.json({ conversation }, { status: 201 });
}
