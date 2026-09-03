import type { ProjectHealthResult } from "./types";

export type ProjectHealthInput = {
  contractCents: number;
  budgetCents: number;
  receivedCents: number;
  orderedCents: number;
  payableCents: number;
  paidCents: number;
  purchaseInvoicedCents: number;
  overdueReceivableCents: number;
};

const ratio = (value: number, total: number) => total > 0 ? Math.max(0, value / total) : 0;
const percentagePenalty = (value: number, total: number, maximum: number) => Math.min(maximum, ratio(value, total) * maximum);

export function calculateProjectHealth(input: ProjectHealthInput): ProjectHealthResult {
  const collectionRate = ratio(input.receivedCents, input.contractCents);
  const overBudgetCents = Math.max(0, input.orderedCents - input.budgetCents);
  const missingInvoiceCents = Math.max(0, input.payableCents - input.purchaseInvoicedCents);
  const fundingGapCents = Math.max(0, input.paidCents - input.receivedCents);
  const reasons: string[] = [];
  let penalty = 0;

  if (collectionRate < 0.4) { penalty += 10; reasons.push("回款率偏低"); }
  else if (collectionRate < 0.65) { penalty += 5; reasons.push("回款进度需关注"); }

  if (overBudgetCents > 0) {
    penalty += Math.max(8, percentagePenalty(overBudgetCents, input.budgetCents, 25));
    reasons.push("采购已超预算");
  }
  if (input.overdueReceivableCents > 0) {
    penalty += Math.max(8, percentagePenalty(input.overdueReceivableCents, input.contractCents, 25));
    reasons.push("存在逾期应收");
  }
  if (missingInvoiceCents > 0) {
    penalty += Math.max(4, percentagePenalty(missingInvoiceCents, input.payableCents, 14));
    reasons.push("进项发票覆盖不足");
  }
  if (fundingGapCents > 0) {
    penalty += Math.max(6, percentagePenalty(fundingGapCents, input.contractCents, 18));
    reasons.push("项目现金净额为负");
  }

  const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));
  if (score >= 80) return { score, label: "稳健", tone: "healthy", reasons };
  if (score >= 60) return { score, label: "关注", tone: "watch", reasons };
  return { score, label: "风险", tone: "risk", reasons };
}
export function percentage(value: number, total: number) {
  return total > 0 ? Math.round(Math.max(0, Math.min(1, value / total)) * 100) : 0;
}
