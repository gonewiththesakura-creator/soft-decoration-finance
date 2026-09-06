export type CashflowPoint = {
  date: string;
  label: string;
  receivableCents: number;
  payableCents: number;
  balanceCents: number;
  topReceivable?: CashflowDrilldownItem | null;
  topPayable?: CashflowDrilldownItem | null;
  riskMessage?: string | null;
};

export type CashflowDrilldownItem = {
  id: number;
  projectId: number;
  projectName: string;
  counterparty: string;
  amountCents: number;
};

export type ExecutiveDashboardDetails = {
  topAccount: {
    id: number;
    accountName: string;
    companyName: string;
    balanceCents: number;
  } | null;
  overdue: {
    customerCount: number;
    maxCustomerName: string | null;
    maxAmountCents: number;
    longestOverdueDays: number;
  } | null;
  missingInvoices: {
    supplierCount: number;
    maxSupplierName: string | null;
    maxAmountCents: number;
  } | null;
};
export type BucketPoint = {
  label: string;
  valueCents: number;
};

export type HealthTone = "healthy" | "watch" | "risk";

export type ProjectHealthResult = {
  score: number;
  label: string;
  tone: HealthTone;
  reasons: string[];
};
