"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { SessionUser } from "@/lib/auth";
import { contextFromPathname, contextLabelFromPathname } from "@/lib/ai-client";
import type { AIAssistantActivity } from "@/components/ai-assistant";
import { AIFloatingOrb, type AIFloatingOrbStatus } from "./ai-floating-orb";
import { AIFloatingWindow } from "./ai-floating-window";

export function GlobalAIAssistant({ role, ready }: { role: SessionUser["role"]; ready: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [activity, setActivity] = useState<AIAssistantActivity>("idle");
  const [contextLabel, setContextLabel] = useState(() => contextLabelFromPathname(pathname));
  const [focusRequest, setFocusRequest] = useState(0);
  const orbRef = useRef<HTMLButtonElement | null>(null);
  const attentionTimer = useRef<number | null>(null);
  const pageContext = useMemo(() => contextFromPathname(pathname), [pathname]);
  const status: AIFloatingOrbStatus = !ready ? "error" : activity === "thinking" ? "thinking" : activity === "warning" ? "warning" : activity === "error" ? "error" : "online";

  useEffect(() => {
    const entityName = document.querySelector<HTMLElement>("main h1, main .project-name")?.textContent;
    setContextLabel(contextLabelFromPathname(pathname, entityName));
  }, [pathname]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !open) return;
      setOpen(false);
      window.setTimeout(() => orbRef.current?.focus(), 0);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Let the triggering click and the panel transition settle before handing
    // keyboard focus to the conversation input.
    const focusTimer = window.setTimeout(() => document.querySelector<HTMLTextAreaElement>("#global-ai-window textarea")?.focus({ preventScroll: true }), 360);
    return () => window.clearTimeout(focusTimer);
  }, [open]);

  useEffect(() => () => { if (attentionTimer.current !== null) window.clearTimeout(attentionTimer.current); }, []);

  const handleActivity = useCallback((next: AIAssistantActivity) => {
    if (attentionTimer.current !== null) window.clearTimeout(attentionTimer.current);
    setActivity(next);
    if (next === "warning") attentionTimer.current = window.setTimeout(() => setActivity("idle"), 2_800);
  }, []);

  const toggle = () => {
    setOpen((current) => {
      const next = !current;
      if (next) setFocusRequest((value) => value + 1);
      return next;
    });
  };
  const close = () => { setOpen(false); window.setTimeout(() => orbRef.current?.focus(), 0); };

  return <div className={`global-ai-assistant ${open ? "window-open" : "window-collapsed"}`} data-status={status}>
    <AIFloatingOrb ref={orbRef} open={open} status={status} contextLabel={contextLabel} onClick={toggle} />
    <AIFloatingWindow open={open} status={status} contextLabel={contextLabel} pageContext={pageContext} role={role} focusRequest={focusRequest} onClose={close} onActivityChange={handleActivity} />
  </div>;
}
