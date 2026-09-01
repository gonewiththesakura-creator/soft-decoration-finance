import * as XLSX from "xlsx";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { can, type ResourceKey } from "@/lib/permissions";
import { normalizeRows, validateNormalizedRows } from "@/data/excel";
import { importRowsAtomic, preflightImport } from "@/data/excel-import";

export async function POST(request: Request) {
  const user = await getSession(); if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 }); if (!can(user, "imports")) return NextResponse.json({ error: "无导入权限" }, { status: 403 });
  const contentType = request.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData(); const resource = String(form.get("resource") ?? ""); const file = form.get("file"); if (!(file instanceof File)) throw new Error("请选择 Excel 文件"); if (file.size > 8 * 1024 * 1024) throw new Error("文件不能超过 8MB");
      const book = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false }); const sheet = book.Sheets[book.SheetNames[0]]; const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false }); const normalized = normalizeRows(resource, rawRows);
      const checked = await preflightImport(resource as ResourceKey, normalized.rows, user);
      return NextResponse.json({ filename: file.name, totalRows: rawRows.length, rows: normalized.rows, sourceHash: checked.sourceHash, errors: [...normalized.errors, ...checked.errors.filter((error) => !normalized.errors.some((existing) => existing.row === error.row && existing.field === error.field && existing.message === error.message))] });
    }
    const body = await request.json(); const resource = String(body.resource ?? "") as ResourceKey; const rows = Array.isArray(body.rows) ? body.rows as Record<string, unknown>[] : []; const errors = validateNormalizedRows(resource, rows);
    const preflight = await preflightImport(resource, rows, user);
    if (!rows.length || errors.length || preflight.errors.length) return NextResponse.json({ error: "导入数据未通过完整预检，未写入任何数据", errors: [...errors, ...preflight.errors] }, { status: 400 });
    if (body.sourceHash && body.sourceHash !== preflight.sourceHash) return NextResponse.json({ error: "预览数据已变化，请重新上传预检" }, { status: 400 });
    const result = await importRowsAtomic(resource, rows, String(body.filename ?? "upload.xlsx"), preflight.sourceHash, preflight.companyId, user);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "导入失败" }, { status: 400 }); }
}
