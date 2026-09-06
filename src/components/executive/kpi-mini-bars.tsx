import type { CSSProperties } from "react";

export function KpiMiniBars({ values }: { values: number[] }) {
  const max = Math.max(...values.map((value) => Math.abs(value)), 1);

  return <span className="kpi-mini-trend" aria-hidden="true">
    {values.map((value, index) => {
      const style = {
        "--mini-bar-height": `${Math.max(18, Math.abs(value) / max * 100)}%`,
        "--mini-bar-delay": `${index * 48}ms`,
      } as CSSProperties;
      return <i key={index} style={style} />;
    })}
  </span>;
}
