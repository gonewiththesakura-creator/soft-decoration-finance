import { NextResponse } from "next/server";
import { getExternalIngestReplay, ingestExternalFiles } from "@/data/real-data-ingest";
import { realDataApiError } from "@/lib/real-data-api-response";
import {
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
    assertExternalFileRate(remoteIp, files.length);
    const result = await ingestExternalFiles(files, { idempotencyKey, remoteIp, totalBytes });
    return NextResponse.json(result.payload, { status: result.status });
  } catch (error) {
    return realDataApiError(error);
  }
}
