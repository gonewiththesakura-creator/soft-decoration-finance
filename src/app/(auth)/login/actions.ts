"use server";

import { redirect } from "next/navigation";
import { authenticate, createSession } from "@/lib/auth";

export async function loginAction(_previous: { error: string }, formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const user = await authenticate(email, password);
  if (!user) return { error: "邮箱或密码不正确" };
  await createSession(user);
  redirect("/dashboard");
}
