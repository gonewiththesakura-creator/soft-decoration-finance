import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { decidePayment, executePayment, getPaymentApprovalDetail } from "@/data/workflows";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSession(); if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { id } = await context.params;
  try { return NextResponse.json(await getPaymentApprovalDetail(Number(id), user)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "加载失败" }, { status: 400 }); }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSession(); if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { id } = await context.params;
  try {
    const body = await request.json();
    const result = body.action === "pay" ? await executePayment(Number(id), user, String(body.bankReceiptUrl ?? "")) : await decidePayment(Number(id), body.decision, String(body.comment ?? ""), user);
    return NextResponse.json({ ok: true, result });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "操作失败" }, { status: 400 }); }
}
