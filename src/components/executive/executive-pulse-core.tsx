export type ExecutivePulseStatus = "steady" | "attention" | "risk";

const statusLabels: Record<ExecutivePulseStatus, string> = {
  steady: "稳健",
  attention: "需要关注",
  risk: "风险",
};

export function ExecutivePulseCore({ status, detail }: { status: ExecutivePulseStatus; detail: string }) {
  return <div className={`executive-pulse-core status-${status}`} role="img" aria-label={`经营状态：${statusLabels[status]}。${detail}`}>
    <span className="executive-pulse-ambient" aria-hidden="true" />
    <span className="executive-pulse-ring ring-a" aria-hidden="true" />
    <span className="executive-pulse-ring ring-b" aria-hidden="true" />
    <span className="executive-pulse-inner" aria-hidden="true" />
    <span className="executive-pulse-copy"><small>Executive Pulse</small><strong>{statusLabels[status]}</strong><em>{detail}</em></span>
  </div>;
}
