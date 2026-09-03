"use client";

import { useEffect, useRef, useState } from "react";
import { formatMoney } from "@/lib/format";
import { useReducedMotion } from "./chart-shell";

export function MetricCountUp({ valueCents, compact = true }: { valueCents: number; compact?: boolean }) {
  const reducedMotion = useReducedMotion();
  const [display, setDisplay] = useState(reducedMotion ? valueCents : 0);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (reducedMotion) { setDisplay(valueCents); return; }
    const started = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / 650);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(valueCents * eased));
      if (progress < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => { if (frame.current !== null) cancelAnimationFrame(frame.current); };
  }, [reducedMotion, valueCents]);

  return <>{formatMoney(display, compact)}</>;
}
