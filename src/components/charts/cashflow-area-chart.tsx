"use client";

import { useRouter } from "next/navigation";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { CashflowDrilldownItem, CashflowPoint } from "@/data/analytics/types";
import { formatMoney } from "@/lib/format";
import { ChartEmpty, ChartLegend, useReducedMotion } from "./chart-shell";

const legend = [
  { label: "预计余额", color: "var(--chart-balance)" },
  { label: "预计收款", color: "var(--chart-receivable)" },
  { label: "预计付款", color: "var(--chart-payable)" },
];

type CashflowTooltipPayload = { payload?: CashflowPoint };

function describeTopItem(item?: CashflowDrilldownItem | null) {
  if (!item) return null;
  return `${item.counterparty} / ${item.projectName} · ${formatMoney(item.amountCents, true)}`;
}

function CashflowTooltip({ active, payload, label }: { active?: boolean; payload?: readonly CashflowTooltipPayload[]; label?: string | number }) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  const topReceivable = describeTopItem(point.topReceivable);
  const topPayable = describeTopItem(point.topPayable);
  return <div className="chart-tooltip drilldown-tooltip cashflow-tooltip">
    <div className="chart-tooltip-title">{point.date || label}</div>
    <div className="chart-tooltip-row"><span><i className="chart-dot receivable-dot" />预计收款</span><strong>{formatMoney(point.receivableCents, true)}</strong></div>
    <div className="chart-tooltip-row"><span><i className="chart-dot payable-dot" />预计付款</span><strong>{formatMoney(point.payableCents, true)}</strong></div>
    <div className="chart-tooltip-row"><span><i className="chart-dot balance-dot" />预计余额</span><strong className={point.balanceCents < 0 ? "danger-text" : ""}>{formatMoney(point.balanceCents, true)}</strong></div>
    {topReceivable ? <div className="chart-tooltip-detail"><span>最大预计收款</span><strong>{topReceivable}</strong></div> : null}
    {topPayable ? <div className="chart-tooltip-detail"><span>最大预计付款</span><strong>{topPayable}</strong></div> : null}
    {point.riskMessage ? <div className="chart-tooltip-risk">{point.riskMessage}</div> : null}
    <div className="chart-tooltip-note">点击查看当日资金明细</div>
  </div>;
}

export function CashflowAreaChart({ data, ariaLabel = "未来三十天现金流趋势" }: { data: CashflowPoint[]; ariaLabel?: string }) {
  const reducedMotion = useReducedMotion();
  const router = useRouter();
  const firstGap = data.find((point) => point.balanceCents < 0);
  const pulsePoint = firstGap ?? data[0];
  if (!data.length) return <ChartEmpty title="暂无现金流预测" detail="录入应收与应付到期计划后自动生成。" />;
  return <div className="chart-frame living-cashflow-chart" role="group" aria-label={ariaLabel}>
    <div className="chart-stage tall">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 12, right: 8, left: 0, bottom: 0 }} onClick={(state) => { const index = Number(state?.activeIndex); const point = Number.isInteger(index) ? data[index] : undefined; if (point?.date) router.push(`/finance-workspace?date=${encodeURIComponent(point.date)}`); }} style={{ cursor: "pointer" }}>
          <defs><linearGradient id="executiveCashflowFill" x1="0" y1="0" x2="0" y2="1"><stop className="cashflow-gradient-breath" offset="0%" stopColor="var(--chart-balance)" stopOpacity=".22" /><stop offset="72%" stopColor="var(--chart-balance)" stopOpacity=".07" /><stop offset="100%" stopColor="var(--chart-balance)" stopOpacity="0" /></linearGradient></defs>
          <CartesianGrid vertical={false} strokeDasharray="3 4" />
          <XAxis dataKey="label" axisLine={false} tickLine={false} interval={4} />
          <YAxis axisLine={false} tickLine={false} width={60} tickFormatter={(value) => `${Math.round(Number(value) / 1_000_000)}万`} />
          <Tooltip content={<CashflowTooltip />} cursor={{ stroke: "var(--sage)", strokeDasharray: "3 3" }} />
          <ReferenceLine y={0} stroke="var(--chart-risk)" strokeDasharray="4 4" />
          <Area className="cashflow-breathing-area" name="预计余额" type="monotone" dataKey="balanceCents" stroke="var(--chart-balance)" fill="url(#executiveCashflowFill)" fillOpacity={1} strokeWidth={2.5} isAnimationActive={!reducedMotion} animationDuration={780} />
          <Line name="预计收款" type="monotone" dataKey="receivableCents" stroke="var(--chart-receivable)" strokeWidth={1.8} dot={false} activeDot={{ r: 4 }} isAnimationActive={!reducedMotion} animationDuration={640} />
          <Line name="预计付款" type="monotone" dataKey="payableCents" stroke="var(--chart-payable)" strokeWidth={1.8} dot={false} activeDot={{ r: 4 }} isAnimationActive={!reducedMotion} animationDuration={640} />
          {pulsePoint ? <ReferenceDot className={`cashflow-pulse-ring ${pulsePoint.balanceCents < 0 ? "is-risk" : ""}`} x={pulsePoint.label} y={pulsePoint.balanceCents} r={7} fill="transparent" stroke={pulsePoint.balanceCents < 0 ? "var(--chart-risk)" : "var(--chart-balance)"} strokeWidth={1.5} /> : null}
          {pulsePoint ? <ReferenceDot className="cashflow-pulse-core" x={pulsePoint.label} y={pulsePoint.balanceCents} r={4.5} fill={pulsePoint.balanceCents < 0 ? "var(--chart-risk)" : "var(--chart-balance)"} stroke="var(--surface)" strokeWidth={2} /> : null}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
    <ChartLegend items={legend} />
    <label className="chart-drill-select"><span>按日期查看资金明细</span><select defaultValue="" onChange={(event) => { if (event.target.value) router.push(`/finance-workspace?date=${encodeURIComponent(event.target.value)}`); }}><option value="" disabled>选择日期</option>{data.map((point) => <option key={point.date} value={point.date}>{point.label}</option>)}</select></label>
  </div>;
}
