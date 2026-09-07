import { beforeEach, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { sqlQuery } from "@/db/client";
import { POST as ingestFiles } from "@/app/api/real-data/ingest/files/route";
import { GET as ingestStatus } from "@/app/api/real-data/ingest/status/route";
import { GET as ingestBatch } from "@/app/api/real-data/ingest/batches/[id]/route";
import { RealDataIngestError, assertExternalRequestRate, resetExternalIngestRateLimitsForTests } from "@/lib/real-data-ingest";
import { IMPORT_MAX_FILE_BYTES, IMPORT_MAX_FILE_MB } from "@/lib/import-limits";

const token = "test-real-data-ingest-token-2026-09-07";
const base = "http://127.0.0.1:3001/api/real-data/ingest";

function xlsxFile(marker: string, filename = `${marker}.xlsx`) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([{ 产品编码: marker, 品名: `测试-${marker}`, 数量: 1, 成本金额: 100 }]), "总成本");
  const bytes = XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new File([Uint8Array.from(bytes)], filename, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

function csvFile(marker: string, filename = `${marker}.csv`) {
  return new File([`供应商,品名,报价\n供应商-${marker},产品-${marker},1200\n`], filename, { type: "text/csv" });
}

function uploadRequest(files: File[], idempotencyKey?: string, suppliedToken = token, fields: Record<string, string> = {}) {
  const form = new FormData();
  for (const file of files) form.append("files", file);
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  const headers: Record<string, string> = { Authorization: `Bearer ${suppliedToken}`, "X-Forwarded-For": "127.0.0.77" };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  return new Request(`${base}/files`, { method: "POST", headers, body: form });
}

async function payload(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

describe.sequential("V1.7.1 external real-data ingest", () => {
  beforeEach(() => {
    process.env.DATA_MODE = "real";
    process.env.REAL_DATA_INGEST_TOKEN = token;
    process.env.REAL_DATA_INGEST_REQUESTS_PER_MINUTE = "1000";
    process.env.REAL_DATA_INGEST_FILES_PER_HOUR = "1000";
    resetExternalIngestRateLimitsForTests();
  });

  it("requires a configured Bearer token and rejects a bad token", async () => {
    const missing = new Request(`${base}/files`, { method: "POST", body: new FormData() });
    const missingResponse = await ingestFiles(missing);
    expect(missingResponse.status).toBe(401);
    expect((await payload(missingResponse)).error).toBe("UNAUTHORIZED");

    const badResponse = await ingestFiles(uploadRequest([csvFile("bad-token")], undefined, "wrong-token-that-is-not-valid"));
    expect(badResponse.status).toBe(401);
    expect((await payload(badResponse)).error).toBe("UNAUTHORIZED");
  });

  it("rejects demo mode before accepting a file", async () => {
    process.env.DATA_MODE = "demo";
    const response = await ingestFiles(uploadRequest([csvFile("demo-mode")]));
    expect(response.status).toBe(409);
    expect((await payload(response)).error).toBe("DATA_MODE_NOT_REAL");
  });

  it("requires an explicit project context for project-scoped API uploads", async () => {
    const response = await ingestFiles(uploadRequest([xlsxFile("PROJECT-CONTEXT")], "project-context-required-001", token, { scope: "PROJECT" }));
    expect(response.status).toBe(400);
    expect(await payload(response)).toMatchObject({ error: "PROJECT_CONTEXT_REQUIRED" });
  });

  it("stages XLSX with classifications and never writes business tables", async () => {
    const response = await ingestFiles(uploadRequest([xlsxFile("XLSX-STAGE")], "xlsx-stage-001"));
    const body = await payload(response);
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, dataMode: "real", received: 1 });
    const batch = (body.batches as Record<string, unknown>[])[0];
    expect(batch).toMatchObject({ fingerprintStatus: "NEW", status: "UPLOADED", next: "REVIEW_IN_IMPORT_CENTER" });
    expect((batch.sheets as Record<string, unknown>[])[0]).toMatchObject({ classification: "PROJECT_COST", confidence: 96 });

    const [counts] = await sqlQuery<{ companies: number; suppliers: number; projects: number; skus: number; batches: number }>(`SELECT (SELECT count(*)::int FROM companies) AS companies,(SELECT count(*)::int FROM suppliers) AS suppliers,(SELECT count(*)::int FROM projects) AS projects,(SELECT count(*)::int FROM skus) AS skus,(SELECT count(*)::int FROM import_batches) AS batches`);
    expect(counts).toMatchObject({ companies: 0, suppliers: 0, projects: 0, skus: 0 });
    expect(counts.batches).toBeGreaterThan(0);

    const batchResponse = await ingestBatch(new Request(`${base}/batches/${String(batch.batchId)}`, { headers: { Authorization: `Bearer ${token}`, "X-Forwarded-For": "127.0.0.78" } }), { params: Promise.resolve({ id: String(batch.batchId) }) });
    expect(batchResponse.status).toBe(200);
    expect(await payload(batchResponse)).toMatchObject({ ok: true, batch: { sourceChannel: "EXTERNAL_API", status: "UPLOADED", imported: false } });
  });

  it("supports CSV and multiple files in one request", async () => {
    const csvResponse = await ingestFiles(uploadRequest([csvFile("CSV-STAGE")], "csv-stage-001"));
    expect(csvResponse.status).toBe(200);
    expect(await payload(csvResponse)).toMatchObject({ ok: true, received: 1 });

    const multiResponse = await ingestFiles(uploadRequest([xlsxFile("MULTI-XLSX"), csvFile("MULTI-CSV")], "multi-stage-001"));
    const multiBody = await payload(multiResponse);
    expect(multiResponse.status).toBe(200);
    expect(multiBody).toMatchObject({ ok: true, received: 2 });
    expect(multiBody.batches).toHaveLength(2);
  });

  it("reports duplicate hashes as unchanged with the original batch", async () => {
    const original = xlsxFile("DUPLICATE-HASH", "duplicate-original.xlsx");
    const bytes = await original.arrayBuffer();
    const firstResponse = await ingestFiles(uploadRequest([original], "duplicate-first-001"));
    const first = (await payload(firstResponse)).batches as Record<string, unknown>[];
    const duplicate = new File([bytes], "nested/../duplicate-copy.xlsx", { type: original.type });
    const secondResponse = await ingestFiles(uploadRequest([duplicate], "duplicate-second-001"));
    const second = (await payload(secondResponse)).batches as Record<string, unknown>[];
    expect(second[0]).toMatchObject({ fingerprintStatus: "UNCHANGED", duplicateOfBatchId: first[0].batchId, filename: "duplicate-copy.xlsx" });
  });

  it("replays the first result for the same idempotency key", async () => {
    const key = "idempotent-request-001";
    const firstResponse = await ingestFiles(uploadRequest([csvFile("IDEMPOTENT-FIRST")], key));
    const first = await payload(firstResponse);
    const secondResponse = await ingestFiles(uploadRequest([csvFile("IDEMPOTENT-SECOND")], key));
    const second = await payload(secondResponse);
    expect(secondResponse.headers.get("Idempotency-Replayed")).toBe("true");
    expect(second).toEqual(first);
    const [counts] = await sqlQuery<{ requests: number; batches: number }>(`SELECT (SELECT count(*)::int FROM real_data_ingest_requests WHERE idempotency_key=$1) AS requests,(SELECT count(*)::int FROM import_batches b JOIN real_data_ingest_audit a ON a.batch_id=b.id JOIN real_data_ingest_requests r ON r.id=a.request_id WHERE r.idempotency_key=$1) AS batches`, [key]);
    expect(counts).toEqual({ requests: 1, batches: 1 });
  });

  it("uses a 60MB file limit and rejects larger files", async () => {
    expect(IMPORT_MAX_FILE_MB).toBe(60);
    expect(IMPORT_MAX_FILE_BYTES).toBe(60 * 1024 * 1024);
    const invalid = new File(["not an xlsx archive"], "invalid.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const invalidResponse = await ingestFiles(uploadRequest([invalid], "invalid-file-001"));
    expect(invalidResponse.status).toBe(400);
    expect((await payload(invalidResponse)).error).toBe("INVALID_FILE");

    const oversized = new File([new Uint8Array(IMPORT_MAX_FILE_BYTES + 1)], "oversized.csv", { type: "text/csv" });
    const oversizedResponse = await ingestFiles(uploadRequest([oversized], "oversized-file-001"));
    expect(oversizedResponse.status).toBe(413);
    expect((await payload(oversizedResponse)).error).toBe("FILE_TOO_LARGE");
  });

  it("reports an empty business database and writes upload audit records", async () => {
    const response = await ingestStatus(new Request(`${base}/status`, { headers: { Authorization: `Bearer ${token}`, "X-Forwarded-For": "127.0.0.79" } }));
    expect(response.status).toBe(200);
    expect(await payload(response)).toEqual({ ok: true, dataMode: "real", businessDataEmpty: true, counts: { companies: 0, projects: 0, suppliers: 0, customers: 0, skus: 0 } });
    const [audit] = await sqlQuery<{ count: number; tokens: number }>(`SELECT count(*)::int AS count,count(*) FILTER (WHERE idempotency_key LIKE '%Bearer%')::int AS tokens FROM real_data_ingest_audit`);
    expect(audit.count).toBeGreaterThan(0);
    expect(audit.tokens).toBe(0);
  });

  it("enforces the configurable request rate limit", () => {
    process.env.REAL_DATA_INGEST_REQUESTS_PER_MINUTE = "1";
    assertExternalRequestRate("127.0.0.80", 1_000_000);
    try {
      assertExternalRequestRate("127.0.0.80", 1_000_001);
      throw new Error("Expected rate limit");
    } catch (error) {
      expect(error).toBeInstanceOf(RealDataIngestError);
      expect((error as RealDataIngestError).code).toBe("RATE_LIMITED");
    }
  });
});
