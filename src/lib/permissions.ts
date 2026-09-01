import type { SessionUser } from "./auth";

export type ResourceKey =
  | "companies" | "accounts" | "users" | "customers" | "suppliers" | "projects" | "contracts"
  | "receivables" | "receipts" | "skus" | "quotes" | "purchase-requests" | "purchase-orders"
  | "payables" | "payment-requests" | "payments" | "invoices" | "budgets" | "changes" | "returns"
  | "inventory" | "imports" | "audit-logs" | "ai";

const roleAccess: Record<SessionUser["role"], ResourceKey[] | "all"> = {
  owner: "all",
  finance: ["accounts", "customers", "suppliers", "projects", "contracts", "receivables", "receipts", "purchase-orders", "payables", "payment-requests", "payments", "invoices", "budgets", "changes", "returns", "imports", "audit-logs", "ai"],
  procurement: ["suppliers", "projects", "skus", "quotes", "purchase-requests", "purchase-orders", "payables", "returns", "inventory", "imports", "ai"],
  project_manager: ["customers", "suppliers", "projects", "contracts", "receivables", "skus", "quotes", "purchase-requests", "purchase-orders", "payables", "payment-requests", "budgets", "changes", "ai"],
  designer: ["projects", "skus", "quotes", "purchase-requests", "budgets", "changes", "ai"],
};

const writeAccess: Record<SessionUser["role"], ResourceKey[] | "all"> = {
  owner: ["companies", "accounts", "users", "customers", "suppliers", "projects", "imports"],
  finance: ["accounts", "customers", "contracts", "receivables", "receipts", "payables", "payment-requests", "payments", "invoices", "imports"],
  procurement: ["suppliers", "skus", "quotes", "purchase-requests", "returns", "inventory", "imports"],
  project_manager: ["projects", "payment-requests", "changes"],
  designer: [],
};

export function can(user: SessionUser, resource: ResourceKey, action: "read" | "write" = "read") {
  const access = action === "write" ? writeAccess[user.role] : roleAccess[user.role];
  return access === "all" || access.includes(resource);
}

export function assertCan(user: SessionUser, resource: ResourceKey, action: "read" | "write" = "read") {
  if (!can(user, resource, action)) throw new Error("FORBIDDEN");
}

export const roleLabels: Record<SessionUser["role"], string> = {
  owner: "老板", finance: "财务", procurement: "采购", project_manager: "项目经理", designer: "设计师",
};
