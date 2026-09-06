import type { ReactNode } from "react";

export function ExecutiveAmbientBackground({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`executive-ambient-background ${className}`.trim()}>
    <div className="executive-ambient-canvas" aria-hidden="true">
      <span className="executive-ambient-mesh" />
      <span className="executive-orb executive-orb-forest" />
      <span className="executive-orb executive-orb-champagne" />
      <span className="executive-orb executive-orb-cyan" />
      <span className="executive-orb executive-orb-neutral" />
      <span className="executive-ambient-grid" />
    </div>
    <div className="executive-ambient-content">{children}</div>
  </div>;
}
