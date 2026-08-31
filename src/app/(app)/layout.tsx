import { requireSession, getCompanyScope } from "@/lib/auth";
import { sqlQuery } from "@/db/client";
import { AppShell } from "@/components/app-shell";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSession(); const scope = await getCompanyScope(user);
  const companies = await sqlQuery<{ id: number; name: string }>("SELECT id,name FROM companies ORDER BY id");
  return <AppShell user={user} companies={companies} currentScope={scope}>{children}</AppShell>;
}
