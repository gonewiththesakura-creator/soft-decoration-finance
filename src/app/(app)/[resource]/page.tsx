import { notFound } from "next/navigation";
import { requireSession, getCompanyScope } from "@/lib/auth";
import { can, type ResourceKey } from "@/lib/permissions";
import { definitions, getReferenceOptions, getResourceData } from "@/data/resources";
import { ResourceTable } from "@/components/resource-table";

export default async function ResourcePage({ params }: { params: Promise<{ resource: string }> }) {
  const { resource: rawResource } = await params; const resource = rawResource as ResourceKey;
  if (!definitions[resource]) notFound();
  const user = await requireSession(); if (!can(user, resource)) notFound();
  const scope = await getCompanyScope(user); const data = await getResourceData(resource, user, scope); if (!data) notFound();
  const fields = await Promise.all((data.definition.fields ?? []).map(async (field) => field.reference ? { ...field, options: await getReferenceOptions(field.reference, user, scope) } : field));
  const definition = { ...data.definition, fields };
  return <main className="content"><div className="page-heading"><div><div className="eyebrow">{definition.eyebrow}</div><h1>{definition.title}</h1><p className="page-description">{definition.description}</p></div></div><ResourceTable definition={definition} rows={data.rows as (Record<string, unknown> & { id: number })[]} canWrite={can(user, resource, "write")} role={user.role} /></main>;
}
