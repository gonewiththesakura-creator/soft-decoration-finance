type ActiveRun = { controller: AbortController; startedAt: number };

const globalRuns = globalThis as typeof globalThis & { __activeAIRuns?: Map<number, ActiveRun> };
const activeRuns = globalRuns.__activeAIRuns ??= new Map<number, ActiveRun>();

export function beginAIRun(userId: number) {
  if (activeRuns.has(userId)) return null;
  const run = { controller: new AbortController(), startedAt: Date.now() };
  activeRuns.set(userId, run);
  return run;
}
export function finishActiveAIRun(userId: number, controller: AbortController) {
  if (activeRuns.get(userId)?.controller === controller) activeRuns.delete(userId);
}

export function cancelActiveAIRun(userId: number) {
  const run = activeRuns.get(userId);
  if (!run) return false;
  run.controller.abort();
  return true;
}
