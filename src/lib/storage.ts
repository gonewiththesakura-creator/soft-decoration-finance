import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, resolve, sep } from "node:path";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ALLOWED_UPLOAD_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export interface StorageService {
  put(file: File): Promise<{ storageKey: string; filename: string; size: number; mimeType: string }>;
  read(storageKey: string): Promise<Buffer>;
  delete(storageKey: string): Promise<void>;
}

export class LocalStorageService implements StorageService {
  private readonly root: string;

  constructor(root = process.env.UPLOADS_DIR ?? "./uploads") { this.root = resolve(root); }

  private pathFor(storageKey: string) {
    const filePath = resolve(this.root, storageKey);
    if (!filePath.startsWith(`${this.root}${sep}`)) throw new Error("非法文件路径");
    return filePath;
  }

  async put(file: File) {
    if (!file.size || file.size > MAX_UPLOAD_BYTES) throw new Error("附件大小必须在 1B 到 10MB 之间");
    if (!ALLOWED_UPLOAD_TYPES.has(file.type)) throw new Error("仅支持 PDF、JPG、PNG、WebP、XLSX 和 DOCX 文件");
    const extension = extname(basename(file.name)).toLowerCase().replace(/[^.a-z0-9]/g, "");
    const storageKey = `${new Date().toISOString().slice(0, 7)}/${randomUUID()}${extension}`;
    const filename = `${randomUUID()}${extension}`;
    const filePath = this.pathFor(storageKey);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, Buffer.from(await file.arrayBuffer()), { flag: "wx" });
    return { storageKey, filename, size: file.size, mimeType: file.type };
  }

  read(storageKey: string) { return readFile(this.pathFor(storageKey)); }
  delete(storageKey: string) { return rm(this.pathFor(storageKey), { force: true }); }
}

export const storageService: StorageService = new LocalStorageService();
