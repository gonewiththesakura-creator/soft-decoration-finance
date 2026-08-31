import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { ExcelImporter } from "@/components/excel-importer";

export default async function ImportsPage() {
  const user = await requireSession(); if (!can(user, "imports")) notFound();
  return <main className="content"><div className="page-heading"><div><div className="eyebrow">批量数据工具</div><h1>Excel 导入 / 导出</h1><p className="page-description">模板下载、字段检查、数据预览、错误定位、确认写入和导入日志形成完整流程。</p></div></div><ExcelImporter /></main>;
}
