import { notFound } from "next/navigation";
import { AISettingsPanel } from "@/components/ai-settings-panel";
import { requireSession } from "@/lib/auth";

export default async function AISettingsPage() {
  const user = await requireSession();
  if (user.role !== "owner") notFound();
  return <main className="content operating-page ai-settings-page"><header className="operating-heading"><div><div className="eyebrow">系统管理 · 服务端配置</div><h1>AI 模型设置</h1><p className="page-description">查看连接状态与兼容性记录。模型、接口和密钥仍由服务端环境变量统一管理。</p></div></header><AISettingsPanel /></main>;
}
