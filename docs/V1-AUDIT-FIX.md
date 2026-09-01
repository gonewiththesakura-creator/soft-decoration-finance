# V1.0 验收整改报告

## 结论

V1.0 验收清单中的 P0 项和指定 P1 业务已完成代码整改。自动化测试覆盖权限、金额/数量类型、审批、编辑纠错、Excel 原子导入、登录安全、退换货、库存和发票核销。最终交付以公开 GitHub 仓库的全新克隆流水线为准。

## P0-1 GitHub 源码完整性

- 问题：`data/` 同时忽略了 `src/data/`。
- 修改：改为仅忽略根目录 `/data/`，纳入 `src/data/ai-service.ts`、`dashboard.ts`、`excel.ts`、`excel-import.ts`、`mutations.ts`、`project-detail.ts`、`resources.ts`、`workflows.ts`。
- 文件：`.gitignore`、`src/data/*`。
- 测试：公开仓库全新 clone 后执行 `npm ci`、typecheck、lint、test、build。
- 结果：见“最终全新克隆证明”。

## P0-2 CI

- 修改：增加 push / PR GitHub Actions，Node.js 20 下顺序执行安装、类型检查、Lint、测试和构建。
- 文件：`.github/workflows/ci.yml`。
- 测试：推送后检查 GitHub Actions 运行结果。

## P0-3 金额数据类型

- 修改：所有 `*_cents` 字段统一为 `NUMERIC(18,0)`；查询驱动将 PostgreSQL numeric 安全转换为 JavaScript number；金额聚合移除 `::int`。
- 文件：`src/db/schema.ts`、`src/db/migration.ts`、`src/db/direct.ts`、`drizzle/0001_financial_numeric.sql`、`src/data/*`。
- 测试：从 `information_schema.columns` 断言全部金额字段 precision=18、scale=0；Seed 和业务工作流回归。
- 结果：通过。

## P0-4 小数数量

- 修改：SKU、采购申请明细、收货、退换货和库存数量统一为 `NUMERIC(18,4)`，输入按最多四位小数校验。
- 文件：`src/db/schema.ts`、`src/db/migration.ts`、`drizzle/0001_financial_numeric.sql`、`src/data/mutations.ts`。
- 测试：数据库元数据断言 scale=4；换货 0.5 数量的库存联动测试。
- 结果：通过。

## P0-5 安全编辑与纠错

- 修改：账户、客户、供应商、项目、合同草稿、未收款应收、未下单 SKU、待核价报价、未审批采购/付款申请支持编辑。财务影响数据使用作废、撤销、付款冲销和预算新版本，禁止直接覆盖。
- 文件：`src/data/mutations.ts`、`src/data/resources.ts`、`src/components/resource-table.tsx`、`src/app/api/resources/[resource]/route.ts`。
- 测试：安全状态编辑、非法状态拒绝、收付款反向余额联动、Audit Log before/after 自动化测试。
- 结果：通过。

## P0-6 采购审批详情

- 修改：宽屏审批详情展示公司、项目、供应商、SKU/图片/数量、预算价、最终价、偏差金额和比例、全部报价、运费、安装费、税率、付款条件、交期、总额、申请人、历史意见和附件。审批意见必填。
- 文件：`src/components/approval-detail.tsx`、`src/data/workflows.ts`、`src/app/api/workflows/purchase/[id]/route.ts`。
- 测试：详情结构集成测试；老板浏览器真实登录检查完整字段。
- 结果：通过。

## P0-7 付款审批与职责分离

- 修改：详情展示项目、供应商、采购单、应付总额、已付、本次申请、付款后余额、发票/欠票、账户当前/预计余额、原因和历史。老板只审批，财务只执行；执行前校验公司、状态、应付余额、账户余额和银行回单。
- 文件：`src/components/approval-detail.tsx`、`src/data/workflows.ts`、`src/app/api/workflows/payment/[id]/route.ts`、`src/components/resource-table.tsx`。
- 测试：老板执行付款被服务端拒绝；财务执行成功；冲销恢复应付和账户；已通过申请余额不为负。
- 结果：通过。

## P0-8 权限收紧

