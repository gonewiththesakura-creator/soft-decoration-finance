import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import { delimiter, extname, isAbsolute, parse, relative, resolve, sep } from "node:path";
import { sqlQuery } from "@/db/client";
import type { SessionUser } from "@/lib/auth";
import { assertCan } from "@/lib/permissions";
import { isSupportedImportFile, type FingerprintStatus } from "./import-pilot";

const maxFiles = 250;
const maxFileBytes = 30 * 1024 * 1024;
const maxTotalBytes = 500 * 1024 * 1024;
const scanTimeoutMs = 15_000;

function configuredRoots() {
  const raw = process.env.IMPORT_ALLOWED_ROOTS?.trim();
  const roots = (raw ? raw.split(delimiter) : ["./import-drop"]).map((item) => resolve(item.trim())).filter(Boolean);
  if (!roots.length) throw new Error("IMPORT_ALLOWED_ROOTS 未配置");
  return roots;
}

function isSystemDirectory(pathname: string) {
  const normalized = pathname.toLowerCase().replaceAll("/", "\\");
  return [/\\windows(?:\\|$)/, /\\program files(?: \(x86\))?(?:\\|$)/, /\\programdata(?:\\|$)/].some((pattern) => pattern.test(normalized));
}

function inside(root: string, target: string) {
  const pathFromRoot = relative(root, target);
  return pathFromRoot === "" || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== ".." && !isAbsolute(pathFromRoot));
}

export async function resolveAllowedImportFolder(folderPath: string) {
  if (!folderPath.trim()) throw new Error("请输入服务器文件夹路径");
  if (/^(?:\\\\|\/\/)/.test(folderPath)) throw new Error("不允许扫描 UNC 或网络路径");
  if (folderPath.split(/[\\/]+/).includes("..")) throw new Error("路径中不允许包含 ..");
  const candidate = resolve(folderPath);
  if (isSystemDirectory(candidate) || parse(candidate).root === candidate) throw new Error("不允许扫描系统目录或磁盘根目录");
  const roots = await Promise.all(configuredRoots().map(async (root) => {
    if (isSystemDirectory(root) || parse(root).root === root) throw new Error(`IMPORT_ALLOWED_ROOTS 包含不安全目录：${root}`);
    return realpath(root);
  }));
  const resolvedCandidate = await realpath(candidate);
  if (!roots.some((root) => inside(root, resolvedCandidate))) throw new Error("路径不在 IMPORT_ALLOWED_ROOTS 允许范围内");
  const relativeParts = roots.map((root) => relative(root, resolvedCandidate)).find((item) => !item.startsWith(".."))?.split(sep) ?? [];
  if (relativeParts.some((part) => part.startsWith("."))) throw new Error("不允许扫描隐藏目录");
  const info = await lstat(resolvedCandidate);
  if (info.isSymbolicLink()) throw new Error("不允许扫描符号链接目录");
  if (!info.isDirectory()) throw new Error("目标路径不是文件夹");
  return resolvedCandidate;
}

type ScannedFile = {
  path: string;
  filename: string;
  extension: string;
  size: number;
  modifiedAt: string;
  hash: string | null;
  status: FingerprintStatus;
  previousBatchNumber: string | null;
  error: string | null;
};

async function walk(root: string, recursive: boolean, startedAt: number, output: string[]) {
  if (Date.now() - startedAt > scanTimeoutMs) throw new Error("文件夹扫描超时，请缩小目录范围");
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (output.length >= maxFiles) throw new Error(`文件数量超过 ${maxFiles} 个，请拆分目录`);
    if (entry.name.startsWith(".")) continue;
    const target = resolve(root, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory() && recursive) await walk(target, recursive, startedAt, output);
    else if (entry.isFile()) output.push(target);
  }
}

export async function scanImportFolder(input: { folderPath: string; recursive?: boolean }, user: SessionUser) {
  assertCan(user, "imports");
  if (user.role !== "owner") throw new Error("FOLDER_SCAN_FORBIDDEN");
  const folder = await resolveAllowedImportFolder(input.folderPath);
  const paths: string[] = [];
  const startedAt = Date.now();
  await walk(folder, Boolean(input.recursive), startedAt, paths);
  const history = await sqlQuery<{ sourcePath: string | null; fileHash: string; batchNumber: string }>(`SELECT f.source_path AS "sourcePath",f.file_hash AS "fileHash",b.batch_number AS "batchNumber" FROM import_files f JOIN import_batches b ON b.id=f.batch_id ORDER BY f.created_at DESC`);
  const byPath = new Map(history.filter((item) => item.sourcePath).map((item) => [String(item.sourcePath).toLowerCase(), item]));
  const byHash = new Map(history.map((item) => [item.fileHash, item]));
  const files: ScannedFile[] = [];
  let totalBytes = 0;
  for (const pathname of paths) {
    const filename = pathname.slice(pathname.lastIndexOf(sep) + 1);
    const extension = extname(filename).toLowerCase();
    try {
      const info = await stat(pathname);
      totalBytes += info.size;
      if (totalBytes > maxTotalBytes) throw new Error("扫描文件总大小超过 500MB");
      if (!isSupportedImportFile(filename)) {
        files.push({ path: pathname, filename, extension, size: info.size, modifiedAt: info.mtime.toISOString(), hash: null, status: "UNSUPPORTED", previousBatchNumber: null, error: null });
        continue;
      }
      if (info.size > maxFileBytes) throw new Error("文件超过 30MB");
      const bytes = await readFile(pathname);
      const hash = createHash("sha256").update(bytes).digest("hex");
      const previousPath = byPath.get(pathname.toLowerCase());
      const previousHash = byHash.get(hash);
      const status: FingerprintStatus = previousPath?.fileHash === hash ? "UNCHANGED" : previousHash ? "DUPLICATE" : previousPath ? "UPDATED" : "NEW";
      files.push({ path: pathname, filename, extension, size: info.size, modifiedAt: info.mtime.toISOString(), hash, status, previousBatchNumber: (previousPath ?? previousHash)?.batchNumber ?? null, error: null });
    } catch (error) {
      files.push({ path: pathname, filename, extension, size: 0, modifiedAt: "", hash: null, status: "ERROR", previousBatchNumber: null, error: error instanceof Error ? error.message : "读取失败" });
    }
  }
  return { folder, recursive: Boolean(input.recursive), scannedAt: new Date().toISOString(), limits: { maxFiles, maxFileBytes, maxTotalBytes, scanTimeoutMs }, files };
}

export async function readAllowedImportFile(pathname: string, user: SessionUser) {
  assertCan(user, "imports", "write");
  if (user.role !== "owner") throw new Error("FOLDER_SCAN_FORBIDDEN");
  const folder = await resolveAllowedImportFolder(resolve(pathname, ".."));
  const target = await realpath(pathname);
  if (!inside(folder, target)) throw new Error("文件路径超出已验证目录");
  const info = await lstat(target);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("只能暂存普通文件");
  if (!isSupportedImportFile(target) || info.size > maxFileBytes) throw new Error("文件类型或大小不符合要求");
  return { pathname: target, bytes: await readFile(target), modifiedAt: info.mtime };
}
