import { NextResponse } from "next/server";
import { getCompanyScope, getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { answerFinancialQuestion } from "@/data/ai-service";
import { sqlQuery } from "@/db/client";

export async function POST(request: Request) {
  const user = await getSession(); if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 }); if (!can(user, "ai")) return NextResponse.json({ error: "无权使用 AI 查询" }, { status: 403 });
  try {
    const question = String((await request.json()).question ?? "").slice(0, 500); if (!question) throw new Error("请输入问题"); const scope = await getCompanyScope(user); const answer = await answerFinancialQuestion(question, user, scope);
    await sqlQuery("INSERT INTO ai_queries(company_id,user_id,question,answer) VALUES($1,$2,$3,$4::jsonb)", [scope, user.id, question, JSON.stringify(answer)]);
    return NextResponse.json({ answer });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "查询失败" }, { status: 400 }); }
}