- 修改：项目经理只提交参与项目的付款申请/变更，不确认财务事实；设计师只读；采购维护 SKU/报价/采购/退换货；财务维护收付款、发票、应收应付和账户；老板审批且全局查看。
- 文件：`src/lib/permissions.ts`、`src/lib/auth.ts`、`src/app/(app)/layout.tsx`、`src/data/resources.ts`、`docs/PERMISSIONS.md`。
- 测试：owner、finance、procurement、project_manager、designer 的服务端读写和范围测试。
- 结果：通过。

## P0-9 Excel 导入安全

- 修改：确认导入时重新规范化和完整预检；任意错误整体拒绝。检查字段、金额/小数精度、唯一性、外键、公司/项目范围、账户余额和重复文件哈希。正式写入、Audit Log 和 Import Job 共用一个事务。
- 文件：`src/data/excel-import.ts`、`src/data/excel.ts`、`src/app/api/import/route.ts`、`src/components/excel-importer.tsx`、`drizzle/0004_import_safety.sql`。
- 测试：预检错误零写入；事务中故意制造唯一键冲突并确认整个批次回滚。
- 结果：通过。

## P0-10 安全

- 修改：生产缺少 `AUTH_SECRET` 立即失败；生产默认拒绝演示 Seed；邮箱+IP 15 分钟五次失败限流并记日志；每次请求重新加载用户状态和角色；company scope cookie 使用 secure；非老板只接收所属公司。
- 文件：`src/lib/auth.ts`、`src/app/(auth)/login/*`、`src/app/(app)/actions.ts`、`scripts/seed.ts`、`drizzle/0003_auth_security.sql`、`.env.example`、`docs/DEPLOYMENT.md`。
- 测试：连续失败登录及日志测试；权限测试；生产配置由构建/部署文档检查。
- 结果：通过。

## P1 老板首页

- 修改：固定六项指标为集团资金、未来 30 天净现金流、待审批采购/付款、超预算、欠票和进行中项目。现金流显示“当前资金 + 预计收款 - 预计付款 = 预计期末资金”及资金缺口。
- 文件：`src/data/dashboard.ts`、`src/app/(app)/dashboard/page.tsx`。
- 测试：浏览器登录老板账号核对六卡片、计算等式和公司汇总。
- 结果：通过。

## P1 第一版遗留业务

- 修改：采购取消、退货、换货、退款、付款冲销采用事务更新订单/应付/账户/库存；建立库存批次和流水；发票通过 `invoice_allocations` 核销到应付或应收；增加银行回单、合同、报价、采购和 SKU 图片 URL 字段及页面状态。
- 文件：`src/data/mutations.ts`、`src/data/resources.ts`、`src/db/schema.ts`、`src/db/migration.ts`、`drizzle/0002_business_attachments.sql`、`drizzle/0005_invoice_allocations.sql`、`scripts/seed.ts`。
- 测试：换货扣减库存并生成流水；进项票生成应付分摊；付款冲销恢复余额；Seed 业务状态一致性。
- 结果：通过。

## 自动化与浏览器结果

- `npm test`：17/17 通过。
- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `npm run build`：通过。
- 浏览器：老板驾驶舱、采购审批详情、财务付款详情和职责分离通过。

## 最终全新克隆证明

在全新临时目录克隆公开仓库提交 `df96210c1c584de2c583cd8901eee327e81c3c03`，依次执行：

```text
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

- 源码完整性：全新克隆包含 8 个 `src/data` 模块。
- `npm ci`：通过，安装 391 个依赖包。
- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `npm test`：17/17 通过。
- `npm run build`：通过，生成 15 个路由入口。
- GitHub Actions：[CI run 33461758256](https://github.com/gonewiththesakura-creator/soft-decoration-finance/actions/runs/33461758256) 成功。

## 尚未解决问题

- 附件证据当前保存 URL，未接入对象存储直传、病毒扫描和签名下载。
- 尚无审计款最终金额独立工作台和质保到期定时任务。
- 超大 Excel 文件仍为同步导入，没有异步队列和失败任务重试。
- 尚未接入消息通知和 OpenAI API；AI 查询保持确定性只读实现。
- PGlite 适合单机试点，多实例正式部署需迁移托管 PostgreSQL。
