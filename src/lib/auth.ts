import { compare } from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sqlQuery } from "@/db/client";
import type { UserRole } from "@/db/schema";

const COOKIE_NAME = "zhiheng_session";
function loadSecret() {
  const value = process.env.AUTH_SECRET;
  if (!value && process.env.NODE_ENV === "production") throw new Error("AUTH_SECRET is required in production");
  return new TextEncoder().encode(value ?? "development-only-secret-change-before-production");
}
const secret = loadSecret();

export type SessionUser = {
  id: number;
  companyId: number | null;
  name: string;
  email: string;
  role: UserRole;
};

export async function authenticate(email: string, password: string, ip = "127.0.0.1") {
  const normalizedEmail = email.trim().toLowerCase();
  const [attempts] = await sqlQuery<{ failures: number }>(`SELECT count(*)::int AS failures FROM login_attempts WHERE lower(email)=$1 AND ip=$2 AND NOT success AND attempted_at>now()-interval '15 minutes'`, [normalizedEmail, ip]);
  if (attempts.failures >= 5) throw new Error("RATE_LIMITED");
  const [user] = await sqlQuery<SessionUser & { passwordHash: string; status: string }>(
    `SELECT id, company_id AS "companyId", name, email, password_hash AS "passwordHash", role, status
     FROM users WHERE lower(email) = lower($1) LIMIT 1`,
    [normalizedEmail],
  );
  const success = Boolean(user && user.status === "active" && await compare(password, user.passwordHash));
  await sqlQuery(`INSERT INTO login_attempts(email,ip,user_id,success) VALUES($1,$2,$3,$4)`, [normalizedEmail, ip, user?.id ?? null, success]);
  if (!success || !user) return null;
  return { id: user.id, companyId: user.companyId, name: user.name, email: user.email, role: user.role } satisfies SessionUser;
}

export async function createSession(user: SessionUser) {
  const token = await new SignJWT(user).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("12h").sign(secret);
  const store = await cookies();
  store.set(COOKIE_NAME, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 12 });
  if (user.role === "owner") store.set("company_scope", "all", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
}

export async function getSession(): Promise<SessionUser | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    const id = Number(payload.id);
    if (!Number.isInteger(id)) return null;
    const [current] = await sqlQuery<SessionUser & { status: string }>(`SELECT id,company_id AS "companyId",name,email,role,status FROM users WHERE id=$1`, [id]);
    if (!current || current.status !== "active") return null;
    return { id: current.id, companyId: current.companyId, name: current.name, email: current.email, role: current.role };
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
