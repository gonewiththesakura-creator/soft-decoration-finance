import { NextResponse } from "next/server";
import { getAttachmentContent } from "@/data/attachments";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSession(); if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  try {
    const { id } = await context.params; const attachment = await getAttachmentContent(Number(id), user); const download = new URL(request.url).searchParams.get("download") === "1";
    const disposition = `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(attachment.originalFilename)}`;
    return new NextResponse(new Uint8Array(attachment.buffer), { headers: { "Content-Type": attachment.mimeType, "Content-Length": String(attachment.buffer.byteLength), "Content-Disposition": disposition, "Cache-Control": "private, no-store" } });
  } catch (error) { const message = error instanceof Error ? error.message : "附件读取失败"; return NextResponse.json({ error: message }, { status: message === "FORBIDDEN" ? 403 : 404 }); }
}
