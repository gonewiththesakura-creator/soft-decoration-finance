# 织衡经营财务

面向 B 端软装工程公司的项目采购经营财务系统。合同、应收、SKU、报价、采购、应付、付款、收款、发票和预算均围绕项目关联，正式会计核算继续由用友承担。

## 当前能力

- 3 家公司独立核算及集团汇总切换
- 老板、财务、采购、项目经理、设计师五类角色
- 公司作用域与项目成员作用域的服务端数据隔离
- 项目 → 合同 → 应收 → SKU → 报价 → 采购申请 → 审批 → 采购单 → 应付 → 付款 → 收款 → 发票主链路
- 采购审批通过后在同一事务生成采购单和应付
- 付款审批、付款登记、应付余额与账户余额联动
- 收款登记、应收余额与账户余额联动
- 项目经营总账、质保金独立状态、预算版本、退货冲减及操作日志
- 老板首页六项核心指标与未来 30 天现金流
- 数据迁移中心：日常标准导入、历史多 Sheet、字段 Mapping、名称解析、暂存预检、批次血缘和安全撤销
- 只读 AI Query Service，回答逾期、超预算、欠票、应收应付和资金缺口

## 技术架构

- Next.js 15 / React 19 / TypeScript
- Tailwind CSS 4
- PGlite 嵌入式 PostgreSQL / Drizzle Schema
- 独立本地数据库服务进程，避免 Next 页面与 API 重复打开数据目录
- JWT HttpOnly Cookie 登录
- SheetJS 负责网页内 Excel 解析，交付模板由 artifact-tool 生成
- Vitest 单元与业务集成测试

所有金额以整数“分”存储。关键财务表包含 `company_id`、`project_id`、`version`、`is_void` 和 `void_reason`。本地数据库保存于 `data/finance-db`，已从 Git 排除。

## 快速启动

要求 Node.js 22.x。

```bash
npm install
Copy-Item .env.example .env.local
npm run db:seed
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。`npm run dev` 会同时启动唯一数据库服务和 Next.js，不要单独执行 `next dev`。

如数据库已有 Seed Data，`npm run db:seed` 会安全跳过。重置前应先停止应用：

```bash
npm run db:reset
npm run db:seed
```

## 测试账号

所有 Seed 账号密码均为 `Demo@2026`。

| 角色 | 邮箱 | 数据范围 |
| --- | --- | --- |
| 老板 | `owner@zhiheng.local` | 全集团，可切换单家公司 |
| 财务 | `finance11@zhiheng.local` | 上海织衡公司 |
| 采购 | `procurement13@zhiheng.local` | 上海织衡公司 |
| 项目经理 | `project_manager15@zhiheng.local` | 上海织衡且仅参与项目 |
| 设计师 | `designer16@zhiheng.local` | 上海织衡且仅参与项目 |

正式使用前必须更换 Seed 密码与 `AUTH_SECRET`。

## 常用命令

```bash
npm run dev          # 数据库服务 + 开发服务器
npm run dev:clean    # 安全清理 .next 后启动开发服务器
npm run clean        # 只清理 .next 构建缓存
npm run build        # 生产构建
npm start            # 数据库服务 + 生产服务器
npm test             # 临时隔离数据库上的单元与集成测试
npm run typecheck    # TypeScript 检查
npm run lint         # ESLint
npm run db:seed      # 初始化关联演示数据
npm run db:reset     # 清空并重建本地 Schema（先停止应用）
npm run templates:generate # 重新生成标准模板和 5 套迁移测试工作簿
```

## 数据规模

Seed 包含 3 家公司、6 个公司账户、22 个用户、24 个客户、48 个供应商、12 个项目、360 个 SKU、840 份报价、180 笔采购申请、108+ 采购单/应付、129 笔付款、60 笔收款和 144 张发票。所有页面与 Dashboard 从同一数据库聚合，不使用页面级假数据。

## 目录

```text
src/app/                 页面、API 与 Server Actions
src/data/                聚合查询、业务写入、审批、AI 与 Excel 服务
src/db/                  Drizzle Schema、迁移与数据库客户端
src/lib/                 登录、权限、审计和格式化
scripts/                 Seed、重置、数据库服务和测试启动器
tests/                   单元与业务集成测试
outputs/                 可交付 Excel 工作簿
docs/                    权限、测试、部署与版本状态
```

## Excel 模板

系统内可以按业务对象下载不含数据库 ID 的单独模板。完整汇总模板位于 [软装项目经营财务系统导入模板.xlsx](outputs/soft-decoration-finance/软装项目经营财务系统导入模板.xlsx)，包含使用说明及 14 个业务 Sheet；5 套历史格式测试工作簿位于 `tests/fixtures/data-migration`。

## 文档

- [权限说明](docs/PERMISSIONS.md)
- [测试说明](docs/TESTING.md)
- [部署说明](docs/DEPLOYMENT.md)
- [Windows 运行稳定性](docs/RUNTIME-STABILITY.md)
- [数据迁移中心](docs/DATA-MIGRATION.md)
- [完成情况、已知问题与二期建议](docs/STATUS.md)

## 数据备份

停止应用后复制整个 `data/finance-db` 目录即可完成一致性备份。恢复时将备份目录放回相同位置。不要在应用运行期间用第二个 PGlite 进程直接打开该目录。

## 产品边界

本系统是经营管理系统，不是正式会计软件。第一版不提供会计科目、凭证、总账、月结、三大财务报表、报税、银行 API、用友/金蝶 API、OCR、CRM 或完整 WMS。
