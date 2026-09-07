import { NextResponse } from "next/server";
import { scanImportFolder } from "@/data/import-folder";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  try {
    const body = await request.json();
    return NextResponse.json(await scanImportFolder({ folderPath: String(body.folderPath ?? ""), recursive: Boolean(body.recursive) }, user));
  } catch (error) {
    const message = error instanceof Error ? error.message : "文件夹扫描失败";
    return NextResponse.json({ error: message === "FOLDER_SCAN_FORBIDDEN" ? "仅老板账号可扫描服务器文件夹" : message }, { status: message === "FOLDER_SCAN_FORBIDDEN" || message === "FORBIDDEN" ? 403 : 400 });
  }
}
