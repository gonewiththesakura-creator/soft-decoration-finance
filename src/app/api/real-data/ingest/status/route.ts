import { NextResponse } from "next/server";
import { getRealDataIngestStatus } from "@/data/real-data-ingest";
import { realDataApiError } from "@/lib/real-data-api-response";
import { assertExternalRequestRate, assertRealDataIngestToken, assertRealDataMode, readRemoteIp } from "@/lib/real-data-ingest";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    assertRealDataIngestToken(request);
    assertRealDataMode();
    assertExternalRequestRate(readRemoteIp(request));
    return NextResponse.json(await getRealDataIngestStatus());
  } catch (error) {
    return realDataApiError(error);
  }
}
