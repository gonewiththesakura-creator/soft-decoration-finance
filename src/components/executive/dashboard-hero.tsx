import Link from "next/link";
import { ArrowRight, Bot, CalendarDays, CircleAlert, Landmark, Sparkles } from "lucide-react";
import { formatMoney } from "@/lib/format";

export type ExecutivePriority = { label: string; detail: string; href: string; tone: "warning" | "danger" | "opportunity" };

export function DashboardHero({ name, greeting, date, scopeLabel, balanceCents, balanceAccessible, projectedBalanceCents, gapDate, priorities, aiEnabled, aiReady }: { name: string; greeting: string; date: string; scopeLabel: string; balanceCents: number | null; balanceAccessible: boolean; projectedBalanceCents: number | null; gapDate?: string; priorities: ExecutivePriority[]; aiEnabled: boolean; aiReady: boolean }) {
  const attention = Boolean(gapDate || priorities.some((item) => item.tone === "danger"));
  const ownerName = `${name.slice(0, 1)}总`;
  return <section className="executive-hero" aria-labelledby="executive-command-title">
    <div className="executive-hero-visual" aria-hidden="true">
      <span className="executive-hero-mesh" />
      <span className="executive-hero-glow executive-hero-glow-sage" />
      <span className="executive-hero-glow executive-hero-glow-gold" />
      <span className="executive-hero-grid" />
      <svg className="executive-flow-lines" viewBox="0 0 1200 360" preserveAspectRatio="none">
        <defs>
          <linearGradient id="executive-flow-gradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#9bc4b5" stopOpacity="0" />
            <stop offset="0.45" stopColor="#9bc4b5" stopOpacity="0.8" />
            <stop offset="1" stopColor="#d5bb7f" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d="M-90 276 C 180 188, 310 304, 552 206 S 922 120, 1290 206" />
        <path d="M-80 156 C 214 258, 342 76, 616 164 S 1010 270, 1280 112" />
        <path d="M-120 324 C 182 250, 380 346, 682 250 S 1010 164, 1300 238" />
      </svg>
    </div>
    <div className="executive-hero-main">
      <div className="executive-hero-meta"><span><CalendarDays />{date}</span><span><Landmark />{scopeLabel}</span><span className={attention ? "status-attention" : "status-steady"}><i />{attention ? "经营状态 · 需要关注" : "经营状态 · 稳健"}</span>{aiEnabled ? <span className={`executive-ai-status ${aiReady ? "" : "is-unavailable"}`}><i />{aiReady ? "AI Ready" : "AI 未配置"}</span> : null}</div>
      <div className="executive-greeting"><span className="section-kicker">Executive Command Center</span><h1 id="executive-command-title">{greeting}，{ownerName}</h1><p>{gapDate ? `未来 30 天在 ${gapDate} 可能出现阶段性资金压力，今天应优先处理回款与审批。` : "未来 30 天资金暂未出现缺口，今天可聚焦逾期回款、审批与高风险项目。"}</p></div>
      <div className="executive-balance-line">
        <div><span>当前资金</span><strong>{balanceAccessible && balanceCents !== null ? formatMoney(balanceCents, true) : "当前账号无权限查看"}</strong></div>
        <ArrowRight aria-hidden="true" />
        <div><span>30 天预计余额</span><strong>{projectedBalanceCents === null ? "未纳入本次分析" : formatMoney(projectedBalanceCents, true)}</strong></div>
      </div>
      {aiEnabled ? <div className="executive-hero-actions"><a className="button executive-ai-button" href="#daily-brief"><Sparkles />生成今日经营简报</a><Link className="button executive-ghost-button" href="/ai"><Bot />进入 AI 工作台</Link></div> : null}
    </div>
    <aside className="risk-pulse" aria-label="今日优先事项">
      <div className="risk-pulse-head"><div><span>Today&apos;s focus</span><strong>今日优先</strong></div><CircleAlert /></div>
      <div className="risk-pulse-list">{priorities.slice(0, 3).map((item, index) => <Link href={item.href} key={`${item.label}-${index}`} className={item.tone}><b>{String(index + 1).padStart(2, "0")}</b><span><strong>{item.label}</strong><small>{item.detail}</small></span><ArrowRight /></Link>)}</div>
    </aside>
  </section>;
}
