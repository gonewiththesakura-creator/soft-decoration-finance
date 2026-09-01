import { NextResponse } from "next/server";
import { createAttachment, getAttachments } from "@/data/attachments";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await getSession(); if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const url = new URL(request.url);
  try { return NextResponse.json({ attachments: await getAttachments(String(url.searchParams.get("objectType") ?? ""), Number(url.searchParams.get("objectId")), user) }); }
  catch (error) { const message = error instanceof Error ? error.message : "加载附件失败"; return NextResponse.json({ error: message }, { status: message === "FORBIDDEN" ? 403 : 400 }); }
}

export async function POST(request: Request) {
  const user = await getSession(); if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  try {
    const form = await request.formData(); const file = form.get("file");
    if (!(file instanceof File)) throw new Error("请选择附件文件");
    const result = await createAttachment({ objectType: String(form.get("objectType") ?? ""), objectId: Number(form.get("objectId")), category: String(form.get("category") ?? "其他"), file }, user);
    return NextResponse.json({ ok: true, result });
  } catch (error) { const message = error instanceof Error ? error.message : "上传失败"; return NextResponse.json({ error: message }, { status: message === "FORBIDDEN" ? 403 : 400 }); }
}
