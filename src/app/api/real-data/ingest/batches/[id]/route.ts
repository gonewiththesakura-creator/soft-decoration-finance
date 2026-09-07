import { NextResponse } from "next/server";
import { getExternalIngestBatch } from "@/data/real-data-ingest";
import { realDataApiError } from "@/lib/real-data-api-response";
import { RealDataIngestError, assertExternalRequestRate, assertRealDataIngestToken, assertRealDataMode, readRemoteIp } from "@/lib/real-data-ingest";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertRealDataIngestToken(request);
    assertRealDataMode();
    assertExternalRequestRate(readRemoteIp(request));
    const { id } = await context.params;
    const batchId = Number(id);
    if (!Number.isInteger(batchId) || batchId <= 0) throw new RealDataIngestError("INVALID_BATCH_ID", 400, "批次 ID 无效");
    return NextResponse.json(await getExternalIngestBatch(batchId));
  } catch (error) {
    return realDataApiError(error);
  }
}
