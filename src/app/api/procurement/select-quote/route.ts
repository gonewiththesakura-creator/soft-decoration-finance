import { NextResponse } from "next/server";
import { selectProcurementQuote } from "@/data/procurement-workspace";
import { getSession } from "@/lib/auth";

export async function POST(request: Request) { const user = await getSession(); if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 }); try { const body = await request.json(); await selectProcurementQuote(Number(body.skuId), Number(body.quoteId), user); return NextResponse.json({ ok: true }); } catch (error) { const message = error instanceof Error ? error.message : "选供失败"; return NextResponse.json({ error: message }, { status: message === "FORBIDDEN" ? 403 : 400 }); } }
