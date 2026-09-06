"use client";

import { forwardRef } from "react";
import { Sparkles } from "lucide-react";

export type AIFloatingOrbStatus = "online" | "thinking" | "warning" | "error";

const statusLabels: Record<AIFloatingOrbStatus, string> = {
  online: "AI Online",
  thinking: "AI 正在分析",
  warning: "AI 发现需关注事项",
  error: "AI 服务暂不可用",
};

export const AIFloatingOrb = forwardRef<HTMLButtonElement, { open: boolean; status: AIFloatingOrbStatus; contextLabel: string; onClick: () => void }>(function AIFloatingOrb({ open, status, contextLabel, onClick }, ref) {
  return <div className="ai-floating-orb-wrap">
    <button ref={ref} type="button" className={`ai-floating-orb status-${status}`} onClick={onClick} aria-label={open ? "收起 AI 经营助手" : "打开 AI 经营助手"} aria-expanded={open} aria-controls="global-ai-window" aria-describedby="global-ai-orb-tooltip">
      <span className="ai-orb-ambient" aria-hidden="true" />
      <span className="ai-orb-halo ai-orb-halo-a" aria-hidden="true" />
      <span className="ai-orb-halo ai-orb-halo-b" aria-hidden="true" />
      <span className="ai-orb-core"><Sparkles aria-hidden="true" /><i aria-hidden="true" /></span>
    </button>
    <div id="global-ai-orb-tooltip" className="ai-orb-tooltip" role="tooltip">
      <strong>AI 经营助手</strong>
      <span>问我当前页面的数据</span>
      <small>{statusLabels[status]} · 当前上下文：{contextLabel}</small>
    </div>
  </div>;
});
