import type { SessionUser } from "@/lib/auth";

type Row = Record<string, unknown>;

export function projectAIDTO(detail: { project: Row; metrics: Row; risks: Row[] }, role: SessionUser["role"]) {
  const project = detail.project;
  const base = {
    projectId: project.id,
    projectCode: project.code,
    projectName: project.name,
    companyName: project.companyName,
    status: project.status,
    startDate: project.startDate,
    expectedEndDate: project.expectedEndDate,
    budgetCents: project.budgetCents,
  };
  const procurementMetrics = {
    appliedCents: detail.metrics.appliedCents,
    orderedCents: detail.metrics.orderedCents,
    deliveredCents: detail.metrics.deliveredCents,
    remainingBudgetCents: detail.metrics.remainingBudgetCents,
    pendingPurchases: detail.metrics.pendingPurchases,
  };
  if (role === "designer") return { project: base, metrics: procurementMetrics, risks: detail.risks.filter((risk) => /预算|采购|结束日期/.test(String(risk.label))) };
  const payableMetrics = {
    ...procurementMetrics,
    payableCents: detail.metrics.payableCents,
    paidCents: detail.metrics.paidCents,
    purchaseInvoicedCents: detail.metrics.purchaseInvoicedCents,
    missingInvoiceCents: detail.metrics.missingInvoiceCents,
  };
  if (role === "procurement") return { project: base, metrics: payableMetrics, risks: detail.risks.filter((risk) => /预算|采购|欠票|结束日期/.test(String(risk.label))) };
  return {
    project: { ...base, currentContractCents: project.currentContractCents },
    metrics: {
      ...payableMetrics,
      receivedCents: detail.metrics.receivedCents,
      receivableCents: detail.metrics.receivableCents,
      overdueReceivableCents: detail.metrics.overdueReceivableCents,
      projectCashCents: detail.metrics.projectCashCents,
      pendingPayments: detail.metrics.pendingPayments,
    },
    risks: detail.risks,
  };
}

export function supplierAIDTO(profile: { supplier: Row; metrics: Row }, operations: Row) {
  return {
    supplierId: profile.supplier.id,
    supplierName: profile.supplier.name,
    category: profile.supplier.category,
    orderCount: operations.orderCount,
    orderedCents: profile.metrics.orderedCents,
    paidCents: profile.metrics.paidCents,
    payableCents: profile.metrics.payableCents,
    missingInvoiceCents: profile.metrics.missingInvoiceCents,
    returnRate: operations.returnRate,
    averageLeadDays: operations.averageLeadDays,
  };
}

export function customerAIDTO(profile: { customer: Row; metrics: Row }) {
  return {
    customerId: profile.customer.id,
    customerName: profile.customer.name,
    customerType: profile.customer.type,
    projectCount: profile.metrics.projectCount,
    activeProjectCount: profile.metrics.activeProjectCount,
    contractCents: profile.metrics.contractCents,
    receivedCents: profile.metrics.receivedCents,
    receivableCents: profile.metrics.receivableCents,
    overdueCents: profile.metrics.overdueCents,
  };
}

export function purchaseRequestAIDTO(detail: { header: Row; items: Row[]; quotes: Row[]; approvals: Row[] }) {
  return {
    header: {
      requestId: detail.header.id,
      number: detail.header.number,
      projectId: detail.header.projectId,
      projectName: detail.header.projectName,
      supplierName: detail.header.supplierName,
      paymentType: detail.header.paymentType,
      amountCents: detail.header.amountCents,
      reason: detail.header.reason,
      status: detail.header.status,
      createdAt: detail.header.createdAt,
    },
    items: detail.items.map((item) => ({ skuId: item.skuId, skuCode: item.skuCode, skuName: item.skuName, quantity: item.quantity, unit: item.unit, budgetUnitCents: item.budgetUnitCents, finalUnitCents: item.finalUnitCents, itemAmountCents: item.itemAmountCents, overBudgetCents: item.overBudgetCents, overBudgetPercent: item.overBudgetPercent })),
    quotes: detail.quotes.map((quote) => ({ skuId: quote.skuId, supplierName: quote.supplierName, unitPriceCents: quote.unitPriceCents, freightCents: quote.freightCents, installCents: quote.installCents, taxRateBps: quote.taxRateBps, leadDays: quote.leadDays, status: quote.status })),
    approvals: detail.approvals.map((approval) => ({ decision: approval.decision, decidedAt: approval.decidedAt })),
  };
}

export function paymentRequestAIDTO(detail: { header: Row; approvals: Row[] }) {
  const header = detail.header;
  const balanceAccessible = header.accountBalanceAccessible === true;
  return {
    header: {
      requestId: header.id,
      number: header.number,
      projectId: header.projectId,
      projectName: header.projectName,
      supplierName: header.supplierName,
      orderNumber: header.orderNumber,
      payableNumber: header.payableNumber,
      requestAmountCents: header.requestAmountCents,
      payableAmountCents: header.payableAmountCents,
      paidCents: header.paidCents,
      remainingAfterCents: header.remainingAfterCents,
      missingInvoiceCents: header.missingInvoiceCents,
      invoiceStatus: header.invoiceStatus,
      status: header.status,
      reason: header.reason,
      accountBalance: balanceAccessible ? { accessible: true, balanceAfterCents: header.accountBalanceAfterCents } : { accessible: false },
    },
    approvals: detail.approvals.map((approval) => ({ decision: approval.decision, decidedAt: approval.decidedAt })),
  };
}
