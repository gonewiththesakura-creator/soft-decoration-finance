import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const testDir = await mkdtemp(join(tmpdir(), "zhiheng-finance-test-"));
const testPort = String(32000 + Math.floor(Math.random() * 1000));
const env = { ...process.env, PGLITE_DATA_DIR: join(testDir, "database"), PGLITE_SERVER_PORT: testPort };

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env, ...options });
    child.on("exit", (code) => code === 0 ? resolve(code) : reject(new Error(`${args.join(" ")} exited with ${code}`)));
    child.on("error", reject);
  });
}

let databaseProcess = null;
try {
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
  await run(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "tests"]);
} finally {
  databaseProcess?.kill();
  await new Promise((resolve) => setTimeout(resolve, 300));
  await rm(testDir, { recursive: true, force: true });
}
