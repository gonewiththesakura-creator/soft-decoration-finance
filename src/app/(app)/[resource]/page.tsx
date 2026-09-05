import { notFound } from "next/navigation";
import { requireSession, getCompanyScope } from "@/lib/auth";
import { can, type ResourceKey } from "@/lib/permissions";
import { definitions, getReferenceOptions, getResourceData } from "@/data/resources";
import { ResourceTable } from "@/components/resource-table";

type ResourceQuery = { new?: string; overdue?: string; projectId?: string; bucket?: string; open?: string; rowId?: string; invoice?: string };

function positiveInteger(value?: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export default async function ResourcePage({ params, searchParams }: { params: Promise<{ resource: string }>; searchParams: Promise<ResourceQuery> }) {
  const [{ resource: rawResource }, query] = await Promise.all([params, searchParams]); const resource = rawResource as ResourceKey;
  if (!definitions[resource]) notFound();
  const user = await requireSession(); if (!can(user, resource)) notFound();
  const scope = await getCompanyScope(user); const data = await getResourceData(resource, user, scope); if (!data) notFound();
  const fields = await Promise.all((data.definition.fields ?? []).map(async (field) => field.reference ? { ...field, options: await getReferenceOptions(field.reference, user, scope) } : field));
  const definition = { ...data.definition, fields };
  const initialView = {
    projectId: positiveInteger(query.projectId),
    rowId: positiveInteger(query.rowId),
    openId: positiveInteger(query.open),
    overdue: query.overdue === "true",
    bucket: query.bucket,
    missingInvoice: query.invoice === "missing",
  };
  return <main className="content"><div className="page-heading"><div><div className="eyebrow">{definition.eyebrow}</div><h1>{definition.title}</h1><p className="page-description">{definition.description}</p></div></div><ResourceTable definition={definition} rows={data.rows as (Record<string, unknown> & { id: number })[]} canWrite={can(user, resource, "write")} role={user.role} autoCreate={query.new === "1"} initialView={initialView} /></main>;
}
