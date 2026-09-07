import { NextResponse } from "next/server";
import { getImportMedia } from "@/data/data-migration";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ batchNumber: string; filename: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  try {
    const { batchNumber, filename } = await context.params;
    const image = await getImportMedia(batchNumber, filename, user);
    return new NextResponse(new Uint8Array(image.buffer), { headers: { "Content-Type": image.mimeType, "Content-Length": String(image.buffer.byteLength), "Cache-Control": "private, max-age=3600" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "图片读取失败" }, { status: 404 });
  }
}
