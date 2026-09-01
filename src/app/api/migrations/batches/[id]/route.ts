import { NextResponse } from "next/server";
import { confirmMigrationBatch, getMigrationBatch, importMigrationBatch, rollbackMigrationBatch, updateStagingRow } from "@/data/data-migration";
import { getSession } from "@/lib/auth";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSession(); if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  try { const { id } = await context.params; const page = Number(new URL(request.url).searchParams.get("page") ?? 1); return NextResponse.json(await getMigrationBatch(Number(id), user, page)); }
  catch (error) { const message = error instanceof Error ? error.message : "读取批次失败"; return NextResponse.json({ error: message }, { status: 400 }); }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSession(); if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  try {
    const { id } = await context.params; const batchId = Number(id); const body = await request.json();
    if (body.action === "confirm") { await confirmMigrationBatch(batchId, user); return NextResponse.json({ ok: true }); }
    if (body.action === "import") return NextResponse.json({ ok: true, result: await importMigrationBatch(batchId, user) });
    if (body.action === "rollback") return NextResponse.json(await rollbackMigrationBatch(batchId, user));
    if (body.operation === "update-row") { await updateStagingRow(batchId, Number(body.rowId), body, user); return NextResponse.json({ ok: true }); }
    throw new Error("无效的批次操作");
  } catch (error) { const message = error instanceof Error ? error.message : "批次操作失败"; return NextResponse.json({ error: message }, { status: message === "FORBIDDEN" ? 403 : 400 }); }
}
