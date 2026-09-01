import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { can, roleLabels, type ResourceKey } from "@/lib/permissions";

const roles = ["owner", "finance", "procurement", "project_manager", "designer"] as const;
const modules: { label: string; resource: ResourceKey }[] = [{ label: "公司", resource: "companies" }, { label: "客户", resource: "customers" }, { label: "供应商", resource: "suppliers" }, { label: "项目", resource: "projects" }, { label: "合同", resource: "contracts" }, { label: "应收 / 收款", resource: "receipts" }, { label: "SKU / 报价", resource: "quotes" }, { label: "采购", resource: "purchase-requests" }, { label: "应付", resource: "payables" }, { label: "付款", resource: "payments" }, { label: "发票", resource: "invoices" }, { label: "系统审计", resource: "audit-logs" }];

export default async function PermissionsPage() {
  const user = await requireSession(); if (!can(user, "users")) notFound();
  return <main className="content"><div className="page-heading"><div><div className="eyebrow">系统控制</div><h1>权限矩阵</h1><p className="page-description">按岗位查看模块读写范围。权限在服务端校验，界面隐藏不替代数据隔离。</p></div></div><section className="panel"><div className="table-scroll"><table className="data-table permission-table"><thead><tr><th>业务模块</th>{roles.map((role) => <th key={role}>{roleLabels[role]}</th>)}</tr></thead><tbody>{modules.map((module) => <tr key={module.resource}><td><strong>{module.label}</strong></td>{roles.map((role) => { const roleUser = { id: -1, name: roleLabels[role], email: "", role, companyId: role === "owner" ? null : -1 } as const; const read = can(roleUser, module.resource); const write = can(roleUser, module.resource, "write"); return <td key={role}><span className={`badge ${write ? "success" : read ? "warning" : "neutral"}`}>{write ? "读写" : read ? "只读" : "无权限"}</span></td>; })}</tr>)}</tbody></table></div></section></main>;
}
