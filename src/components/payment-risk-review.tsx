"use client";

import { AIInsightPanel } from "./ai-insight-panel";

export function PaymentRiskReview({ id, projectId }: { id: number; projectId: number }) {
  return <AIInsightPanel
    compact
    eyebrow="AI Risk Review"
    title="付款风险复核"
    description="核对欠票、超付和付款后账户余额；结论只读，不会触发审批或付款。"
    prompt="请复核这笔付款申请的欠票、超付、付款后余额和审批风险。先读取付款申请风险工具，再给出可核查的结论与建议。"
    pageContext={{ pageType: "payment_request", paymentRequestId: id, projectId }}
  />;
}
