"use client";

import Link from "next/link";
import { Bot, Maximize2, Minus, X } from "lucide-react";
import type { SessionUser } from "@/lib/auth";
import type { AIPageContext } from "@/ai/tools/types";
import { AiAssistant, type AIAssistantActivity } from "@/components/ai-assistant";
import type { AIFloatingOrbStatus } from "./ai-floating-orb";

const statusLabels: Record<AIFloatingOrbStatus, string> = {
  online: "AI Online",
  thinking: "正在分析当前页面",
  warning: "发现需要关注的经营事项",
  error: "服务降级或暂不可用",
};

export function AIFloatingWindow({ open, status, contextLabel, pageContext, role, focusRequest, onClose, onActivityChange }: { open: boolean; status: AIFloatingOrbStatus; contextLabel: string; pageContext: AIPageContext; role: SessionUser["role"]; focusRequest: number; onClose: () => void; onActivityChange: (activity: AIAssistantActivity) => void }) {
  return <section id="global-ai-window" className={`global-ai-window ${open ? "is-open" : "is-collapsed"}`} aria-label="AI 经营助手" aria-hidden={!open}>
    <header className="global-ai-window-head">
      <div className="global-ai-identity"><span><Bot aria-hidden="true" /></span><div><strong>AI 经营助手</strong><small className={`status-${status}`}><i aria-hidden="true" />{statusLabels[status]}</small></div></div>
      <div className="global-ai-window-tools">
        <button type="button" onClick={onClose} aria-label="最小化 AI 助手" title="最小化"><Minus aria-hidden="true" /></button>
        <Link href="/ai" onClick={onClose} aria-label="在 AI 工作台中展开" title="展开到 AI 工作台"><Maximize2 aria-hidden="true" /></Link>
        <button type="button" onClick={onClose} aria-label="关闭 AI 助手" title="关闭"><X aria-hidden="true" /></button>
      </div>
    </header>
    <div className="global-ai-context"><span>当前上下文</span><strong>{contextLabel}</strong></div>
    <div className="global-ai-window-body"><AiAssistant compact role={role} pageContext={pageContext} focusRequest={focusRequest} onActivityChange={onActivityChange} /></div>
  </section>;
}
