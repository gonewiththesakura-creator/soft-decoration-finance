import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { decidePayment, executePayment, getPaymentApprovalDetail } from "@/data/workflows";

function errorResponse(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  const status = message === "FORBIDDEN" || message.includes("无权") ? 403 : message.includes("不存在") ? 404 : 400;
  return NextResponse.json({ error: message }, { status });
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSession(); if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { id } = await context.params;
  try { return NextResponse.json(await getPaymentApprovalDetail(Number(id), user)); }
  catch (error) { return errorResponse(error, "加载失败"); }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSession(); if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { id } = await context.params;
  try {
    const body = await request.json();
    const result = body.action === "pay" ? await executePayment(Number(id), user, String(body.bankReceiptUrl ?? "")) : await decidePayment(Number(id), body.decision, String(body.comment ?? ""), user);
    return NextResponse.json({ ok: true, result });
  } catch (error) { return errorResponse(error, "操作失败"); }
}
