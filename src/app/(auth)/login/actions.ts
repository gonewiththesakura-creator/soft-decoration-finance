"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { authenticate, createSession } from "@/lib/auth";

export async function loginAction(_previous: { error: string }, formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "127.0.0.1";
  let user;
  try { user = await authenticate(email, password, ip); }
  catch (error) { if (error instanceof Error && error.message === "RATE_LIMITED") return { error: "登录失败次数过多，请 15 分钟后重试" }; throw error; }
  if (!user) return { error: "邮箱或密码不正确" };
  await createSession(user);
  redirect("/dashboard");
}
