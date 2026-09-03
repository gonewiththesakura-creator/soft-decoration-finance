import { ArrowRight } from "lucide-react";

type Stage = { label: string; count: number };

export function ProcurementPipeline({ data }: { data: Stage[] }) {
  const total = data.reduce((sum, item) => sum + item.count, 0);
  return <div className="procurement-pipeline" aria-label="采购业务阶段">{data.map((item, index) => <div className="pipeline-step" key={item.label}><div><span>0{index + 1}</span><strong>{item.label}</strong></div><b>{item.count}</b><small>{total ? `${Math.round(item.count / total * 100)}%` : "0%"}</small>{index < data.length - 1 ? <ArrowRight aria-hidden="true" /> : null}</div>)}</div>;
}
