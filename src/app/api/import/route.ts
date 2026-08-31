import * as XLSX from "xlsx";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { can, type ResourceKey } from "@/lib/permissions";
import { normalizeRows } from "@/data/excel";
import { createResource } from "@/data/mutations";
import { sqlQuery } from "@/db/client";

export async function POST(request: Request) {
  const user = await getSession(); if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 }); if (!can(user, "imports")) return NextResponse.json({ error: "无导入权限" }, { status: 403 });
  const contentType = request.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData(); const resource = String(form.get("resource") ?? ""); const file = form.get("file"); if (!(file instanceof File)) throw new Error("请选择 Excel 文件"); if (file.size > 8 * 1024 * 1024) throw new Error("文件不能超过 8MB");
      const book = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false }); const sheet = book.Sheets[book.SheetNames[0]]; const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false }); const normalized = normalizeRows(resource, rawRows);
      return NextResponse.json({ filename: file.name, totalRows: rawRows.length, ...normalized });
    }
    const body = await request.json(); const resource = String(body.resource ?? "") as ResourceKey; const rows = Array.isArray(body.rows) ? body.rows as Record<string, unknown>[] : []; const checked = normalizeRows(resource, rows.map((row) => row));
    // Confirm payload is already normalized, so validate required keys directly.
    const errors: { row: number; field: string; message: string }[] = [];
    rows.forEach((row, index) => Object.entries(row).forEach(([key, value]) => { if (key && value === undefined) errors.push({ row: index + 2, field: key, message: "字段无效" }); }));
    if (!rows.length || errors.length) return NextResponse.json({ error: "导入数据未通过校验", errors: checked.errors.length ? checked.errors : errors }, { status: 400 });
    let success = 0; const importErrors: { row: number; field: string; message: string }[] = [];
    for (const [index, row] of rows.entries()) { try { await createResource(resource, row, user); success++; } catch (error) { importErrors.push({ row: index + 2, field: "业务校验", message: error instanceof Error ? error.message : "写入失败" }); } }
    const companyId = user.companyId ?? (Number(rows[0]?.companyId) || 1);
    await sqlQuery("INSERT INTO import_jobs(company_id,user_id,resource,filename,total_rows,success_rows,error_rows,status,errors) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)", [companyId, user.id, resource, String(body.filename ?? "upload.xlsx"), rows.length, success, importErrors.length, importErrors.length ? "部分完成" : "已完成", JSON.stringify(importErrors)]);
    return NextResponse.json({ ok: importErrors.length === 0, successRows: success, errorRows: importErrors.length, errors: importErrors });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "导入失败" }, { status: 400 }); }
}
