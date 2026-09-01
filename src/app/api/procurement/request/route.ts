import { NextResponse } from "next/server";
import { createWorkspacePurchaseRequest } from "@/data/procurement-workspace";
import { getSession } from "@/lib/auth";

export async function POST(request: Request) { const user = await getSession(); if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 }); try { const body = await request.json(); return NextResponse.json({ ok: true, result: await createWorkspacePurchaseRequest({ skuIds: Array.isArray(body.skuIds) ? body.skuIds.map(Number) : [], paymentType: String(body.paymentType ?? ""), reason: String(body.reason ?? "") }, user) }); } catch (error) { const message = error instanceof Error ? error.message : "采购申请提交失败"; return NextResponse.json({ error: message }, { status: message === "FORBIDDEN" ? 403 : 400 }); } }
