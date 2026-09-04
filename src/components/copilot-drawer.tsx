"use client";

import { Bot, X } from "lucide-react";
import { usePathname } from "next/navigation";
import type { SessionUser } from "@/lib/auth";
import { contextFromPathname } from "@/lib/ai-client";
import { AiAssistant } from "./ai-assistant";

export function CopilotDrawer({ role, open, onClose }: { role: SessionUser["role"]; open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  if (!open) return null;
  return <div className="copilot-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className="copilot-drawer" aria-label="AI 经营助手">
      <header><div><Bot /><div><strong>AI 经营助手</strong><span>只读分析 · 当前页面上下文</span></div></div><button className="icon-plain" onClick={onClose} aria-label="关闭 AI 助手"><X /></button></header>
      <AiAssistant compact role={role} pageContext={contextFromPathname(pathname)} />
    </aside>
  </div>;
}
