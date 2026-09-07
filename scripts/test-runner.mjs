import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const realTestDir = await mkdtemp(join(tmpdir(), "zhiheng-finance-real-test-"));
const testDir = await mkdtemp(join(tmpdir(), "zhiheng-finance-test-"));
const testPort = String(32000 + Math.floor(Math.random() * 1000));
const importRoot = join(testDir, "import-drop");
await mkdir(importRoot, { recursive: true });
const env = { ...process.env, DATA_MODE: "demo", PGLITE_DATA_DIR: join(testDir, "database"), PGLITE_SERVER_PORT: testPort, UPLOADS_DIR: join(testDir, "uploads"), IMPORT_STORAGE_DIR: join(testDir, "imports"), IMPORT_ALLOWED_ROOTS: importRoot };
const realEnv = { ...process.env, DATA_MODE: "real", NODE_ENV: "test", PGLITE_DATA_DIR: join(realTestDir, "database"), PGLITE_SERVER_PORT: String(Number(testPort) + 2000), UPLOADS_DIR: join(realTestDir, "uploads"), IMPORT_STORAGE_DIR: join(realTestDir, "imports"), REAL_DATA_BACKUP_DIR: join(realTestDir, "backups"), BOOTSTRAP_OWNER_EMAIL: "owner@real.test", BOOTSTRAP_OWNER_NAME: "Real Test Owner", BOOTSTRAP_OWNER_PASSWORD: "RealTest@2026!", REAL_DATA_INGEST_TOKEN: "test-real-data-ingest-token-2026-09-07", REAL_DATA_INGEST_REQUESTS_PER_MINUTE: "1000", REAL_DATA_INGEST_FILES_PER_HOUR: "1000" };

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env, ...options });
    child.on("exit", (code) => code === 0 ? resolve(code) : reject(new Error(`${args.join(" ")} exited with ${code}`)));
    child.on("error", reject);
  });
}

function runWithInput(command, args, stdinText, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "inherit", "inherit"], env, ...options });
    child.stdin.end(stdinText);
    child.on("exit", (code) => code === 0 ? resolve(code) : reject(new Error(`${args.join(" ")} exited with ${code}`)));
    child.on("error", reject);
  });
}

let databaseProcess = null;
let realDatabaseProcess = null;
try {
  await run(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/bootstrap.ts"], { env: realEnv });
  await run(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/bootstrap.ts"], { env: realEnv });
  await run(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/verify-real-empty.ts"], { env: realEnv });
  await run(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/prepare-real-reset-test.ts"], { env: realEnv });
  await runWithInput(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/reset-real-data.ts"], "RESET_TO_REAL_DATA\n", { env: realEnv });
  await run(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/verify-real-empty.ts"], { env: realEnv });
  realDatabaseProcess = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/db-server.ts"], { stdio: "inherit", env: realEnv });
  const realBase = `http://127.0.0.1:${realEnv.PGLITE_SERVER_PORT}`;
  let realReady = false;
  for (let i = 0; i < 80; i++) {
    try { realReady = (await fetch(`${realBase}/health`)).ok; } catch { realReady = false; }
    if (realReady) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!realReady) throw new Error("Real test database service failed to start");
  await run(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "tests/external-ingest-real.test.ts"], { env: realEnv });
  realDatabaseProcess.kill();
  realDatabaseProcess = null;
  await new Promise((resolve) => setTimeout(resolve, 300));
  await run(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/seed.ts"]);
  databaseProcess = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/db-server.ts"], { stdio: "inherit", env });
  const base = `http://127.0.0.1:${testPort}`;
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try { ready = (await fetch(`${base}/health`)).ok; } catch { ready = false; }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error("Test database service failed to start");
  await run(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "tests/unit.test.ts", "tests/integration.test.ts", "tests/ai-unit.test.ts", "tests/ai-integration.test.ts"]);
} finally {
  databaseProcess?.kill();
  realDatabaseProcess?.kill();
  await new Promise((resolve) => setTimeout(resolve, 300));
  await rm(realTestDir, { recursive: true, force: true });
  await rm(testDir, { recursive: true, force: true });
}
