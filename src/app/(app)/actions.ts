"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { clearSession, requireSession } from "@/lib/auth";

export async function logoutAction() { await clearSession(); redirect("/login"); }

export async function setCompanyScope(value: string) {
  const user = await requireSession();
  if (user.role !== "owner") return;
  const normalized = value === "all" ? "all" : String(Number(value));
  (await cookies()).set("company_scope", normalized, { httpOnly: true, sameSite: "lax", path: "/" });
}
