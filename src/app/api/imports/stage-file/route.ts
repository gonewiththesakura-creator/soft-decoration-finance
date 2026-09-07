import { basename } from "node:path";
import { NextResponse } from "next/server";
import { createMigrationWorkbook } from "@/data/data-migration";
import { readAllowedImportFile } from "@/data/import-folder";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  try {
    const body = await request.json();
    const source = await readAllowedImportFile(String(body.path ?? ""), user);
    const file = new File([source.bytes], basename(source.pathname));
    return NextResponse.json(await createMigrationWorkbook(file, user, { channel: "FOLDER", sourcePath: source.pathname, modifiedAt: source.modifiedAt }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "文件暂存失败";
    return NextResponse.json({ error: message === "FOLDER_SCAN_FORBIDDEN" ? "仅老板账号可暂存服务器文件" : message }, { status: message === "FOLDER_SCAN_FORBIDDEN" || message === "FORBIDDEN" ? 403 : 400 });
  }
}
