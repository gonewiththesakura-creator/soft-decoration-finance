"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  BadgeDollarSign, Banknote, Boxes, Building2, FileClock, FileSpreadsheet, FileText,
  Bot, FolderKanban, HandCoins, History, LayoutDashboard, LoaderCircle, LockKeyhole, LogOut, Menu,
  PackageCheck, Pencil, ReceiptText, Save, Settings2, ShoppingCart, Tags, Truck, Users, WalletCards, X,
} from "lucide-react";
import type { SessionUser } from "@/lib/auth";
import { can, roleLabels, type ResourceKey } from "@/lib/permissions";
import { logoutAction, setCompanyScope, updateProfileName } from "@/app/(app)/actions";
import { GlobalAIAssistant } from "@/components/ai/global-ai-assistant";

type Company = { id: number; name: string };
const groups = [
  { label: "首页", items: [{ href: "/dashboard", label: "经营总览", icon: LayoutDashboard, resource: "projects" as ResourceKey }, { href: "/ai", label: "AI 经营助手", icon: Bot, resource: "ai" as ResourceKey }] },
  { label: "项目", items: [{ href: "/projects", label: "项目中心", icon: FolderKanban, resource: "projects" as ResourceKey }] },
  { label: "采购", items: [{ href: "/procurement-workspace", label: "采购工作台", icon: ShoppingCart, resource: "skus" as ResourceKey }, { href: "/purchase-orders", label: "采购订单", icon: Truck, resource: "purchase-orders" as ResourceKey }, { href: "/returns", label: "退换货", icon: PackageCheck, resource: "returns" as ResourceKey }, { href: "/suppliers", label: "供应商", icon: Boxes, resource: "suppliers" as ResourceKey }] },
  { label: "财务", items: [{ href: "/finance-workspace", label: "财务工作台", icon: Banknote, resource: "accounts" as ResourceKey }, { href: "/receivables", label: "应收计划", icon: FileClock, resource: "receivables" as ResourceKey }, { href: "/receipts", label: "收款记录", icon: HandCoins, resource: "receipts" as ResourceKey }, { href: "/payables", label: "供应商应付", icon: ReceiptText, resource: "payables" as ResourceKey }, { href: "/payment-requests", label: "付款申请", icon: BadgeDollarSign, resource: "payment-requests" as ResourceKey }, { href: "/payments", label: "付款记录", icon: WalletCards, resource: "payments" as ResourceKey }, { href: "/invoices", label: "发票台账", icon: FileText, resource: "invoices" as ResourceKey }, { href: "/accounts", label: "资金账户", icon: WalletCards, resource: "accounts" as ResourceKey }] },
  { label: "基础资料", items: [{ href: "/customers", label: "客户", icon: Users, resource: "customers" as ResourceKey }, { href: "/skus", label: "SKU", icon: Tags, resource: "skus" as ResourceKey }, { href: "/companies", label: "公司", icon: Building2, resource: "companies" as ResourceKey }, { href: "/users", label: "用户", icon: Users, resource: "users" as ResourceKey }] },
  { label: "系统", items: [{ href: "/imports", label: "数据迁移中心", icon: FileSpreadsheet, resource: "imports" as ResourceKey }, { href: "/ai/settings", label: "AI 模型设置", icon: Settings2, resource: "companies" as ResourceKey }, { href: "/permissions", label: "权限", icon: LockKeyhole, resource: "users" as ResourceKey }, { href: "/audit-logs", label: "操作日志", icon: History, resource: "audit-logs" as ResourceKey }] },
];

