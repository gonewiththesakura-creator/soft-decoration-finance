import { lstat, rm } from "node:fs/promises";
import { basename, resolve } from "node:path";

const target = resolve(process.cwd(), ".next");
if (basename(target) !== ".next") throw new Error("Refusing to clean an unexpected path");

try {
  const stat = await lstat(target);
  if (stat.isSymbolicLink()) throw new Error("Refusing to remove a symbolic link");
  await rm(target, { recursive: true, force: true, maxRetries: 3 });
  console.log(`Removed ${target}`);
} catch (error) {
  if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
    console.log("No .next directory to remove");
  } else {
    throw error;
  }
}
