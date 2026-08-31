import { compare } from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sqlQuery } from "@/db/client";
import type { UserRole } from "@/db/schema";

const COOKIE_NAME = "zhiheng_session";
const secret = new TextEncoder().encode(process.env.AUTH_SECRET ?? "development-secret");

export type SessionUser = {
  id: number;
  companyId: number | null;
  name: string;
  email: string;
  role: UserRole;
};

export async function authenticate(email: string, password: string) {
  const [user] = await sqlQuery<SessionUser & { passwordHash: string; status: string }>(
    `SELECT id, company_id AS "companyId", name, email, password_hash AS "passwordHash", role, status
     FROM users WHERE lower(email) = lower($1) LIMIT 1`,
    [email],
  );
  if (!user || user.status !== "active" || !(await compare(password, user.passwordHash))) return null;
  return { id: user.id, companyId: user.companyId, name: user.name, email: user.email, role: user.role } satisfies SessionUser;
}

export async function createSession(user: SessionUser) {
  const token = await new SignJWT(user).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("12h").sign(secret);
  const store = await cookies();
  store.set(COOKIE_NAME, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 12 });
  if (user.role === "owner") store.set("company_scope", "all", { httpOnly: true, sameSite: "lax", path: "/" });
}

export async function getSession(): Promise<SessionUser | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as SessionUser;
  } catch {
    return null;
  }
}

export async function requireSession() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export async function clearSession() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
  store.delete("company_scope");
}

export async function getCompanyScope(user: SessionUser) {
  if (user.role !== "owner") return user.companyId;
  const raw = (await cookies()).get("company_scope")?.value ?? "all";
  return raw === "all" ? null : Number(raw);
}
