import { NextResponse } from "next/server";
import { voidAttachment } from "@/data/attachments";
import { getSession } from "@/lib/auth";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSession(); if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  try { const { id } = await context.params; const body = await request.json(); await voidAttachment(Number(id), String(body.reason ?? ""), user); return NextResponse.json({ ok: true }); }
  catch (error) { const message = error instanceof Error ? error.message : "附件作废失败"; return NextResponse.json({ error: message }, { status: message === "FORBIDDEN" ? 403 : 400 }); }
}
