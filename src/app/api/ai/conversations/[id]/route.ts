import { assertConversation, loadMessages } from "@/ai/storage";
import { getCompanyScope, getSession } from "@/lib/auth";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return Response.json({ error: "无效对话" }, { status: 400 });
  const conversation = await assertConversation(id, user, await getCompanyScope(user));
  return Response.json({ conversation, messages: await loadMessages(id) });
}
