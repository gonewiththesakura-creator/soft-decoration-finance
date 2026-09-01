import { exportMigrationErrors } from "@/data/data-migration";
import { getSession } from "@/lib/auth";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSession(); if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  try {
    const { id } = await context.params; const result = await exportMigrationErrors(Number(id), user);
    return new Response(Uint8Array.from(result.buffer), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}` } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "导出失败" }, { status: 400 }); }
}
