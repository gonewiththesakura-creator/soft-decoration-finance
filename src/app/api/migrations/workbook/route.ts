import { NextResponse } from "next/server";
import { createMigrationWorkbook } from "@/data/data-migration";
import { getSession } from "@/lib/auth";

export async function POST(request: Request) {
  const user = await getSession(); if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  try {
    const form = await request.formData(); const file = form.get("file"); if (!(file instanceof File)) throw new Error("请选择 Excel 文件");
    return NextResponse.json(await createMigrationWorkbook(file, user));
  } catch (error) { const message = error instanceof Error ? error.message : "工作簿解析失败"; return NextResponse.json({ error: message }, { status: message === "FORBIDDEN" ? 403 : 400 }); }
}
