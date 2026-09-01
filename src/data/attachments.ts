import { sqlQuery } from "@/db/client";
import { writeAudit } from "@/lib/audit";
import { attachmentCategories, type AttachmentCategory } from "@/lib/attachment-types";
import type { SessionUser } from "@/lib/auth";
import { assertCan, can, type ResourceKey } from "@/lib/permissions";
import { storageService } from "@/lib/storage";

type ObjectDefinition = { table: string; resource: ResourceKey; projectColumn?: string; companyColumn: string };
const objects: Record<string, ObjectDefinition> = {
  project: { table: "projects", resource: "projects", projectColumn: "id", companyColumn: "company_id" },
  customer: { table: "customers", resource: "customers", companyColumn: "company_id" },
  supplier: { table: "suppliers", resource: "suppliers", companyColumn: "company_id" },
  contract: { table: "contracts", resource: "contracts", projectColumn: "project_id", companyColumn: "company_id" },
  sku: { table: "skus", resource: "skus", projectColumn: "project_id", companyColumn: "company_id" },
  quote: { table: "supplier_quotes", resource: "quotes", projectColumn: "project_id", companyColumn: "company_id" },
  purchase_request: { table: "purchase_requests", resource: "purchase-requests", projectColumn: "project_id", companyColumn: "company_id" },
  payment_request: { table: "payment_requests", resource: "payment-requests", projectColumn: "project_id", companyColumn: "company_id" },
  purchase_order: { table: "purchase_orders", resource: "purchase-orders", projectColumn: "project_id", companyColumn: "company_id" },
  payable: { table: "payables", resource: "payables", projectColumn: "project_id", companyColumn: "company_id" },
  payment: { table: "payments", resource: "payments", projectColumn: "project_id", companyColumn: "company_id" },
  invoice: { table: "invoices", resource: "invoices", projectColumn: "project_id", companyColumn: "company_id" },
  return: { table: "purchase_returns", resource: "returns", projectColumn: "project_id", companyColumn: "company_id" },
  receipt: { table: "receipts", resource: "receipts", projectColumn: "project_id", companyColumn: "company_id" },
};

async function resolveObject(objectType: string, objectId: number, user: SessionUser, action: "read" | "write") {
  const definition = objects[objectType];
  if (!definition || !Number.isInteger(objectId)) throw new Error("附件业务对象无效");
  assertCan(user, definition.resource, action);
  const projectSelect = definition.projectColumn ? `${definition.projectColumn} AS "projectId"` : `NULL::integer AS "projectId"`;
  const [object] = await sqlQuery<{ companyId: number; projectId: number | null }>(`SELECT ${definition.companyColumn} AS "companyId",${projectSelect} FROM ${definition.table} WHERE id=$1`, [objectId]);
  if (!object) throw new Error("附件业务对象不存在");
  if (user.role !== "owner" && object.companyId !== user.companyId) throw new Error("FORBIDDEN");
  if (object.projectId && ["project_manager", "designer"].includes(user.role)) {
    const [membership] = await sqlQuery<{ id: number }>(`SELECT id FROM project_members WHERE project_id=$1 AND user_id=$2`, [object.projectId, user.id]);
    if (!membership) throw new Error("FORBIDDEN");
  }
  return { ...object, resource: definition.resource };
}

export async function getAttachments(objectType: string, objectId: number, user: SessionUser) {
  await resolveObject(objectType, objectId, user, "read");
  return sqlQuery<{ id: number; category: string; originalFilename: string; mimeType: string; fileSize: number; url: string; uploaderName: string; createdAt: string }>(`SELECT a.id,a.category,a.original_filename AS "originalFilename",a.mime_type AS "mimeType",a.file_size AS "fileSize",a.url,COALESCE(u.name,'未知') AS "uploaderName",a.created_at::text AS "createdAt" FROM attachments a LEFT JOIN users u ON u.id=a.uploaded_by WHERE a.object_type=$1 AND a.object_id=$2 AND NOT a.is_void ORDER BY a.created_at DESC`, [objectType, objectId]);
}

export async function createAttachment(input: { objectType: string; objectId: number; category: string; file: File }, user: SessionUser) {
  if (!attachmentCategories.includes(input.category as AttachmentCategory)) throw new Error("附件分类无效");
  const object = await resolveObject(input.objectType, input.objectId, user, "write");
  const stored = await storageService.put(input.file);
  try {
    const [attachment] = await sqlQuery<{ id: number }>(`INSERT INTO attachments(company_id,project_id,object_type,object_id,category,filename,original_filename,mime_type,file_size,storage_key,url,uploaded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11) RETURNING id`, [object.companyId, object.projectId, input.objectType, input.objectId, input.category, stored.filename, input.file.name, stored.mimeType, stored.size, stored.storageKey, user.id]);
    const url = `/api/attachments/${attachment.id}/content`;
    await sqlQuery(`UPDATE attachments SET url=$1 WHERE id=$2`, [url, attachment.id]);
    await writeAudit({ user, companyId: object.companyId, projectId: object.projectId, objectType: "attachment", objectId: attachment.id, action: "UPLOAD", after: { targetType: input.objectType, targetId: input.objectId, category: input.category, filename: input.file.name, fileSize: input.file.size } });
    return { id: attachment.id, url };
  } catch (error) {
    await storageService.delete(stored.storageKey);
    throw error;
  }
}

export async function getAttachmentContent(id: number, user: SessionUser) {
  const [attachment] = await sqlQuery<{ id: number; objectType: string; objectId: number; storageKey: string; originalFilename: string; mimeType: string; isVoid: boolean }>(`SELECT id,object_type AS "objectType",object_id AS "objectId",storage_key AS "storageKey",original_filename AS "originalFilename",mime_type AS "mimeType",is_void AS "isVoid" FROM attachments WHERE id=$1`, [id]);
  if (!attachment || attachment.isVoid) throw new Error("附件不存在或已作废");
  await resolveObject(attachment.objectType, attachment.objectId, user, "read");
  return { ...attachment, buffer: await storageService.read(attachment.storageKey) };
}

export async function voidAttachment(id: number, reason: string, user: SessionUser) {
  if (!reason.trim()) throw new Error("请填写附件作废原因");
  const [attachment] = await sqlQuery<{ id: number; companyId: number; projectId: number | null; objectType: string; objectId: number; originalFilename: string; isVoid: boolean }>(`SELECT id,company_id AS "companyId",project_id AS "projectId",object_type AS "objectType",object_id AS "objectId",original_filename AS "originalFilename",is_void AS "isVoid" FROM attachments WHERE id=$1`, [id]);
  if (!attachment || attachment.isVoid) throw new Error("附件不存在或已作废");
  const object = await resolveObject(attachment.objectType, attachment.objectId, user, "write");
  if (!can(user, object.resource, "write")) throw new Error("FORBIDDEN");
  await sqlQuery(`UPDATE attachments SET is_void=true,void_reason=$1,updated_at=now(),updated_by=$2 WHERE id=$3`, [reason.trim(), user.id, id]);
  await writeAudit({ user, companyId: attachment.companyId, projectId: attachment.projectId, objectType: "attachment", objectId: id, action: "VOID", before: { filename: attachment.originalFilename }, after: { reason: reason.trim(), targetType: attachment.objectType, targetId: attachment.objectId } });
}
