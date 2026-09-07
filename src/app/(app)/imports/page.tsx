import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { DataMigrationCenter } from "@/components/data-migration-center";
import { migrationDefinitions } from "@/data/data-migration-rules";
import { getDataMode } from "@/lib/data-mode";

export default async function ImportsPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const [user, query] = await Promise.all([requireSession(), searchParams]); if (!can(user, "imports")) notFound();
  const allowedTypes = migrationDefinitions.filter((definition) => can(user, definition.resource, "write")).map((definition) => definition.resource);
  const initialMode = query.mode === "folder" ? "folder" : "upload";
  return <main className="content migration-page"><div className="page-heading"><div><div className="eyebrow">真实业务试运行 · {getDataMode() === "real" ? "真实数据模式" : "演示模式"}</div><h1>数据迁移中心</h1><p className="page-description">原始文件先经过识别、版本判断、映射、预检与人工确认，再以事务方式写入正式业务库。</p></div></div><DataMigrationCenter allowedTypes={allowedTypes} dataMode={getDataMode()} initialMode={initialMode} isOwner={user.role === "owner"} /></main>;
}
