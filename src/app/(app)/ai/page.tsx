import { requireSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { notFound } from "next/navigation";
import { AiAssistant } from "@/components/ai-assistant";

export default async function AiPage() {
  const user = await requireSession(); if (!can(user, "ai")) notFound();
  return <main className="content"><div className="page-heading"><div><div className="eyebrow">只读分析</div><h1>AI 财务助手</h1><p className="page-description">基于当前权限范围内的结构化业务数据，给出金额、依据和建议动作。</p></div></div><AiAssistant /></main>;
}
