import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { decidePurchase, getPurchaseApprovalDetail } from "@/data/workflows";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSession(); if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { id } = await context.params;
  try { return NextResponse.json(await getPurchaseApprovalDetail(Number(id), user)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "加载失败" }, { status: 400 }); }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSession(); if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { id } = await context.params;
  try { const body = await request.json(); return NextResponse.json({ ok: true, result: await decidePurchase(Number(id), body.decision, String(body.comment ?? ""), user) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "审批失败" }, { status: 400 }); }
}
