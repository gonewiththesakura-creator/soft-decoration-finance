import { hash } from "bcryptjs";
import { directQuery, ensureDirectDatabase } from "./direct";

export type BootstrapResult = { created: boolean; email: string };

export async function ensureBaseAdministrator(): Promise<BootstrapResult> {
  await ensureDirectDatabase();
  const [existing] = await directQuery<{ email: string }>("SELECT email FROM users WHERE role='owner' ORDER BY id LIMIT 1");
  if (existing) return { created: false, email: existing.email };

  const email = (process.env.BOOTSTRAP_OWNER_EMAIL ?? "owner@zhiheng.local").trim().toLowerCase();
  const name = (process.env.BOOTSTRAP_OWNER_NAME ?? "系统管理员").trim();
  const password = process.env.BOOTSTRAP_OWNER_PASSWORD ?? (process.env.NODE_ENV === "production" ? "" : "Admin@2026!");
  if (!email || !name || !password) {
    throw new Error("Empty production database requires BOOTSTRAP_OWNER_EMAIL, BOOTSTRAP_OWNER_NAME and BOOTSTRAP_OWNER_PASSWORD.");
  }
  if (password.length < 10) throw new Error("BOOTSTRAP_OWNER_PASSWORD must contain at least 10 characters.");

  const passwordHash = await hash(password, 12);
  await directQuery(
    "INSERT INTO users(company_id,name,email,password_hash,role,status) VALUES(NULL,$1,$2,$3,'owner','active')",
    [name, email, passwordHash],
  );
  return { created: true, email };
}
