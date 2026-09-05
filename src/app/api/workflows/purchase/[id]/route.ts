import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { decidePurchase, getPurchaseApprovalDetail } from "@/data/workflows";

function errorResponse(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  const status = message === "FORBIDDEN" || message.includes("无权") ? 403 : message.includes("不存在") ? 404 : 400;
  return NextResponse.json({ error: message }, { status });
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSession(); if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { id } = await context.params;
  try { return NextResponse.json(await getPurchaseApprovalDetail(Number(id), user)); }
  catch (error) { return errorResponse(error, "加载失败"); }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSession(); if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { id } = await context.params;
  try { const body = await request.json(); return NextResponse.json({ ok: true, result: await decidePurchase(Number(id), body.decision, String(body.comment ?? ""), user) }); }
  catch (error) { return errorResponse(error, "审批失败"); }
}
