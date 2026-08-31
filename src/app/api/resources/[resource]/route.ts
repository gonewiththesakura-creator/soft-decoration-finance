import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createResource } from "@/data/mutations";
import type { ResourceKey } from "@/lib/permissions";

export async function POST(request: Request, context: { params: Promise<{ resource: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { resource } = await context.params;
  try {
    const result = await createResource(resource as ResourceKey, await request.json(), user);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "新增失败";
    return NextResponse.json({ error: message }, { status: message === "FORBIDDEN" ? 403 : 400 });
  }
}
