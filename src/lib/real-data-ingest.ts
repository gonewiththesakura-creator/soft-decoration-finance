import { createHash, timingSafeEqual } from "node:crypto";
import { getDataMode } from "./data-mode";

export const REAL_DATA_MAX_FILES = 20;
export const REAL_DATA_MAX_FILE_BYTES = 30 * 1024 * 1024;
export const REAL_DATA_MAX_REQUEST_BYTES = 200 * 1024 * 1024;

const acceptedMimeTypes = new Set([
  "",
  "application/octet-stream",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "application/csv",
]);

export class RealDataIngestError extends Error {
  constructor(public readonly code: string, public readonly status: number, message: string, public readonly retryAfter?: number) {
    super(message);
  }
}

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest();
}

export function assertRealDataIngestToken(request: Request) {
  const expected = process.env.REAL_DATA_INGEST_TOKEN?.trim() ?? "";
  if (expected.length < 32 || expected.startsWith("replace-with-")) {
    throw new RealDataIngestError("INGEST_NOT_CONFIGURED", 503, "外部真实数据接口尚未配置");
  }
  const authorization = request.headers.get("authorization") ?? "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!timingSafeEqual(digest(expected), digest(supplied))) {
    throw new RealDataIngestError("UNAUTHORIZED", 401, "Bearer Token 无效");
  }
}

export function assertRealDataMode() {
  if (getDataMode() !== "real") throw new RealDataIngestError("DATA_MODE_NOT_REAL", 409, "外部真实数据接口仅在 DATA_MODE=real 时可用");
}

export function readRemoteIp(request: Request) {
  const value = request.headers.get("x-forwarded-for")?.split(",")[0] ?? request.headers.get("x-real-ip") ?? "127.0.0.1";
  return value.replace(/[\r\n]/g, "").trim().slice(0, 128) || "127.0.0.1";
}

export function readIdempotencyKey(request: Request) {
  const key = request.headers.get("idempotency-key")?.trim();
  if (!key) return null;
  if (key.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(key)) throw new RealDataIngestError("INVALID_IDEMPOTENCY_KEY", 400, "Idempotency-Key 格式无效");
  return key;
}

type RateBucket = { requests: number[]; files: number[] };
const rateBuckets = new Map<string, RateBucket>();

function positiveLimit(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function assertExternalRequestRate(remoteIp: string, now = Date.now()) {
  const bucket = rateBuckets.get(remoteIp) ?? { requests: [], files: [] };
  bucket.requests = bucket.requests.filter((timestamp) => timestamp > now - 60_000);
  if (bucket.requests.length >= positiveLimit("REAL_DATA_INGEST_REQUESTS_PER_MINUTE", 10)) {
    throw new RealDataIngestError("RATE_LIMITED", 429, "外部导入请求过于频繁，请稍后重试", 60);
  }
  bucket.requests.push(now);
  rateBuckets.set(remoteIp, bucket);
}

export function assertExternalFileRate(remoteIp: string, fileCount: number, now = Date.now()) {
  const bucket = rateBuckets.get(remoteIp) ?? { requests: [], files: [] };
  bucket.files = bucket.files.filter((timestamp) => timestamp > now - 3_600_000);
  if (bucket.files.length + fileCount > positiveLimit("REAL_DATA_INGEST_FILES_PER_HOUR", 100)) {
    throw new RealDataIngestError("FILE_RATE_LIMITED", 429, "一小时内提交的文件数量超过限制", 3600);
  }
  bucket.files.push(...Array.from({ length: fileCount }, () => now));
  rateBuckets.set(remoteIp, bucket);
}

export function resetExternalIngestRateLimitsForTests() {
  rateBuckets.clear();
}

export async function readLimitedMultipartForm(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    throw new RealDataIngestError("INVALID_CONTENT_TYPE", 415, "Content-Type 必须是 multipart/form-data");
  }
  const declaredSize = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredSize) && declaredSize > REAL_DATA_MAX_REQUEST_BYTES) {
    throw new RealDataIngestError("REQUEST_TOO_LARGE", 413, "单次请求不能超过 200MB");
  }
  if (!request.body) throw new RealDataIngestError("FILES_REQUIRED", 400, "请提交 file 或 files 字段");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > REAL_DATA_MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new RealDataIngestError("REQUEST_TOO_LARGE", 413, "单次请求不能超过 200MB");
    }
    chunks.push(value);
  }
  const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), size);
  const headers = new Headers(request.headers);
  headers.set("content-length", String(body.length));
  return new Request(request.url, { method: "POST", headers, body }).formData();
}

export function collectExternalIngestFiles(form: FormData) {
  const values = [...form.getAll("file"), ...form.getAll("files")];
  const files = values.filter((value): value is File => value instanceof File);
  if (!files.length) throw new RealDataIngestError("FILES_REQUIRED", 400, "请提交 file 或 files 字段");
  if (files.length > REAL_DATA_MAX_FILES) throw new RealDataIngestError("TOO_MANY_FILES", 413, "单次最多提交 20 个文件");
  let total = 0;
  for (const file of files) {
    total += file.size;
    if (!file.size) throw new RealDataIngestError("EMPTY_FILE", 400, "文件不能为空");
    if (file.size > REAL_DATA_MAX_FILE_BYTES) throw new RealDataIngestError("FILE_TOO_LARGE", 413, "单个文件不能超过 30MB");
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) throw new RealDataIngestError("UNSUPPORTED_FILE", 415, "仅支持 .xlsx / .xls / .csv 文件");
    if (!acceptedMimeTypes.has(file.type.toLowerCase())) throw new RealDataIngestError("UNSUPPORTED_MEDIA_TYPE", 415, "文件 MIME 类型与支持格式不匹配");
  }
  if (total > REAL_DATA_MAX_REQUEST_BYTES) throw new RealDataIngestError("REQUEST_TOO_LARGE", 413, "单次请求不能超过 200MB");
  return { files, totalBytes: total };
}

export function publicIngestError(error: unknown) {
  if (error instanceof RealDataIngestError) return error;
  return new RealDataIngestError("INGEST_FAILED", 400, "文件解析或暂存失败");
}
