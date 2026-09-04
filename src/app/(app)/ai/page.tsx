import { requireSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { notFound } from "next/navigation";
import { AiAssistant } from "@/components/ai-assistant";

export default async function AiPage() {
  const user = await requireSession(); if (!can(user, "ai")) notFound();
  return <main className="content ai-page"><div className="page-heading"><div><div className="eyebrow">REAL AI CORE · 只读分析</div><h1>AI 经营助手</h1><p className="page-description">通过授权业务工具读取实时数据，保留多轮历史、数据依据与运行审计。</p></div></div><AiAssistant role={user.role} pageContext={{ pathname: "/ai", pageType: "ai_workspace" }} /></main>;
}
