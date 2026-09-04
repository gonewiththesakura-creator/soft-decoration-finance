"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, History, LoaderCircle, MessageSquarePlus, Sparkles, Square } from "lucide-react";
import type { SessionUser } from "@/lib/auth";
import type { AIStructuredResponse } from "@/ai/response";
import type { AIPageContext } from "@/ai/tools/types";
import { requestAI } from "@/lib/ai-client";
import { AIResponseView } from "./ai-response-view";

type Message = { id?: number; role: "user" | "assistant"; content: string; structuredResponse?: AIStructuredResponse | null };
type Conversation = { id: number; title: string; messageCount: number; updatedAt: string };

const prompts = ["生成今日经营简报", "哪些客户逾期未付款？", "哪些项目需要优先关注？", "未来 7 天要付多少钱？", "未来 30 天有没有资金缺口？"];

export function AiAssistant({ pageContext = {}, compact = false, role }: { pageContext?: AIPageContext; compact?: boolean; role: SessionUser["role"] }) {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const refreshConversations = useCallback(async () => {
    if (compact) return;
    const response = await fetch("/api/ai/conversations");
    if (response.ok) setConversations(((await response.json()) as { conversations: Conversation[] }).conversations);
  }, [compact]);
  useEffect(() => { void refreshConversations(); }, [refreshConversations]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, status]);

  async function openConversation(id: number) {
    if (loading) return;
    const response = await fetch(`/api/ai/conversations/${id}`);
    const data = await response.json() as { messages?: Message[]; error?: string };
    if (!response.ok) { setError(data.error ?? "加载对话失败"); return; }
    setConversationId(id); setMessages(data.messages ?? []); setError("");
  }

  function newConversation() {
    if (loading) return;
    setConversationId(null); setMessages([]); setQuestion(""); setError("");
  }

  async function ask(value = question) {
    const current = value.trim();
    if (!current || loading) return;
    setLoading(true); setError(""); setStatus("正在连接 AI 服务..."); setQuestion("");
    setMessages((previous) => [...previous, { role: "user", content: current }]);
    const controller = new AbortController(); abortRef.current = controller;
    try {
      const result = await requestAI({ question: current, conversationId, pageContext, signal: controller.signal, onStatus: setStatus });
      setConversationId(result.conversationId);
      setMessages((previous) => [...previous, { role: "assistant", content: result.response.summary, structuredResponse: result.response }]);
      await refreshConversations();
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "AI 分析失败");
    } finally {
      setLoading(false); setStatus(""); abortRef.current = null;
    }
  }

  async function cancel() {
    abortRef.current?.abort();
    await fetch("/api/ai/cancel", { method: "POST" });
    setLoading(false); setStatus("");
  }

  const roleHint = role === "designer" ? "可查询参与项目的 SKU、预算和采购" : role === "procurement" ? "可查询采购、供应商、应付与欠票" : "可查询当前权限范围内的经营与财务数据";
  return <div className={`ai-layout-v14 ${compact ? "compact" : ""}`}>
    {!compact ? <aside className="ai-conversation-list"><button className="button ai-new-chat" onClick={newConversation}><MessageSquarePlus />新对话</button><div className="ai-history-label"><History />最近对话</div>{conversations.map((item) => <button className={conversationId === item.id ? "active" : ""} onClick={() => openConversation(item.id)} key={item.id}><strong>{item.title}</strong><span>{item.messageCount} 条消息</span></button>)}</aside> : null}
    <section className="ai-chat-v14">
      <div className="ai-messages-v14">
        {!messages.length && !loading ? <div className="ai-welcome"><Sparkles /><strong>从一个经营问题开始</strong><span>{roleHint}</span><div>{prompts.slice(0, compact ? 3 : 5).map((prompt) => <button key={prompt} onClick={() => ask(prompt)}>{prompt}</button>)}</div></div> : null}
        {messages.map((message, index) => message.role === "user" ? <div className="message user" key={message.id ?? index}>{message.content}</div> : <div className="message assistant ai-answer-message" key={message.id ?? index}>{message.structuredResponse ? <AIResponseView response={message.structuredResponse} compact={compact} /> : <div className="message-body">{message.content}</div>}</div>)}
        {loading ? <div className="ai-running"><LoaderCircle className="animate-spin" />{status}</div> : null}
        {error ? <div className="form-error">{error}</div> : null}<div ref={endRef} />
      </div>
      <div className="ai-input-v14"><textarea value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void ask(); } }} placeholder="输入经营问题，Enter 发送，Shift + Enter 换行" />{loading ? <button className="button danger ai-send" onClick={cancel} aria-label="停止分析"><Square /></button> : <button className="button primary ai-send" onClick={() => ask()} disabled={!question.trim()} aria-label="发送问题"><ArrowUp /></button>}</div>
    </section>
  </div>;
}
