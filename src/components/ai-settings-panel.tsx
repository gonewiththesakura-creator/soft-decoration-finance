"use client";

import { useEffect, useState } from "react";
import { Activity, CheckCircle2, Cpu, Gauge, LoaderCircle, Play, ShieldCheck, XCircle } from "lucide-react";

type Check = { status: string; provider: string; primaryModel: string; fastModel: string; apiMode: string; latencyMs: number; errorCode?: string; createdAt: string };
type Operations = { today: { requests: number; completed: number; failed: number; degraded: number; successRate: number; averageLatencyMs: number; inputTokens: number; outputTokens: number; totalTokens: number; toolCalls: number; primaryCalls: number; fastCalls: number; fallbackCount: number }; errors: Array<{ code: string; count: number }> };
type Settings = { configured: boolean; provider: string; baseUrl: string; primaryModel: string; fastModel: string; requestedMode: string; store: boolean; timeoutMs: number; limits: { perMinute: number; perDay: number; tokensPerDay: number }; operations: Operations; checks: Check[] };

export function AISettingsPanel() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  async function load() {
    const response = await fetch("/api/ai/health");
    const data = await response.json() as Settings & { error?: string };
    if (!response.ok) { setError(data.error ?? "读取 AI 配置失败"); return; }
    setSettings(data);
  }
  useEffect(() => { void load(); }, []);
  async function test() {
    setTesting(true); setError("");
    const response = await fetch("/api/ai/health", { method: "POST" });
    const data = await response.json() as { result?: { ok: boolean }; error?: string };
    if (!response.ok && !data.result) setError(data.error ?? "连接测试失败");
    await load(); setTesting(false);
  }
  if (!settings && !error) return <div className="ai-settings-loading"><LoaderCircle className="animate-spin" />正在读取服务端配置</div>;
  return <div className="ai-settings-stack">
    {error ? <div className="form-error">{error}</div> : null}
    {settings ? <>
      <section className="ai-settings-summary">
        <div className={settings.configured ? "ready" : "missing"}>{settings.configured ? <CheckCircle2 /> : <XCircle />}<div><strong>{settings.configured ? "服务端密钥已配置" : "服务端密钥未配置"}</strong><span>页面、接口和日志均不会返回密钥值</span></div></div>
        <button className="button primary" onClick={test} disabled={testing}>{testing ? <LoaderCircle className="animate-spin" /> : <Play />}{testing ? "正在测试" : "测试连接"}</button>
      </section>
      <section className="ai-config-grid">
        <div><span>Provider</span><strong>{settings.provider}</strong></div><div><span>Base URL</span><strong>{settings.baseUrl}</strong></div>
        <div><span>主模型</span><strong>{settings.primaryModel}</strong></div><div><span>快速模型</span><strong>{settings.fastModel}</strong></div>
        <div><span>接口模式</span><strong>{settings.requestedMode}</strong></div><div><span>请求超时</span><strong>{Math.round(settings.timeoutMs / 1000)} 秒</strong></div>
        <div><span>Provider 存储</span><strong>{settings.store ? "开启" : "关闭（store=false）"}</strong></div><div><span>安全边界</span><strong>服务端工具白名单</strong></div>
      </section>
      <section className="ai-operations" aria-labelledby="ai-operations-title">
        <div className="ai-operations-heading"><div><span className="section-kicker">AI Operations · Today</span><h2 id="ai-operations-title">模型运行概况</h2><p>统计今天完整 AI Run 的调用、延迟、Token 与降级情况。</p></div><Activity aria-hidden="true" /></div>
        <div className="ai-operations-metrics">
          <div><span>请求</span><strong>{settings.operations.today.requests}</strong><small>成功 {settings.operations.today.completed}</small></div>
          <div><span>成功率</span><strong>{settings.operations.today.successRate}%</strong><small>失败 {settings.operations.today.failed}</small></div>
          <div><span>平均延迟</span><strong>{settings.operations.today.averageLatencyMs.toLocaleString("zh-CN")} ms</strong><small>降级 {settings.operations.today.degraded}</small></div>
          <div><span>Total Tokens</span><strong>{settings.operations.today.totalTokens.toLocaleString("zh-CN")}</strong><small>输入 {settings.operations.today.inputTokens.toLocaleString("zh-CN")} · 输出 {settings.operations.today.outputTokens.toLocaleString("zh-CN")}</small></div>
          <div><span>工具调用</span><strong>{settings.operations.today.toolCalls}</strong><small>只读白名单</small></div>
        </div>
        <div className="ai-operations-detail">
          <div><div className="ai-detail-title"><Cpu />模型路由</div><dl><div><dt>Primary</dt><dd>{settings.operations.today.primaryCalls}</dd></div><div><dt>Fast</dt><dd>{settings.operations.today.fastCalls}</dd></div><div><dt>Fallback</dt><dd>{settings.operations.today.fallbackCount}</dd></div></dl></div>
          <div><div className="ai-detail-title"><ShieldCheck />错误分布</div>{settings.operations.errors.length ? <dl>{settings.operations.errors.map((item) => <div key={item.code}><dt>{item.code}</dt><dd>{item.count}</dd></div>)}</dl> : <p className="ai-ops-clear">今天暂无失败或降级</p>}</div>
          <div><div className="ai-detail-title"><Gauge />用量限额</div><dl><div><dt>每分钟</dt><dd>{settings.limits.perMinute}</dd></div><div><dt>每日请求</dt><dd>{settings.limits.perDay}</dd></div><div><dt>每日 Token</dt><dd>{settings.limits.tokensPerDay.toLocaleString("zh-CN")}</dd></div></dl></div>
        </div>
      </section>
      <section className="panel ai-check-history"><div className="panel-header"><div><div className="panel-title">连接测试记录</div><div className="panel-subtitle">仅保存状态、模型、接口模式、延迟和错误码</div></div><ShieldCheck /></div>{settings.checks.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>时间</th><th>状态</th><th>接口</th><th>主模型</th><th className="right">延迟</th><th>错误码</th></tr></thead><tbody>{settings.checks.map((check, index) => <tr key={`${check.createdAt}-${index}`}><td>{new Date(check.createdAt).toLocaleString("zh-CN")}</td><td><span className={`badge ${check.status === "passed" ? "success" : "danger"}`}>{check.status === "passed" ? "通过" : "失败"}</span></td><td>{check.apiMode || "-"}</td><td>{check.primaryModel}</td><td className="right">{check.latencyMs ?? "-"} ms</td><td>{check.errorCode || "-"}</td></tr>)}</tbody></table></div> : <div className="attachment-empty">尚无页面内连接测试记录</div>}</section>
    </> : null}
  </div>;
}
