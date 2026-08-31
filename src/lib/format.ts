export function formatMoney(cents: number | null | undefined, compact = false) {
  const value = (Number(cents) || 0) / 100;
  if (compact && Math.abs(value) >= 10_000) {
    return `¥${(value / 10_000).toLocaleString("zh-CN", { maximumFractionDigits: 1 })}万`;
  }
  return `¥${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatDate(value: string | Date | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

export function formatRatio(bps: number | null | undefined) {
  return `${((Number(bps) || 0) / 100).toFixed(0)}%`;
}

export function getStatusTone(status: string) {
  if (["已通过", "已付款", "已收", "已确认", "正常", "已收票", "已到货", "已生效", "完全关闭"].some((item) => status.includes(item))) return "success";
  if (["逾期", "驳回", "欠票", "超预算", "作废", "已取消", "争议"].some((item) => status.includes(item))) return "danger";
  if (["待审批", "待付", "待收", "部分", "审计", "待验收", "待核价"].some((item) => status.includes(item))) return "warning";
  return "neutral";
}
