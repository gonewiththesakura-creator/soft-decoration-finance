export type CashflowPoint = {
  date: string;
  label: string;
  receivableCents: number;
  payableCents: number;
  balanceCents: number;
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
