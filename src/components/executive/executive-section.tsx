import type { ReactNode } from "react";

export function ExecutiveSection({ kicker, title, description, action, className = "", children }: { kicker: string; title: string; description: string; action?: ReactNode; className?: string; children: ReactNode }) {
  return <section className={`os-section executive-section ${className}`}><header className="os-section-header"><div><span className="section-kicker">{kicker}</span><h2>{title}</h2><p>{description}</p></div>{action}</header>{children}</section>;
}
