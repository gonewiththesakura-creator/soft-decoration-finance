import { NextResponse } from "next/server";
import { getMigrationOverview } from "@/data/data-migration";
import { getSession } from "@/lib/auth";

export async function GET() {
  const user = await getSession(); if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  try { return NextResponse.json(await getMigrationOverview(user)); }
  catch (error) { const message = error instanceof Error ? error.message : "读取迁移批次失败"; return NextResponse.json({ error: message }, { status: message === "FORBIDDEN" ? 403 : 400 }); }
}
