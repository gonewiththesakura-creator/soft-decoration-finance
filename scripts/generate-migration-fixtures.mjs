import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import * as XLSX from "xlsx";

const output = resolve("tests/fixtures/data-migration"); mkdirSync(output, { recursive: true });
function write(filename, sheets) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["历史数据迁移测试样本"], ["仅用于自动化验收，不包含真实公司数据"]]), "说明");
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), name);
  XLSX.writeFile(book, resolve(output, filename));
}

write("01-项目总表-历史格式.xlsx", { 项目总表: [{ 所属公司: "上海织衡软装工程有限公司", 甲方: "上海嘉和置业有限公司", 工程编号: "MIG-PRJ-001", 工程名称: "迁移样板酒店", 工程地址: "上海市浦东新区", 合同金额: "￥3,200,000", 采购预算: "180万", 开工日期: "2026/09/01", 预计完工日期: "2027.03.01" }] });
write("02-SKU预算表-历史格式.xlsx", { 大堂: [{ 工程名称: "MIG-PRJ-001", 产品编码: "MIG-SKU-001", 区域: "大堂", 产品分类: "家具", 名称: "三人沙发", 品牌: "测试品牌", 数量: "12.5000", 计量单位: "件", 预算价: "12,000元" }], 客房: [{ 工程名称: "MIG-PRJ-001", 产品编码: "MIG-SKU-002", 区域: "客房", 产品分类: "灯具", 名称: "床头灯", 品牌: "测试品牌", 数量: 24, 计量单位: "盏", 预算价: 680 }] });
write("03-采购明细-历史格式.xlsx", { 采购明细: [{ 工程名称: "MIG-PRJ-001", 厂家: "上海大界家具有限公司", 产品编码: "MIG-SKU-001", 采购申请编号: "MIG-CG-001", 支付类型: "对公", 已核价金额: "￥125,000.00", 采购说明: "大堂沙发采购" }] });
write("04-应收收款表-历史格式.xlsx", { 应收计划: [{ 合同编号: "MIG-HT-001", 收款节点: "预付款", 收款比例: "30%", 应收金额: "96万", 预计收款日期: 46367, 质保金: "否" }], 历史收款: [{ 收款节点: "MIG-HT-001 / 预付款", 银行账户: "项目专户", 收款编号: "MIG-SK-001", 已收款: "￥500,000", 收款日期: "2026.09.10" }] });
write("05-供应商应付付款表-历史格式.xlsx", { 供应商: [{ 所属公司: "上海织衡软装工程有限公司", 供应商编码: "MIG-SUP-001", 厂家: "上海大界家具有限公司", 主营品类: "家具", 对接人: "李经理", 手机号: "13900000000", 纳税人识别号: "91310000TEST000001" }], 应付: [{ 采购单编号: "MIG-CGD-001", 应付编号: "MIG-YF-001", 应付金额: "12.5万", 应付日期: "2026/10/01", 付款节点: "预付款", 发票状态: "欠票" }], 付款: [{ 应付编号: "MIG-YF-001", 账户尾号: "8899", 付款编号: "MIG-FK-001", 已打款: "50,000元", 支付日期: "2026-10-02", 付款方式: "银行转账" }] });

console.log(`Generated migration fixtures in ${output}`);
