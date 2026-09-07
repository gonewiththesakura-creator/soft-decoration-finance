export type DataMode = "real" | "demo";

export function getDataMode(): DataMode {
  const value = (process.env.DATA_MODE ?? "real").trim().toLowerCase();
  if (value !== "real" && value !== "demo") {
    throw new Error(`Invalid DATA_MODE: ${value}. Expected "real" or "demo".`);
  }
  return value;
}

export function isRealDataMode() {
  return getDataMode() === "real";
}
