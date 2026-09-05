import type { AIStructuredResponse } from "./response";

type FactIndex = { money: Set<string>; percentages: Set<string>; numbers: Set<string>; dates: Set<string> };

const numberPattern = /-?\d[\d,]*(?:\.\d+)?/g;
const moneyPattern = /¥\s*-?\d[\d,]*(?:\.\d+)?/g;
const percentPattern = /-?\d[\d,]*(?:\.\d+)?%/g;
const datePattern = /\d{4}[-/]\d{1,2}[-/]\d{1,2}/g;
const tokenPattern = /¥\s*-?\d[\d,]*(?:\.\d+)?|-?\d[\d,]*(?:\.\d+)?%|\d{4}[-/]\d{1,2}[-/]\d{1,2}|-?\d[\d,]*(?:\.\d+)?/g;

function decimal(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(4)).toString() : "";
}

function pathKey(path: string) {
  return path.split(".").at(-1) ?? "";
}

function isIdentifierPath(path: string) {
  return /(?:id|code|number)$/i.test(pathKey(path));
}

function addStringFacts(value: string, path: string, facts: FactIndex) {
  for (const date of value.match(datePattern) ?? []) facts.dates.add(date.replaceAll("/", "-"));
  for (const raw of value.match(moneyPattern) ?? []) {
    const yuan = Number(raw.replace(/[¥\s,]/g, ""));
    if (Number.isFinite(yuan)) facts.money.add(String(Math.round(yuan * 100)));
  }
  for (const raw of value.match(percentPattern) ?? []) {
    const percentage = Number(raw.replace(/[,%]/g, ""));
    if (Number.isFinite(percentage)) facts.percentages.add(decimal(percentage));
  }
  if (isIdentifierPath(path)) return;
  const plain = value.replace(datePattern, " ").replace(moneyPattern, " ").replace(percentPattern, " ");
  for (const raw of plain.match(numberPattern) ?? []) {
    const valueNumber = Number(raw.replaceAll(",", ""));
    if (Number.isFinite(valueNumber)) facts.numbers.add(decimal(valueNumber));
  }
}

function collect(value: unknown, path: string, facts: FactIndex) {
  if (typeof value === "number") {
    const key = pathKey(path);
    if (/cents/i.test(key)) facts.money.add(String(Math.round(value)));
    else if (/bps/i.test(key)) facts.percentages.add(decimal(value / 100));
    else if (/(?:percent|percentage|rate)$/i.test(key)) facts.percentages.add(decimal(value));
    else if (!isIdentifierPath(path)) facts.numbers.add(decimal(value));
    return;
  }
  if (typeof value === "string") { addStringFacts(value, path, facts); return; }
  if (Array.isArray(value)) { value.forEach((item, index) => collect(item, `${path}.${index}`, facts)); return; }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) collect(child, `${path}.${key}`, facts);
}

export function authorizedFacts(toolResults: unknown[]) {
  const facts: FactIndex = { money: new Set(), percentages: new Set(), numbers: new Set(), dates: new Set() };
  toolResults.forEach((result, index) => collect(result, `tool.${index}`, facts));
  return facts;
}

function verified(token: string, facts: FactIndex) {
  if (token.startsWith("¥")) {
    const yuan = Number(token.replace(/[¥\s,]/g, ""));
    return Number.isFinite(yuan) && facts.money.has(String(Math.round(yuan * 100)));
  }
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(token)) return facts.dates.has(token.replaceAll("/", "-"));
  const value = Number(token.replace(/[,%]/g, ""));
  if (!Number.isFinite(value)) return false;
  return token.endsWith("%") ? facts.percentages.has(decimal(value)) : facts.numbers.has(decimal(value));
}

function guardText(text: string, facts: FactIndex) {
  let hidden = 0;
  const value = text.replace(tokenPattern, (token) => {
    if (verified(token, facts)) return token;
    hidden += 1;
    return "[未验证数字已隐藏]";
  });
  return { value, hidden };
}

export function applyNumericGrounding(response: AIStructuredResponse, toolResults: unknown[]) {
  const facts = authorizedFacts(toolResults);
  let unverifiedCount = 0;
  const summary = guardText(response.summary, facts); unverifiedCount += summary.hidden;
  const metrics = response.metrics.filter((metric) => {
    const label = guardText(metric.label, facts);
    const value = guardText(metric.value, facts);
    unverifiedCount += label.hidden + value.hidden;
    return label.hidden + value.hidden === 0;
  });
  const findings = response.findings.map((finding) => {
    const title = guardText(finding.title, facts); const detail = guardText(finding.detail, facts);
    unverifiedCount += title.hidden + detail.hidden;
    return { ...finding, title: title.value, detail: detail.value };
  });
  const recommendations = response.recommendations.map((recommendation) => {
    const title = guardText(recommendation.title, facts); const detail = guardText(recommendation.detail, facts);
    unverifiedCount += title.hidden + detail.hidden;
    return { ...recommendation, title: title.value, detail: detail.value };
  });
  if (unverifiedCount > 0) findings.push({ title: "数字可信度保护已触发", detail: "部分无法追溯到授权业务工具的数据已被隐藏，请以数据依据区为准。", severity: "warning" });
  return { response: { ...response, summary: summary.value, metrics, findings, recommendations }, unverifiedCount };
}
