import { NextResponse } from "next/server";
import { publicIngestError } from "./real-data-ingest";

export function realDataApiError(error: unknown) {
  const safe = publicIngestError(error);
  const headers = safe.retryAfter ? { "Retry-After": String(safe.retryAfter) } : undefined;
  return NextResponse.json({ ok: false, error: safe.code, message: safe.message }, { status: safe.status, headers });
}
