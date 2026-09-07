import { NextResponse } from "next/server";
import { getExternalIngestReplay, ingestExternalFiles } from "@/data/real-data-ingest";
import { realDataApiError } from "@/lib/real-data-api-response";
import {
  RealDataIngestError,
  assertExternalFileRate,
  assertExternalRequestRate,
  assertRealDataIngestToken,
  assertRealDataMode,
  collectExternalIngestFiles,
  readIdempotencyKey,
  readLimitedMultipartForm,
  readRemoteIp,
} from "@/lib/real-data-ingest";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertRealDataIngestToken(request);
    assertRealDataMode();
    const remoteIp = readRemoteIp(request);
    const idempotencyKey = readIdempotencyKey(request);
    assertExternalRequestRate(remoteIp);

    const replay = await getExternalIngestReplay(idempotencyKey);
    if (replay) return NextResponse.json(replay.payload, { status: replay.status, headers: { "Idempotency-Replayed": "true" } });

    const form = await readLimitedMultipartForm(request);
    const { files, totalBytes } = collectExternalIngestFiles(form);
    const scopeValue = String(form.get("scope") ?? "PENDING").trim().toUpperCase();
    if (!["PENDING", "PROJECT", "COMPANY", "MASTER"].includes(scopeValue)) throw new RealDataIngestError("INVALID_SCOPE", 400, "scope 必须是 PROJECT、COMPANY 或 MASTER");
    const projectId = Number(form.get("projectId") ?? 0) || null;
    const projectName = String(form.get("projectName") ?? "").trim();
    if (scopeValue === "PROJECT" && !projectId && !projectName) throw new RealDataIngestError("PROJECT_CONTEXT_REQUIRED", 400, "项目数据必须提供 projectId 或 projectName");
    assertExternalFileRate(remoteIp, files.length);
    const result = await ingestExternalFiles(files, {
      idempotencyKey,
      remoteIp,
      totalBytes,
      scope: scopeValue as "PENDING" | "PROJECT" | "COMPANY" | "MASTER",
      projectId,
      projectName,
      projectCode: String(form.get("projectCode") ?? ""),
      createProject: ["true", "1", "yes"].includes(String(form.get("createProject") ?? "").toLowerCase()),
      companyId: Number(form.get("companyId") ?? 0) || null,
    });
    return NextResponse.json(result.payload, { status: result.status });
  } catch (error) {
    return realDataApiError(error);
  }
}
