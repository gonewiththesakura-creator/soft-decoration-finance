import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { DataMigrationCenter } from "@/components/data-migration-center";
import { migrationDefinitions } from "@/data/data-migration-rules";

export default async function ImportsPage() {
  const user = await requireSession(); if (!can(user, "imports")) notFound();
  const allowedTypes = migrationDefinitions.filter((definition) => can(user, definition.resource, "write")).map((definition) => definition.resource);
  return <main className="content migration-page"><div className="page-heading"><div><div className="eyebrow">真实业务试运行</div><h1>数据迁移中心</h1><p className="page-description">标准模板处理日常批量录入；历史迁移通过映射、关联匹配、暂存预检与人工确认进入正式业务库。</p></div></div><DataMigrationCenter allowedTypes={allowedTypes} /></main>;
}
