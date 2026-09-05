import Link from "next/link";
import { ArrowRight, CheckSquare2, CircleDollarSign, FileWarning, Gauge, TriangleAlert } from "lucide-react";
import { formatDate, formatMoney } from "@/lib/format";

export type ExecutiveAction = {
  id: string;
  type: "采购审批" | "付款审批" | "逾期应收" | "超预算" | "供应商欠票";
  title: string;
  project: string;
  amountCents: number;
  time?: string;
  risk: "medium" | "high";
  reason: string;
  suggestion: string;
  href: string;
};

const icons = { "采购审批": CheckSquare2, "付款审批": CircleDollarSign, "逾期应收": TriangleAlert, "超预算": Gauge, "供应商欠票": FileWarning };

export function ActionCenter({ actions }: { actions: ExecutiveAction[] }) {
  return <aside className="executive-action-center" aria-labelledby="action-center-title">
    <div className="executive-action-head"><div><span className="section-kicker">Action Center</span><h2 id="action-center-title">今日行动</h2><p>按资金影响与业务风险排序</p></div><strong>{actions.length}</strong></div>
    <div className="executive-action-list">{actions.slice(0, 7).map((action) => { const Icon = icons[action.type]; return <Link href={action.href} key={action.id} className={action.risk}>
      <Icon aria-hidden="true" /><div className="executive-action-copy"><span>{action.type} · {action.project}</span><strong>{action.title}</strong><small>{action.time ? formatDate(action.time) : "当前"} · {formatMoney(action.amountCents, true)}</small><div className="executive-action-hover"><b>{action.reason}</b><em>{action.suggestion}</em></div></div><ArrowRight aria-hidden="true" />
    </Link>; })}</div>
    {!actions.length ? <div className="executive-action-empty">当前没有需要立即处理的经营事项</div> : null}
  </aside>;
}
