import type { SessionUser } from "@/lib/auth";
import { basePrompt } from "./base";
import { designerPrompt } from "./designer";
import { financePrompt } from "./finance";
import { ownerPrompt } from "./owner";
import { procurementPrompt } from "./procurement";
import { projectManagerPrompt } from "./project-manager";

const rolePrompts: Record<SessionUser["role"], string> = {
  owner: ownerPrompt,
  finance: financePrompt,
  procurement: procurementPrompt,
  project_manager: projectManagerPrompt,
  designer: designerPrompt,
};

export function buildSystemPrompt(user: SessionUser, pageContext: Record<string, unknown>) {
  const context = JSON.stringify(pageContext).slice(0, 2_000);
  return `${basePrompt}\n\n${rolePrompts[user.role]}\n\n当前页面上下文（仅用于解析“这个项目/这笔付款”等指代）：${context}`;
}
