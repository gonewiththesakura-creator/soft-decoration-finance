"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { clearSession, requireSession } from "@/lib/auth";
import { sqlQuery } from "@/db/client";

export async function logoutAction() { await clearSession(); redirect("/login"); }

export async function setCompanyScope(value: string) {
  const user = await requireSession();
  if (user.role !== "owner") return;
  let normalized = "all";
  if (value !== "all") {
    const id = Number(value); const [company] = await sqlQuery<{ id: number }>("SELECT id FROM companies WHERE id=$1", [id]);
    if (!company) throw new Error("公司范围无效"); normalized = String(id);
  }
  (await cookies()).set("company_scope", normalized, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
}
