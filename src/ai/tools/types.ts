import type { AIToolDefinition } from "@/ai/providers/types";
import type { SessionUser } from "@/lib/auth";

export type AIPageContext = {
  pathname?: string;
  pageType?: string;
  projectId?: number;
  supplierId?: number;
  customerId?: number;
  purchaseRequestId?: number;
  paymentRequestId?: number;
};
export type AIToolContext = {
  user: SessionUser;
  companyScope: number | null;
  pageContext: AIPageContext;
};

export type AIEvidence = {
  label: string;
  value: string;
  href?: string;
};

export type AIToolResult = {
  summary: string;
  data: unknown;
  evidence: AIEvidence[];
};

export type RegisteredAITool = {
  definition: AIToolDefinition;
  roles: SessionUser["role"][];
  execute: (args: Record<string, unknown>, context: AIToolContext) => Promise<AIToolResult>;
};
