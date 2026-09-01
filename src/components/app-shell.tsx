"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Link from "next/link";
import {
  BadgeDollarSign, Banknote, Boxes, Building2, FileClock, FileSpreadsheet, FileText,
  FolderKanban, HandCoins, History, LayoutDashboard, LockKeyhole, LogOut, Menu,
  PackageCheck, ReceiptText, ShoppingCart, Tags, Truck, Users, WalletCards, X,
} from "lucide-react";
import type { SessionUser } from "@/lib/auth";
import { can, roleLabels, type ResourceKey } from "@/lib/permissions";
import { logoutAction, setCompanyScope } from "@/app/(app)/actions";

type Company = { id: number; name: string };
const groups = [
  { label: "首页", items: [{ href: "/dashboard", label: "经营总览", icon: LayoutDashboard, resource: "projects" as ResourceKey }] },
  { label: "项目", items: [{ href: "/projects", label: "项目中心", icon: FolderKanban, resource: "projects" as ResourceKey }] },
  { label: "采购", items: [{ href: "/procurement-workspace", label: "采购工作台", icon: ShoppingCart, resource: "skus" as ResourceKey }, { href: "/purchase-orders", label: "采购订单", icon: Truck, resource: "purchase-orders" as ResourceKey }, { href: "/returns", label: "退换货", icon: PackageCheck, resource: "returns" as ResourceKey }, { href: "/suppliers", label: "供应商", icon: Boxes, resource: "suppliers" as ResourceKey }] },
  { label: "财务", items: [{ href: "/finance-workspace", label: "财务工作台", icon: Banknote, resource: "accounts" as ResourceKey }, { href: "/receivables", label: "应收计划", icon: FileClock, resource: "receivables" as ResourceKey }, { href: "/receipts", label: "收款记录", icon: HandCoins, resource: "receipts" as ResourceKey }, { href: "/payables", label: "供应商应付", icon: ReceiptText, resource: "payables" as ResourceKey }, { href: "/payment-requests", label: "付款申请", icon: BadgeDollarSign, resource: "payment-requests" as ResourceKey }, { href: "/payments", label: "付款记录", icon: WalletCards, resource: "payments" as ResourceKey }, { href: "/invoices", label: "发票台账", icon: FileText, resource: "invoices" as ResourceKey }, { href: "/accounts", label: "资金账户", icon: WalletCards, resource: "accounts" as ResourceKey }] },
  { label: "基础资料", items: [{ href: "/customers", label: "客户", icon: Users, resource: "customers" as ResourceKey }, { href: "/skus", label: "SKU", icon: Tags, resource: "skus" as ResourceKey }, { href: "/companies", label: "公司", icon: Building2, resource: "companies" as ResourceKey }, { href: "/users", label: "用户", icon: Users, resource: "users" as ResourceKey }] },
  { label: "系统", items: [{ href: "/imports", label: "数据迁移中心", icon: FileSpreadsheet, resource: "imports" as ResourceKey }, { href: "/permissions", label: "权限", icon: LockKeyhole, resource: "users" as ResourceKey }, { href: "/audit-logs", label: "操作日志", icon: History, resource: "audit-logs" as ResourceKey }] },
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
          return <div className="nav-group" key={group.label}><div className="nav-label">{group.label}</div>{visible.map((item) => <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className={`nav-link ${pathname === item.href || pathname.startsWith(`${item.href}/`) ? "active" : ""}`}><item.icon />{item.label}</Link>)}</div>;
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
