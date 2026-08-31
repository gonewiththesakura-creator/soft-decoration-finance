import type { ColumnDef } from "@/data/resources";
import { formatDate, formatMoney, formatRatio, getStatusTone } from "@/lib/format";

export function SimpleTable({ columns, rows }: { columns: ColumnDef[]; rows: Record<string, unknown>[] }) {
  return rows.length ? <div className="table-scroll"><table className="data-table"><thead><tr>{columns.map((column) => <th key={column.key} className={column.align === "right" ? "right" : ""}>{column.label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={String(row.id ?? index)}>{columns.map((column) => <td key={column.key} className={column.align === "right" ? "right" : ""}>{column.format === "money" ? <span className="money">{formatMoney(Number(row[column.key]))}</span> : column.format === "date" ? formatDate(row[column.key] as string) : column.format === "ratio" ? formatRatio(Number(row[column.key])) : column.format === "status" ? <span className={`badge ${getStatusTone(String(row[column.key]))}`}>{String(row[column.key])}</span> : column.format === "number" ? Number(row[column.key] ?? 0).toLocaleString("zh-CN") : String(row[column.key] ?? "-")}</td>)}</tr>)}</tbody></table></div> : <div className="empty">当前项目暂无该类记录</div>;
}
