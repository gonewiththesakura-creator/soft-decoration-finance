import { requireSession, getCompanyScope } from "@/lib/auth";
import { sqlQuery } from "@/db/client";
import { AppShell } from "@/components/app-shell";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSession(); const scope = await getCompanyScope(user);
  const companies = await sqlQuery<{ id: number; name: string }>(user.role === "owner" ? "SELECT id,name FROM companies ORDER BY id" : "SELECT id,name FROM companies WHERE id=$1", user.role === "owner" ? [] : [user.companyId]);
  return <AppShell user={user} companies={companies} currentScope={scope}>{children}</AppShell>;
}
