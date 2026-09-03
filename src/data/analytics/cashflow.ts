import type { CashflowPoint } from "./types";

export type DailyFlow = { date: string; receivableCents: number; payableCents: number };

export function buildCashflowForecast(startingBalanceCents: number, rows: DailyFlow[]): CashflowPoint[] {
  let balanceCents = startingBalanceCents;
  return rows.map((row) => {
    balanceCents += Number(row.receivableCents) - Number(row.payableCents);
    const date = new Date(`${row.date}T00:00:00`);
    return {
      date: row.date,
      label: `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`,
      receivableCents: Number(row.receivableCents),
      payableCents: Number(row.payableCents),
      balanceCents,
    };
  });
}
export function groupCashflowByWeek(points: CashflowPoint[]) {
  const groups: { label: string; receivableCents: number; payableCents: number }[] = [];
  for (let start = 0; start < points.length; start += 7) {
    const week = points.slice(start, start + 7);
    if (!week.length) continue;
    groups.push({
      label: `${week[0].label}-${week[week.length - 1].label}`,
      receivableCents: week.reduce((sum, row) => sum + row.receivableCents, 0),
      payableCents: week.reduce((sum, row) => sum + row.payableCents, 0),
    });
  }
  return groups;
}

export function projectedBalance(points: CashflowPoint[], day: number, fallback: number) {
  if (!points.length) return fallback;
  return points[Math.min(Math.max(day, 1), points.length) - 1]?.balanceCents ?? fallback;
}
