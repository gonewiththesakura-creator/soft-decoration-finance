"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { clearSession, requireSession } from "@/lib/auth";
import { sqlQuery } from "@/db/client";
import { updateOwnDisplayName } from "@/data/user-profile";

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

export async function updateProfileName(value: string) {
  const user = await requireSession();
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "127.0.0.1";
  try {
    const result = await updateOwnDisplayName(value, user, ip);
    if (result.changed) revalidatePath("/", "layout");
    return { ok: true as const, name: result.name, message: result.changed ? "显示名称已更新" : "显示名称未发生变化" };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "更新显示名称失败" };
  }
}
