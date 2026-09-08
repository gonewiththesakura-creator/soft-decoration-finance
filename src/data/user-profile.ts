import { runTransaction, sqlQuery } from "@/db/client";
import type { SessionUser } from "@/lib/auth";

export function normalizeDisplayName(value: unknown) {
  const name = String(value ?? "").trim().replace(/\s+/gu, " ");
  const length = Array.from(name).length;
  if (length < 1 || length > 30) throw new Error("显示名称需为 1-30 个字符");
  if (/[\u0000-\u001f\u007f]/u.test(name)) throw new Error("显示名称包含不可用字符");
  return name;
}

export async function updateOwnDisplayName(value: unknown, user: SessionUser, ip = "127.0.0.1") {
  const name = normalizeDisplayName(value);
  const [current] = await sqlQuery<{ id: number; companyId: number | null; name: string }>(
    `SELECT id,company_id AS "companyId",name FROM users WHERE id=$1 AND status='active'`,
    [user.id],
  );
  if (!current) throw new Error("当前用户不存在或已停用");
  if (current.name === name) return { changed: false, name };

  await runTransaction([
    { query: `UPDATE users SET name=$1,updated_at=now(),updated_by=$2 WHERE id=$2 AND status='active'`, params: [name, user.id] },
    {
      query: `INSERT INTO audit_logs(company_id,project_id,user_id,object_type,object_id,action,before,after,ip) VALUES($1,NULL,$2,'user_profile',$2,'UPDATE_DISPLAY_NAME',$3::jsonb,$4::jsonb,$5)`,
      params: [current.companyId, user.id, JSON.stringify({ name: current.name }), JSON.stringify({ name }), ip],
    },
  ]);
  return { changed: true, name };
}
