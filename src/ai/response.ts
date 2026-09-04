import { z } from "zod";
import type { AIEvidence } from "./tools/types";

const severity = z.enum(["none", "info", "warning", "critical"]);

export const aiResponseSchema = z.object({
  summary: z.string(),
  severity,
  metrics: z.array(z.object({ label: z.string(), value: z.string(), tone: severity })),
  findings: z.array(z.object({ title: z.string(), detail: z.string(), severity })),
  evidence: z.array(z.object({ label: z.string(), value: z.string(), href: z.string() })),
  recommendations: z.array(z.object({ title: z.string(), detail: z.string(), priority: z.enum(["low", "medium", "high"]) })),
  suggestedActions: z.array(z.object({ label: z.string(), description: z.string(), href: z.string(), kind: z.enum(["link", "draft"]) })),
  degraded: z.boolean(),
  notice: z.string(),
});

export type AIStructuredResponse = z.infer<typeof aiResponseSchema>;

export const aiResponseJSONSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    severity: { type: "string", enum: ["none", "info", "warning", "critical"] },
    metrics: { type: "array", items: { type: "object", properties: { label: { type: "string" }, value: { type: "string" }, tone: { type: "string", enum: ["none", "info", "warning", "critical"] } }, required: ["label", "value", "tone"], additionalProperties: false } },
    findings: { type: "array", items: { type: "object", properties: { title: { type: "string" }, detail: { type: "string" }, severity: { type: "string", enum: ["none", "info", "warning", "critical"] } }, required: ["title", "detail", "severity"], additionalProperties: false } },
    evidence: { type: "array", items: { type: "object", properties: { label: { type: "string" }, value: { type: "string" }, href: { type: "string" } }, required: ["label", "value", "href"], additionalProperties: false } },
    recommendations: { type: "array", items: { type: "object", properties: { title: { type: "string" }, detail: { type: "string" }, priority: { type: "string", enum: ["low", "medium", "high"] } }, required: ["title", "detail", "priority"], additionalProperties: false } },
    suggestedActions: { type: "array", items: { type: "object", properties: { label: { type: "string" }, description: { type: "string" }, href: { type: "string" }, kind: { type: "string", enum: ["link", "draft"] } }, required: ["label", "description", "href", "kind"], additionalProperties: false } },
    degraded: { type: "boolean" },
    notice: { type: "string" },
  },
  required: ["summary", "severity", "metrics", "findings", "evidence", "recommendations", "suggestedActions", "degraded", "notice"],
  additionalProperties: false,
} as const;

function extractJSONObject(raw: string) {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
}

export function parseAIResponse(raw: string) {
  try { return aiResponseSchema.safeParse(JSON.parse(extractJSONObject(raw))); }
  catch { return { success: false as const, error: new Error("INVALID_AI_JSON") }; }
}

export function mergeEvidence(response: AIStructuredResponse, evidence: AIEvidence[]) {
  const seen = new Set<string>();
  const merged: AIStructuredResponse["evidence"] = [];
  for (const item of evidence) {
    const normalized = { ...item, href: item.href ?? "" };
    const key = `${normalized.label}|${normalized.value}|${normalized.href}`;
    if (!seen.has(key)) { merged.push(normalized); seen.add(key); }
  }
  return { ...response, evidence: merged.slice(0, 12) };
}
