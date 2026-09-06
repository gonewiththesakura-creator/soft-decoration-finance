"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export function ExecutiveSection({ kicker, title, description, action, className = "", children }: { kicker: string; title: string; description: string; action?: ReactNode; className?: string; children: ReactNode }) {
  const sectionRef = useRef<HTMLElement>(null);
  const [revealState, setRevealState] = useState<"pending" | "visible">("pending");

  useEffect(() => {
    const section = sectionRef.current;
    if (!section || window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) {
      setRevealState("visible");
      return;
    }

    if (section.getBoundingClientRect().top <= window.innerHeight * 0.94) {
      setRevealState("visible");
      return;
    }

    setRevealState("pending");
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setRevealState("visible");
      observer.disconnect();
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  return <section ref={sectionRef} className={`os-section executive-section executive-reveal ${className}`} data-reveal={revealState}><header className="os-section-header"><div><span className="section-kicker">{kicker}</span><h2>{title}</h2><p>{description}</p></div>{action}</header>{children}</section>;
}
