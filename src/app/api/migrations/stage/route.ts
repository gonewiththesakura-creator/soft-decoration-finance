import { NextResponse } from "next/server";
import { stageMigrationBatch } from "@/data/data-migration";
import { getSession } from "@/lib/auth";
import type { ResourceKey } from "@/lib/permissions";

export async function POST(request: Request) {
  const user = await getSession(); if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  try {
    const body = await request.json();
    const result = await stageMigrationBatch({ batchId: Number(body.batchId), sheetId: Number(body.sheetId), businessType: String(body.businessType) as ResourceKey, mappings: body.mappings ?? {}, saveTemplateName: body.saveTemplateName }, user);
    return NextResponse.json(result);
  } catch (error) { const message = error instanceof Error ? error.message : "暂存预检失败"; return NextResponse.json({ error: message }, { status: message === "FORBIDDEN" ? 403 : 400 }); }
}
