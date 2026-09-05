import { getAIConfig } from "./config";
import { sqlQuery } from "@/db/client";
import type { SessionUser } from "@/lib/auth";

export class AIRateLimitError extends Error {
  constructor(public readonly code: string, message: string, public readonly retryAfterSeconds: number) {
    super(message);
    this.name = "AIRateLimitError";
  }
}

export function limitsForUser(user: SessionUser) {
  const config = getAIConfig();
  const multiplier = user.role === "owner" ? config.ownerLimitMultiplier : 1;
  return {
    perMinute: config.minuteRequestLimit * multiplier,
    perDay: config.dailyRequestLimit * multiplier,
    tokensPerDay: config.dailyTokenLimit * multiplier,
  };
}

export async function assertAIRateLimit(user: SessionUser) {
  const limits = limitsForUser(user);
  const [usage] = await sqlQuery<{ minuteRequests: number; dailyRequests: number; dailyTokens: number }>(`SELECT
    ((SELECT count(*) FROM ai_runs WHERE user_id=$1 AND started_at>now()-interval '1 minute')+(SELECT count(*) FROM ai_provider_checks WHERE user_id=$1 AND created_at>now()-interval '1 minute'))::int AS "minuteRequests",
    ((SELECT count(*) FROM ai_runs WHERE user_id=$1 AND started_at>=current_date)+(SELECT count(*) FROM ai_provider_checks WHERE user_id=$1 AND created_at>=current_date))::int AS "dailyRequests",
    COALESCE((SELECT sum(total_tokens) FROM ai_runs WHERE user_id=$1 AND started_at>=current_date),0)::int AS "dailyTokens"`, [user.id]);
  if (usage.minuteRequests >= limits.perMinute) throw new AIRateLimitError("AI_RATE_LIMIT_PER_MINUTE", "AI 请求过于频繁，请稍后再试", 60);
  if (usage.dailyRequests >= limits.perDay) throw new AIRateLimitError("AI_DAILY_REQUEST_LIMIT", "今日 AI 请求次数已达到上限", 3600);
  if (usage.dailyTokens >= limits.tokensPerDay) throw new AIRateLimitError("AI_DAILY_TOKEN_LIMIT", "今日 AI Token 用量已达到上限", 3600);
  return { usage, limits };
}
