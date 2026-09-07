import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { DataMigrationCenter } from "@/components/data-migration-center";
import { migrationDefinitions } from "@/data/data-migration-rules";
import { getDataMode } from "@/lib/data-mode";

export default async function ImportsPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const [user, query] = await Promise.all([requireSession(), searchParams]); if (!can(user, "imports")) notFound();
  const allowedTypes = migrationDefinitions.filter((definition) => user.role === "owner" || can(user, definition.resource, "write")).map((definition) => definition.resource);
  const initialMode = query.mode === "folder" ? "folder" : "upload";
  return <main className="content migration-page"><div className="page-heading"><div><div className="eyebrow">项目级智能导入 · {getDataMode() === "real" ? "真实数据模式" : "演示模式"}</div><h1>数据迁移中心</h1><p className="page-description">上传后先确认数据归属，系统自动识别项目、业务事实和字段，只将不确定项交给人工确认。</p></div></div><DataMigrationCenter allowedTypes={allowedTypes} dataMode={getDataMode()} initialMode={initialMode} isOwner={user.role === "owner"} /></main>;
}
