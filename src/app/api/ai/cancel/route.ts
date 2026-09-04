import { cancelActiveAIRun } from "@/ai/run-registry";
import { getSession } from "@/lib/auth";

export async function POST() {
  const user = await getSession();
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  return Response.json({ cancelled: cancelActiveAIRun(user.id) });
}
