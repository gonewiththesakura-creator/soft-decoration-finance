import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { voidResource } from "@/data/mutations";
import type { ResourceKey } from "@/lib/permissions";

export async function POST(request: Request, context: { params: Promise<{ resource: string; id: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { resource, id } = await context.params;
  try {
    const body = await request.json();
    await voidResource(resource as ResourceKey, Number(id), String(body.reason ?? "手工作废"), user);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "作废失败" }, { status: 400 });
  }
}
