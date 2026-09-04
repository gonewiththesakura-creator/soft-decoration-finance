"use client";

import { useRef, useState } from "react";
import { LoaderCircle, RefreshCw, Sparkles, Square } from "lucide-react";
import type { AIStructuredResponse } from "@/ai/response";
import type { AIPageContext } from "@/ai/tools/types";
import { requestAI } from "@/lib/ai-client";
import { AIResponseView } from "./ai-response-view";

export function AIInsightPanel({ eyebrow = "AI Insight", title, description, prompt, pageContext, compact = false }: { eyebrow?: string; title: string; description: string; prompt: string; pageContext: AIPageContext; compact?: boolean }) {
  const [response, setResponse] = useState<AIStructuredResponse | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  async function analyze() {
    if (loading) return;
    const controller = new AbortController(); abortRef.current = controller;
    setLoading(true); setError(""); setStatus("正在连接 AI 服务...");
    try {
      const result = await requestAI({ question: prompt, pageContext, signal: controller.signal, onStatus: setStatus });
      setResponse(result.response);
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "AI 分析失败");
    } finally { setLoading(false); setStatus(""); abortRef.current = null; }
  }
  async function cancel() { abortRef.current?.abort(); await fetch("/api/ai/cancel", { method: "POST" }); setLoading(false); }
  return <section className={`ai-insight-panel ${compact ? "compact" : ""}`}>
    <div className="ai-insight-head"><div><span>{eyebrow}</span><h2>{title}</h2><p>{description}</p></div>{loading ? <button className="button danger" onClick={cancel}><Square />停止</button> : <button className="button" onClick={analyze}>{response ? <RefreshCw /> : <Sparkles />}{response ? "重新分析" : "生成分析"}</button>}</div>
    {loading ? <div className="ai-running"><LoaderCircle className="animate-spin" />{status}</div> : null}
    {error ? <div className="form-error">{error}</div> : null}
    {response ? <AIResponseView response={response} compact /> : null}
  </section>;
}
