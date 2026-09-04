"use client";

import Link from "next/link";
import { ArrowRight, CircleAlert, ShieldCheck } from "lucide-react";
import type { AIStructuredResponse } from "@/ai/response";

export function AIResponseView({ response, compact = false }: { response: AIStructuredResponse; compact?: boolean }) {
  return <div className={`ai-response ${compact ? "compact" : ""}`}>
    {response.degraded ? <div className="ai-degraded"><CircleAlert />{response.notice}</div> : response.notice ? <div className="ai-notice"><ShieldCheck />{response.notice}</div> : null}
    <div className="ai-summary"><span className={`ai-severity ${response.severity}`} />{response.summary}</div>
    {response.metrics.length ? <div className="ai-metrics">{response.metrics.map((metric, index) => <div key={`${metric.label}-${index}`}><span>{metric.label}</span><strong className={`tone-${metric.tone}`}>{metric.value}</strong></div>)}</div> : null}
    {response.findings.length ? <div className="ai-findings">{response.findings.map((finding, index) => <div key={`${finding.title}-${index}`}><span className={`ai-severity ${finding.severity}`} /><div><strong>{finding.title}</strong><p>{finding.detail}</p></div></div>)}</div> : null}
    {response.recommendations.length ? <div className="ai-recommendations"><h4>建议</h4>{response.recommendations.map((item, index) => <div key={`${item.title}-${index}`}><span className={`recommendation-priority ${item.priority}`}>{item.priority === "high" ? "高" : item.priority === "medium" ? "中" : "低"}</span><div><strong>{item.title}</strong><p>{item.detail}</p></div></div>)}</div> : null}
    {response.evidence.length ? <div className="ai-evidence"><h4>数据依据</h4>{response.evidence.map((item, index) => item.href ? <Link href={item.href} key={`${item.label}-${index}`}><span>{item.label}</span><strong>{item.value}</strong><ArrowRight /></Link> : <div key={`${item.label}-${index}`}><span>{item.label}</span><strong>{item.value}</strong></div>)}</div> : null}
    {response.suggestedActions.length ? <div className="ai-actions">{response.suggestedActions.map((action, index) => action.href ? <Link className="button small" href={action.href} key={`${action.label}-${index}`} title={action.description}>{action.label}<ArrowRight /></Link> : <button className="button small" disabled key={`${action.label}-${index}`} title="草案建议需人工确认后执行">{action.label}</button>)}</div> : null}
  </div>;
}
