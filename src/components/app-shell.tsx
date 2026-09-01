"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Link from "next/link";
import {
  BadgeDollarSign, Banknote, BookOpenCheck, Boxes, Building2, ClipboardCheck, FileClock,
  FileSpreadsheet, FileText, FolderKanban, HandCoins, History, LayoutDashboard, LogOut,
  Menu, PackageCheck, ReceiptText, SearchCheck, Sparkles, Tags, Truck, Users, WalletCards, X,
} from "lucide-react";
import type { SessionUser } from "@/lib/auth";
import { can, roleLabels, type ResourceKey } from "@/lib/permissions";
import { logoutAction, setCompanyScope } from "@/app/(app)/actions";

type Company = { id: number; name: string };
const groups = [
  { label: "总览", items: [{ href: "/dashboard", label: "老板首页", icon: LayoutDashboard, resource: "projects" as ResourceKey }] },
  { label: "项目经营", items: [{ href: "/projects", label: "项目", icon: FolderKanban, resource: "projects" as ResourceKey }, { href: "/contracts", label: "合同", icon: FileText, resource: "contracts" as ResourceKey }, { href: "/receivables", label: "应收计划", icon: FileClock, resource: "receivables" as ResourceKey }, { href: "/receipts", label: "收款记录", icon: HandCoins, resource: "receipts" as ResourceKey }, { href: "/changes", label: "预算与变更", icon: BookOpenCheck, resource: "changes" as ResourceKey }] },
  { label: "采购", items: [{ href: "/skus", label: "SKU 明细", icon: Tags, resource: "skus" as ResourceKey }, { href: "/quotes", label: "报价与核价", icon: SearchCheck, resource: "quotes" as ResourceKey }, { href: "/purchase-requests", label: "采购申请 / 审批", icon: ClipboardCheck, resource: "purchase-requests" as ResourceKey }, { href: "/purchase-orders", label: "采购订单", icon: Truck, resource: "purchase-orders" as ResourceKey }, { href: "/inventory", label: "库存批次", icon: Boxes, resource: "inventory" as ResourceKey }, { href: "/returns", label: "退换货与冲销", icon: PackageCheck, resource: "returns" as ResourceKey }] },
  { label: "财务", items: [{ href: "/accounts", label: "资金账户", icon: WalletCards, resource: "accounts" as ResourceKey }, { href: "/payables", label: "供应商应付", icon: Banknote, resource: "payables" as ResourceKey }, { href: "/payment-requests", label: "付款申请 / 审批", icon: BadgeDollarSign, resource: "payment-requests" as ResourceKey }, { href: "/payments", label: "付款记录", icon: ReceiptText, resource: "payments" as ResourceKey }, { href: "/invoices", label: "发票台账", icon: FileText, resource: "invoices" as ResourceKey }] },
  { label: "基础资料", items: [{ href: "/companies", label: "公司", icon: Building2, resource: "companies" as ResourceKey }, { href: "/customers", label: "客户", icon: Users, resource: "customers" as ResourceKey }, { href: "/suppliers", label: "供应商", icon: Boxes, resource: "suppliers" as ResourceKey }, { href: "/users", label: "用户与角色", icon: Users, resource: "users" as ResourceKey }] },
  { label: "工具与审计", items: [{ href: "/imports", label: "Excel 导入导出", icon: FileSpreadsheet, resource: "imports" as ResourceKey }, { href: "/audit-logs", label: "操作日志", icon: History, resource: "audit-logs" as ResourceKey }, { href: "/ai", label: "AI 财务助手", icon: Sparkles, resource: "ai" as ResourceKey }] },
];

export function AppShell({ user, companies, currentScope, children }: { user: SessionUser; companies: Company[]; currentScope: number | null; children: React.ReactNode }) {
  const pathname = usePathname(); const router = useRouter(); const [open, setOpen] = useState(false); const [, startTransition] = useTransition();
  function changeScope(value: string) { startTransition(async () => { await setCompanyScope(value); router.refresh(); }); }
  return (
    <div className="app-shell">
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="brand"><div className="brand-mark">衡</div><div><div className="brand-title">织衡经营财务</div><div className="brand-sub">项目经营中枢</div></div><button className="icon-plain mobile-menu" style={{ marginLeft: "auto" }} onClick={() => setOpen(false)} aria-label="关闭菜单"><X /></button></div>
        <nav className="nav-scroll">{groups.map((group) => {
          const visible = group.items.filter((item) => can(user, item.resource)); if (!visible.length) return null;
          return <div className="nav-group" key={group.label}><div className="nav-label">{group.label}</div>{visible.map((item) => <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className={`nav-link ${pathname === item.href || (item.href === "/projects" && pathname.startsWith("/projects/")) ? "active" : ""}`}><item.icon />{item.label}</Link>)}</div>;
        })}</nav>
        <div className="sidebar-user"><div className="avatar">{user.name.slice(0, 1)}</div><div className="user-meta"><div className="user-name">{user.name}</div><div className="user-role">{roleLabels[user.role]}</div></div><form action={logoutAction}><button className="icon-plain" type="submit" aria-label="退出登录" title="退出登录"><LogOut /></button></form></div>
      </aside>
      <div className="main-column">
        <header className="topbar"><div className="topbar-left"><button className="icon-plain mobile-menu" onClick={() => setOpen(true)} aria-label="打开菜单"><Menu /></button><div><div className="scope-label">当前数据范围</div>{user.role === "owner" ? <select className="scope-select" value={currentScope ?? "all"} onChange={(event) => changeScope(event.target.value)}><option value="all">集团汇总 · 全部公司</option>{companies.map((company) => <option value={company.id} key={company.id}>{company.name}</option>)}</select> : <div className="scope-select">{companies.find((company) => company.id === user.companyId)?.name ?? "项目范围"}</div>}</div></div><div className="topbar-right"><div className="date-chip">{new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "short" }).format(new Date())}</div></div></header>
        {children}
      </div>
    </div>
  );
}
