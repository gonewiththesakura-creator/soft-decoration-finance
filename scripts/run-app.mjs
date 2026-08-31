import { spawn } from "node:child_process";
import process from "node:process";

const mode = process.argv[2] === "start" ? "start" : "dev";
const forwarded = process.argv.slice(3);
const databaseUrl = `http://127.0.0.1:${process.env.PGLITE_SERVER_PORT ?? "3199"}`;

async function healthy() {
  try { const response = await fetch(`${databaseUrl}/health`); const payload = await response.json(); return response.ok && payload.service === "zhiheng-pglite"; }
  catch { return false; }
}

let databaseProcess = null;
if (!await healthy()) {
  databaseProcess = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/db-server.ts"], { stdio: "inherit", env: process.env });
  for (let i = 0; i < 80 && !await healthy(); i++) await new Promise((resolve) => setTimeout(resolve, 250));
  if (!await healthy()) { databaseProcess.kill(); throw new Error("Database service failed to start"); }
}

const nextProcess = spawn(process.execPath, ["node_modules/next/dist/bin/next", mode, ...forwarded], { stdio: "inherit", env: process.env });
function shutdown(signal = "SIGTERM") { nextProcess.kill(signal); databaseProcess?.kill(signal); }
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
nextProcess.on("exit", (code) => { databaseProcess?.kill(); process.exitCode = code ?? 0; });
