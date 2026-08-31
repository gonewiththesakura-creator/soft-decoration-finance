import * as XLSX from "xlsx";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getImportDefinition } from "@/data/excel";

export async function GET(_request: Request, context: { params: Promise<{ resource: string }> }) {
  if (!await getSession()) return NextResponse.json({ error: "请先登录" }, { status: 401 }); const { resource } = await context.params; const definition = getImportDefinition(resource); if (!definition) return NextResponse.json({ error: "模板不存在" }, { status: 404 });
  const sheet = XLSX.utils.json_to_sheet([definition.example], { header: definition.fields.map((field) => field.label) }); sheet["!cols"] = definition.fields.map((field) => ({ wch: Math.max(14, field.label.length * 2 + 4) })); const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, definition.label); const buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
  return new NextResponse(buffer, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${definition.label}导入模板.xlsx`)}` } });
}