export function AppShell({ user, companies, currentScope, aiReady, children }: { user: SessionUser; companies: Company[]; currentScope: number | null; aiReady: boolean; children: React.ReactNode }) {
  const pathname = usePathname(); const router = useRouter(); const [open, setOpen] = useState(false); const [, startTransition] = useTransition();
  const [displayName, setDisplayName] = useState(user.name); const [profileOpen, setProfileOpen] = useState(false); const [profileName, setProfileName] = useState(user.name); const [profileError, setProfileError] = useState(""); const [profilePending, startProfileTransition] = useTransition();
  useEffect(() => setDisplayName(user.name), [user.name]);
  function changeScope(value: string) { startTransition(async () => { await setCompanyScope(value); router.refresh(); }); }
  function openProfile() { setProfileName(displayName); setProfileError(""); setProfileOpen(true); }
  function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setProfileError("");
    startProfileTransition(async () => {
      const result = await updateProfileName(profileName);
      if (!result.ok) { setProfileError(result.error); return; }
      setProfileName(result.name); setDisplayName(result.name); setProfileOpen(false); router.refresh();
    });
  }
  return (
    <div className="app-shell has-global-ai">
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="brand"><div className="brand-mark">衡</div><div><div className="brand-title">织衡经营财务</div><div className="brand-sub">项目经营中枢</div></div><button className="icon-plain mobile-menu" style={{ marginLeft: "auto" }} onClick={() => setOpen(false)} aria-label="关闭菜单"><X /></button></div>
        <nav className="nav-scroll">{groups.map((group) => {
          const visible = group.items.filter((item) => can(user, item.resource)); if (!visible.length) return null;
          return <div className="nav-group" key={group.label}><div className="nav-label">{group.label}</div>{visible.map((item) => <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className={`nav-link ${pathname === item.href || pathname.startsWith(`${item.href}/`) ? "active" : ""}`}><item.icon />{item.label}</Link>)}</div>;
        })}</nav>
        <div className="sidebar-user"><button className="sidebar-profile" type="button" onClick={openProfile} title="个人设置" aria-label={`个人设置：${displayName}`}><div className="avatar">{displayName.slice(0, 1)}</div><div className="user-meta"><div className="user-name">{displayName}</div><div className="user-role">{roleLabels[user.role]}</div></div><Pencil aria-hidden="true" /></button><form action={logoutAction}><button className="icon-plain" type="submit" aria-label="退出登录" title="退出登录"><LogOut /></button></form></div>
      </aside>
      <div className="main-column">
        <header className="topbar"><div className="topbar-left"><button className="icon-plain mobile-menu" onClick={() => setOpen(true)} aria-label="打开菜单"><Menu /></button><div><div className="scope-label">当前数据范围</div>{user.role === "owner" ? <select className="scope-select" value={currentScope ?? "all"} onChange={(event) => changeScope(event.target.value)} disabled={!companies.length}><option value="all">{companies.length ? "集团汇总 · 全部公司" : "尚未导入公司数据"}</option>{companies.map((company) => <option value={company.id} key={company.id}>{company.name}</option>)}</select> : <div className="scope-select">{companies.find((company) => company.id === user.companyId)?.name ?? "尚未分配公司"}</div>}</div></div><div className="topbar-right"><div className="date-chip">{new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "short" }).format(new Date())}</div></div></header>
        {children}
      </div>
      <GlobalAIAssistant role={user.role} ready={aiReady} />
      {profileOpen ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !profilePending && setProfileOpen(false)}><div className="modal profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title" onKeyDown={(event) => event.key === "Escape" && !profilePending && setProfileOpen(false)}><form onSubmit={saveProfile}><div className="modal-header"><div><div className="modal-title" id="profile-title">个人设置</div><div className="panel-subtitle">账户资料</div></div><button className="icon-plain" type="button" aria-label="关闭" disabled={profilePending} onClick={() => setProfileOpen(false)}><X /></button></div><div className="form-grid profile-form-grid"><div className="field full"><label htmlFor="profile-name">显示名称 <span className="required">*</span></label><input className="input" id="profile-name" value={profileName} minLength={1} maxLength={30} required autoComplete="name" autoFocus disabled={profilePending} onChange={(event) => setProfileName(event.target.value)} /></div><div className="field"><label htmlFor="profile-email">登录邮箱</label><input className="input profile-readonly" id="profile-email" value={user.email} readOnly /></div><div className="field"><label htmlFor="profile-role">角色</label><input className="input profile-readonly" id="profile-role" value={roleLabels[user.role]} readOnly /></div>{profileError ? <div className="form-error" role="alert">{profileError}</div> : null}</div><div className="modal-footer"><button className="button" type="button" disabled={profilePending} onClick={() => setProfileOpen(false)}>取消</button><button className="button primary" type="submit" disabled={profilePending}>{profilePending ? <LoaderCircle className="animate-spin" /> : <Save />}{profilePending ? "正在保存" : "保存名称"}</button></div></form></div></div> : null}
    </div>
  );
}
