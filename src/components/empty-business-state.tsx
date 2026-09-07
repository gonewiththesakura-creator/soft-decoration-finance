import Link from "next/link";
import { FolderOpen, Upload } from "lucide-react";

export function EmptyBusinessState({
  title = "尚未导入真实业务数据",
  description = "完成首次数据迁移后，这里会显示可追溯的经营与财务结果。",
  canImport = false,
  canScan = false,
}: {
  title?: string;
  description?: string;
  canImport?: boolean;
  canScan?: boolean;
}) {
  return <section className="empty-business-state" aria-label="真实数据空状态">
    <div className="empty-business-mark"><Upload /></div>
    <div><span className="section-kicker">Real Data</span><h1>{title}</h1><p>{description}</p></div>
    {canImport ? <div className="empty-business-actions"><Link className="button primary" href="/imports?mode=upload"><Upload />上传文件</Link>{canScan ? <Link className="button" href="/imports?mode=folder"><FolderOpen />扫描文件夹</Link> : null}</div> : null}
  </section>;
}
