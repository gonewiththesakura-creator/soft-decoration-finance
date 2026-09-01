import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import * as XLSX from "xlsx";
import { importDefinitions } from "../src/data/excel";

const output = resolve("outputs/soft-decoration-finance/软装项目经营财务系统导入模板.xlsx"); mkdirSync(resolve("outputs/soft-decoration-finance"), { recursive: true });
const book = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
  ["织衡经营财务标准导入模板"],
  ["所有关联字段均填写业务名称或编码，禁止填写数据库 ID。"],
  ["上传后系统先执行名称/编码精确解析、权限检查、重复检查和业务校验，确认前不会写入正式库。"],
]), "使用说明");
for (const definition of importDefinitions) {
  const sheet = XLSX.utils.json_to_sheet([definition.example], { header: definition.fields.map((field) => field.label) });
  sheet["!cols"] = definition.fields.map((field) => ({ wch: Math.max(14, field.label.length * 2 + 4) }));
  XLSX.utils.book_append_sheet(book, sheet, definition.label.slice(0, 31));
}
XLSX.writeFile(book, output);
console.log(`Generated ${output}`);
