import "dotenv/config";
import { hash } from "bcryptjs";
import { directDb as db, ensureDirectDatabase as ensureDatabase, directQuery as sqlQuery } from "../src/db/direct";
import {
  auditLogs,
  companies,
  companyAccounts,
  contracts,
  customers,
  goodsReceipts,
  invoiceAllocations,
  invoices,
  inventoryBatches,
  inventoryTransactions,
  payables,
  paymentApprovals,
  paymentRequests,
  payments,
  projectBudgetVersions,
  projectChanges,
  projectMembers,
  projects,
  purchaseApprovals,
  purchaseOrders,
  purchaseRequestItems,
  purchaseRequests,
  purchaseReturns,
  receivablePlans,
  receipts,
  skus,
  supplierQuotes,
  suppliers,
  users,
} from "../src/db/schema";

const DAY = 86_400_000;
const now = new Date();
const dateAt = (days: number) => new Date(now.getTime() + days * DAY);
const yuan = (value: number) => Math.round(value * 100);

async function seed() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "true") throw new Error("Demo seed is disabled in production. Set ALLOW_DEMO_SEED=true only for an isolated demonstration environment.");
  await ensureDatabase();
  const [{ count }] = await sqlQuery<{ count: number }>("SELECT count(*)::int AS count FROM companies");
  if (count > 0) {
    console.log("Database already contains seed data. Run npm run db:reset to rebuild it.");
    return;
  }

  const companyRows = await db.insert(companies).values([
    { code: "ZH", name: "上海织衡软装有限公司", legalRepresentative: "陈屿" },
    { code: "MU", name: "杭州木序空间设计有限公司", legalRepresentative: "陈屿" },
    { code: "JY", name: "苏州境屿家居有限公司", legalRepresentative: "陈屿" },
  ]).returning();

  const passwordHash = await hash("Demo@2026", 10);
  const userValues: typeof users.$inferInsert[] = [
    { companyId: null, name: "陈屿", email: "owner@zhiheng.local", passwordHash, role: "owner" },
  ];
  const roleNames = [
    ["财务经理", "finance"], ["财务专员", "finance"],
    ["采购经理", "procurement"], ["采购专员", "procurement"],
    ["项目经理", "project_manager"], ["主案设计师", "designer"], ["深化设计师", "designer"],
  ] as const;
  companyRows.forEach((company, companyIndex) => {
    roleNames.forEach(([, role], index) => {
      userValues.push({
        companyId: company.id,
        name: `${["林", "周", "许"][companyIndex]}${["静", "妍", "朗", "睿", "川", "夏", "宁"][index]}`,
        email: `${role}${companyIndex + 1}${index + 1}@zhiheng.local`,
        passwordHash,
        role,
      });
    });
  });
  const userRows = await db.insert(users).values(userValues).returning();
  const owner = userRows[0];

  const accountValues: typeof companyAccounts.$inferInsert[] = [];
  companyRows.forEach((company, i) => {
    accountValues.push(
      { companyId: company.id, name: "基本户", type: "对公账户", bank: "招商银行", lastFour: `${2810 + i}`, balanceCents: yuan(2_380_000 + i * 620_000), createdBy: owner.id },
      { companyId: company.id, name: "一般户", type: "对公账户", bank: "中国银行", lastFour: `${7362 + i}`, balanceCents: yuan(860_000 + i * 280_000), createdBy: owner.id },
    );
  });
  const accountRows = await db.insert(companyAccounts).values(accountValues).returning();

  const customerPrefixes = ["华润", "万科", "绿城", "融创", "中海", "保利", "金地", "招商"];
  const supplierCategories = ["家具", "灯具", "窗帘", "墙布", "饰品", "地毯", "定制", "安装"];
  const customerValues: typeof customers.$inferInsert[] = [];
  const supplierValues: typeof suppliers.$inferInsert[] = [];
  companyRows.forEach((company, ci) => {
    customerPrefixes.forEach((prefix, i) => customerValues.push({
      companyId: company.id, code: `C${ci + 1}${String(i + 1).padStart(3, "0")}`,
      name: `${prefix}${["置业", "酒店管理", "商业运营"][ci]}有限公司`,
      type: i % 3 === 0 ? "地产公司" : i % 3 === 1 ? "酒店" : "设计公司",
      contact: `${["王", "李", "张", "赵"][i % 4]}经理`, phone: `1380000${ci}${String(i).padStart(2, "0")}`, createdBy: owner.id,
    }));
    Array.from({ length: 16 }, (_, i) => supplierValues.push({
      companyId: company.id, code: `S${ci + 1}${String(i + 1).padStart(3, "0")}`,
      name: `${["简木", "光域", "织物研社", "素境", "艺仓", "和毯", "木作集", "安筑"][i % 8]}${["上海", "杭州", "苏州", "深圳"][i % 4]}供应链`,
      category: supplierCategories[i % supplierCategories.length], contact: `${["刘", "孙", "郑", "何"][i % 4]}总`,
      phone: `1391000${ci}${String(i).padStart(2, "0")}`, taxNumber: `91310000MA${ci}${String(i).padStart(5, "0")}`, createdBy: owner.id,
    }));
  });
  const customerRows = await db.insert(customers).values(customerValues).returning();
  const supplierRows = await db.insert(suppliers).values(supplierValues).returning();

  const projectNames = ["云栖壹号会所", "澜庭精品酒店", "江岸艺术中心", "栖湖样板间"];
  const projectValues: typeof projects.$inferInsert[] = [];
  companyRows.forEach((company, ci) => {
    const companyUsers = userRows.filter((u) => u.companyId === company.id);
    for (let pi = 0; pi < 4; pi++) {
      const amount = yuan(2_600_000 + ci * 720_000 + pi * 940_000);
      projectValues.push({
        companyId: company.id, customerId: customerRows[ci * 8 + pi * 2].id,
        code: `PRJ-${now.getFullYear()}-${ci + 1}${String(pi + 1).padStart(2, "0")}`,
        name: `${["上海", "杭州", "苏州"][ci]}${projectNames[pi]}`, address: `${["上海浦东", "杭州西湖", "苏州工业园区"][ci]}核心项目现场`,
        ownerId: owner.id, managerId: companyUsers.find((u) => u.role === "project_manager")!.id,
        designerId: companyUsers.find((u) => u.role === "designer")!.id,
        originalContractCents: amount, currentContractCents: pi === 2 ? amount + yuan(180_000) : amount,
        budgetCents: Math.round(amount * (pi === 3 ? 0.7 : 0.58)), startDate: dateAt(-150 + pi * 28),
        expectedEndDate: dateAt(45 + pi * 42), warrantyEndDate: dateAt(380 + pi * 30),
        auditStatus: pi === 0 ? "审计中" : "未开始", status: ["执行中", "待验收", "执行中", "待审计"][pi], createdBy: owner.id,
      });
    }
  });
  const projectRows = await db.insert(projects).values(projectValues).returning();

  await db.insert(projectMembers).values(projectRows.flatMap((project) => {
    const assigned = userRows.filter((u) => u.id === project.managerId || u.id === project.designerId);
    return assigned.map((user) => ({ projectId: project.id, userId: user.id, responsibility: user.role === "designer" ? "设计" : "项目管理", createdBy: owner.id }));
  }));
  await db.insert(projectBudgetVersions).values(projectRows.flatMap((project, i) => [
    { companyId: project.companyId, projectId: project.id, version: 1, type: "原始预算", amountCents: Math.round(project.budgetCents * 0.94), createdBy: owner.id },
    { companyId: project.companyId, projectId: project.id, version: 2, type: "签约预算", amountCents: project.budgetCents, createdBy: owner.id },
    ...(i % 3 === 0 ? [{ companyId: project.companyId, projectId: project.id, version: 3, type: "变更预算", amountCents: project.budgetCents + yuan(90_000), createdBy: owner.id }] : []),
  ]));
  await db.insert(projectChanges).values(projectRows.filter((_, i) => i % 3 === 0).map((project, i) => ({
    companyId: project.companyId, projectId: project.id, number: `CHG-${String(i + 1).padStart(4, "0")}`, type: "增项",
    originalCents: project.originalContractCents, adjustmentCents: yuan(180_000), newCents: project.originalContractCents + yuan(180_000),
    reason: "公共区域家具深化后增补", applicantId: project.managerId!, approverId: owner.id, status: "已通过", createdBy: project.managerId,
  })));

  const contractRows = await db.insert(contracts).values(projectRows.map((project, i) => ({
    companyId: project.companyId, projectId: project.id, number: `HT-${now.getFullYear()}-${String(i + 1).padStart(4, "0")}`,
    name: `${project.name}软装采购及安装合同`, amountCents: project.currentContractCents, signedAt: dateAt(-140 + (i % 4) * 20), createdBy: owner.id,
  }))).returning();

  const nodes = [
    ["合同预付款", 3000, -120, false], ["送货前款", 3000, -25, false], ["验收款", 2000, 12, false],
    ["审计款", 1500, 55, false], ["质保金", 500, 390, true],
  ] as const;
  const planValues: typeof receivablePlans.$inferInsert[] = [];
  projectRows.forEach((project, i) => nodes.forEach(([nodeName, ratioBps, offset, isWarranty], ni) => {
    const amountCents = Math.round(project.currentContractCents * ratioBps / 10_000);
    const paid = ni === 0 || (ni === 1 && i % 3 !== 0);
    planValues.push({
      companyId: project.companyId, projectId: project.id, contractId: contractRows[i].id, nodeName, ratioBps, amountCents,
      receivedCents: paid ? amountCents : 0, dueDate: dateAt(offset + (i % 4) * 7), isWarranty,
      status: isWarranty ? "待释放质保金" : paid ? "已收" : offset < 0 ? "已逾期" : "未到期", createdBy: owner.id,
    });
  }));
  const planRows = await db.insert(receivablePlans).values(planValues).returning();

  const receiptValues: typeof receipts.$inferInsert[] = [];
  planRows.filter((plan) => plan.receivedCents > 0).forEach((plan, i) => {
    const chunks = 3;
    for (let chunk = 0; chunk < chunks; chunk++) {
      const base = Math.floor(plan.receivedCents / chunks);
      receiptValues.push({
        companyId: plan.companyId, projectId: plan.projectId, receivablePlanId: plan.id,
        accountId: accountRows.find((a) => a.companyId === plan.companyId)!.id,
        number: `SK-${String(i * chunks + chunk + 1).padStart(5, "0")}`,
        amountCents: chunk === chunks - 1 ? plan.receivedCents - base * (chunks - 1) : base,
        receivedAt: dateAt(-100 + (i % 25) + chunk * 6), method: "银行转账", createdBy: owner.id,
      });
    }
  });
  await db.insert(receipts).values(receiptValues);

  const categories = ["单椅", "沙发", "茶几", "餐桌", "吊灯", "台灯", "窗帘", "墙布", "地毯", "摆件"];
  const rooms = ["大堂", "客厅", "餐厅", "主卧", "书房", "走廊"];
  const skuValues: typeof skus.$inferInsert[] = [];
  projectRows.forEach((project, projectIndex) => {
    const companySuppliers = supplierRows.filter((s) => s.companyId === project.companyId);
    for (let i = 0; i < 30; i++) {
      const budgetUnit = yuan(1_800 + (i % 10) * 1_350 + projectIndex * 80);
      skuValues.push({
        companyId: project.companyId, projectId: project.id, code: `${project.code}-SKU-${String(i + 1).padStart(3, "0")}`,
        room: rooms[i % rooms.length], category: categories[i % categories.length], name: `${categories[i % categories.length]} ${String.fromCharCode(65 + i % 6)}款`,
        brand: ["HAY", "Muuto", "Flos", "Kvadrat", "本来设计"][i % 5], model: `M-${1200 + i}`,
        specification: `${800 + i * 10}x${600 + i * 5}mm`, material: ["胡桃木", "黄铜", "羊毛", "亚麻"][i % 4],
        color: ["烟灰", "墨绿", "米白", "焦糖"][i % 4], quantity: 1 + (i % 8), unit: i % 3 === 0 ? "组" : "件",
        budgetUnitCents: budgetUnit, finalUnitCents: Math.round(budgetUnit * (0.88 + (i % 7) * 0.035)),
        supplierId: companySuppliers[i % companySuppliers.length].id, taxRateBps: i % 4 === 0 ? 300 : 1300,
        freightCents: yuan(i % 5 === 0 ? 600 : 0), installCents: yuan(i % 4 === 0 ? 800 : 0), leadDays: 12 + i % 28,
        status: i < 15 ? "已下单" : i < 22 ? "已核价" : "待询价", createdBy: project.designerId,
      });
    }
  });
  const skuRows = await db.insert(skus).values(skuValues).returning();

  const quoteValues: typeof supplierQuotes.$inferInsert[] = [];
  skuRows.forEach((sku, i) => {
    const companySuppliers = supplierRows.filter((s) => s.companyId === sku.companyId);
    const quotesCount = i % 3 === 0 ? 3 : 2;
    for (let q = 0; q < quotesCount; q++) quoteValues.push({
      companyId: sku.companyId, projectId: sku.projectId, skuId: sku.id,
      supplierId: companySuppliers[(i + q) % companySuppliers.length].id,
      unitPriceCents: Math.round(sku.budgetUnitCents * (0.82 + q * 0.08 + (i % 5) * 0.015)), taxIncluded: true,
      taxRateBps: sku.taxRateBps, freightCents: q === 0 ? sku.freightCents : yuan(300 + q * 150),
      installCents: sku.installCents, leadDays: 12 + q * 5 + i % 10, validUntil: dateAt(30 + q * 10),
      paymentTerms: q === 0 ? "30%预付，70%到货" : "50%预付，50%发货", status: q === 0 ? "已选中" : "未选中", createdBy: sku.createdBy,
    });
  });
  const quoteRows = await db.insert(supplierQuotes).values(quoteValues).returning();

  const requestRows: (typeof purchaseRequests.$inferSelect)[] = [];
  for (const [projectIndex, project] of projectRows.entries()) {
    const projectSkus = skuRows.filter((sku) => sku.projectId === project.id);
    for (let i = 0; i < 15; i++) {
      const sku = projectSkus[i];
      const quote = quoteRows.find((row) => row.skuId === sku.id && row.status === "已选中")!;
      const amountCents = quote.unitPriceCents * sku.quantity + quote.freightCents + quote.installCents;
      const status = i % 6 === 0 ? "待审批" : i % 6 === 1 ? "已驳回" : "已通过";
      const [request] = await db.insert(purchaseRequests).values({
        companyId: project.companyId, projectId: project.id, number: `CGSQ-${String(projectIndex * 15 + i + 1).padStart(5, "0")}`,
        supplierId: quote.supplierId, paymentType: i % 5 === 0 ? "批量私账" : "对公", amountCents,
        requestedBy: project.managerId!, status, reason: `${sku.room}${sku.name}采购`, createdBy: project.managerId,
      }).returning();
      requestRows.push(request);
      await db.insert(purchaseRequestItems).values({ requestId: request.id, skuId: sku.id, quoteId: quote.id, quantity: sku.quantity, unitPriceCents: quote.unitPriceCents, amountCents, createdBy: project.managerId });
      if (status !== "待审批") await db.insert(purchaseApprovals).values({
        companyId: project.companyId, projectId: project.id, requestId: request.id, approverId: owner.id,
        decision: status === "已通过" ? "通过" : "驳回", comment: status === "已通过" ? "价格及交期确认，准予下单" : "请补充替代供应商比价",
      });
    }
  }

  const approvedRequests = requestRows.filter((row) => row.status === "已通过");
  const orderRows: (typeof purchaseOrders.$inferSelect)[] = [];
  const payableRows: (typeof payables.$inferSelect)[] = [];
  for (const [i, request] of approvedRequests.entries()) {
    const delivered = i % 4 === 0 ? Math.round(request.amountCents * 0.55) : request.amountCents;
    const [order] = await db.insert(purchaseOrders).values({
      companyId: request.companyId, projectId: request.projectId, requestId: request.id, supplierId: request.supplierId,
      number: `CGDD-${String(i + 1).padStart(5, "0")}`, amountCents: request.amountCents, deliveredCents: delivered,
      status: delivered === request.amountCents ? "已到货" : "部分到货", orderedAt: dateAt(-35 + i % 28), createdBy: owner.id,
    }).returning();
    orderRows.push(order);
    await db.insert(goodsReceipts).values({
      companyId: order.companyId, projectId: order.projectId, purchaseOrderId: order.id, number: `SH-${String(i + 1).padStart(5, "0")}`,
      quantity: 1, amountCents: delivered, destination: "项目直送", receivedAt: dateAt(-20 + i % 18), createdBy: owner.id,
    });
    const [item] = await sqlQuery<{ skuId: number; quantity: number }>(`SELECT sku_id AS "skuId",quantity FROM purchase_request_items WHERE request_id=$1 ORDER BY id LIMIT 1`, [request.id]);
    if (item) {
      const [batch] = await db.insert(inventoryBatches).values({ companyId: order.companyId, projectId: order.projectId, skuId: item.skuId, purchaseOrderId: order.id, batchNumber: `BATCH-${String(i + 1).padStart(5, "0")}`, quantity: item.quantity, remainingQuantity: item.quantity, unitCostCents: Math.round(delivered / item.quantity), status: "在库", createdBy: owner.id }).returning();
      await db.insert(inventoryTransactions).values({ companyId: order.companyId, projectId: order.projectId, batchId: batch.id, type: "采购入库", quantity: item.quantity, amountCents: delivered, happenedAt: dateAt(-20 + i % 18), note: "Seed 到货入库", createdBy: owner.id });
    }
    const [payable] = await db.insert(payables).values({
      companyId: order.companyId, projectId: order.projectId, supplierId: order.supplierId, purchaseOrderId: order.id,
      number: `YF-${String(i + 1).padStart(5, "0")}`, amountCents: order.amountCents, paidCents: 0,
      dueDate: dateAt(-8 + i % 42), paymentNode: i % 3 === 0 ? "预付款" : "到货款", invoiceStatus: i % 4 === 0 ? "已收票" : "欠票",
      status: "待付", createdBy: owner.id,
    }).returning();
    payableRows.push(payable);
  }

  let paymentSequence = 1;
  for (const [i, payable] of payableRows.entries()) {
    const isPending = i % 5 === 0;
    const isApproved = i % 5 === 1;
    const amount = i % 3 === 0 ? Math.round(payable.amountCents * 0.5) : payable.amountCents;
    const [request] = await db.insert(paymentRequests).values({
      companyId: payable.companyId, projectId: payable.projectId, payableId: payable.id,
      number: `FKSQ-${String(i + 1).padStart(5, "0")}`, amountCents: amount,
      accountId: accountRows.find((a) => a.companyId === payable.companyId)!.id, requestedBy: owner.id,
      status: isPending ? "待审批" : isApproved ? "已通过" : "已付款", reason: `${payable.paymentNode}到期付款`, createdBy: owner.id,
    }).returning();
    if (!isPending) {
      await db.insert(paymentApprovals).values({ companyId: payable.companyId, projectId: payable.projectId, paymentRequestId: request.id, approverId: owner.id, decision: "通过", comment: "付款资料完整" });
    }
    if (!isPending && !isApproved) {
      const chunks = i % 2 === 0 ? 2 : 1;
      for (let chunk = 0; chunk < chunks; chunk++) {
        const chunkAmount = chunk === chunks - 1 ? amount - Math.floor(amount / chunks) * (chunks - 1) : Math.floor(amount / chunks);
        await db.insert(payments).values({
          companyId: payable.companyId, projectId: payable.projectId, payableId: payable.id, paymentRequestId: request.id,
          accountId: request.accountId, number: `FK-${String(paymentSequence++).padStart(5, "0")}`,
          amountCents: chunkAmount, paidAt: dateAt(-16 + i % 14 + chunk), method: "对公转账", createdBy: owner.id,
        });
      }
      await sqlQuery("UPDATE payables SET paid_cents = $1, status = CASE WHEN $1 >= amount_cents THEN '已付' ELSE '部分付款' END WHERE id = $2", [amount, payable.id]);
    }
  }

  const returnValues = orderRows.filter((_, i) => i % 11 === 0 && i % 3 === 0).map((order, i) => {
    const payable = payableRows.find((row) => row.purchaseOrderId === order.id)!;
    return {
      companyId: order.companyId, projectId: order.projectId, purchaseOrderId: order.id, payableId: payable.id,
      number: `TH-${String(i + 1).padStart(4, "0")}`, type: "退货", amountCents: Math.round(order.amountCents * 0.12),
      reason: "到货外观与确认样不符", status: "已完成", createdBy: owner.id,
    };
  });
  await db.insert(purchaseReturns).values(returnValues);
  for (const row of returnValues) {
    await sqlQuery("UPDATE purchase_orders SET amount_cents = amount_cents - $1, version = version + 1 WHERE id = $2", [row.amountCents, row.purchaseOrderId]);
    await sqlQuery("UPDATE payables SET amount_cents = amount_cents - $1, version = version + 1, status = CASE WHEN paid_cents >= amount_cents - $1 THEN '已付' ELSE status END WHERE id = $2", [row.amountCents, row.payableId]);
  }

  const invoiceValues: typeof invoices.$inferInsert[] = [];
  orderRows.forEach((order, i) => invoiceValues.push({
    companyId: order.companyId, projectId: order.projectId, supplierId: order.supplierId,
    number: `FP-JX-${String(i + 1).padStart(5, "0")}`, direction: "进项", type: i % 5 === 0 ? "普票" : "专票",
    amountCents: i % 4 === 0 ? order.amountCents : Math.round(order.amountCents * 0.7), issuedAt: dateAt(-22 + i % 20), createdBy: owner.id,
  }));
  projectRows.forEach((project, i) => {
    for (let n = 0; n < 3; n++) invoiceValues.push({
      companyId: project.companyId, projectId: project.id, customerId: project.customerId,
      number: `FP-XX-${String(i * 3 + n + 1).padStart(5, "0")}`, direction: "销项", type: "专票",
      amountCents: Math.round(project.currentContractCents * [0.2, 0.2, 0.15][n]), issuedAt: dateAt(-80 + i * 2 + n * 15), createdBy: owner.id,
    });
  });
  const invoiceRows = await db.insert(invoices).values(invoiceValues).returning();
  for (const invoice of invoiceRows) {
    if (invoice.direction === "进项") {
      const payable = payableRows.find((row) => row.projectId === invoice.projectId && row.supplierId === invoice.supplierId);
      if (payable) await db.insert(invoiceAllocations).values({ companyId: invoice.companyId, projectId: invoice.projectId, invoiceId: invoice.id, payableId: payable.id, amountCents: Math.min(invoice.amountCents, payable.amountCents), createdBy: owner.id });
    } else {
      const plan = planRows.find((row) => row.projectId === invoice.projectId && !row.isWarranty);
      if (plan) await db.insert(invoiceAllocations).values({ companyId: invoice.companyId, projectId: invoice.projectId, invoiceId: invoice.id, receivablePlanId: plan.id, amountCents: Math.min(invoice.amountCents, plan.amountCents), createdBy: owner.id });
    }
  }

  const logValues: typeof auditLogs.$inferInsert[] = [];
  projectRows.forEach((project) => logValues.push({ companyId: project.companyId, projectId: project.id, userId: project.managerId, objectType: "project", objectId: project.id, action: "CREATE", after: { code: project.code, name: project.name, status: project.status }, ip: "127.0.0.1" }));
  requestRows.forEach((request) => logValues.push({ companyId: request.companyId, projectId: request.projectId, userId: request.requestedBy, objectType: "purchase_request", objectId: request.id, action: request.status === "待审批" ? "SUBMIT" : "APPROVE", after: { number: request.number, status: request.status, amountCents: request.amountCents }, ip: "127.0.0.1" }));
  await db.insert(auditLogs).values(logValues);

  const summary = await Promise.all(["users", "customers", "suppliers", "projects", "skus", "supplier_quotes", "purchase_requests", "purchase_orders", "payables", "payments", "receipts", "invoices"].map(async (table) => {
    const [row] = await sqlQuery<{ count: number }>(`SELECT count(*)::int AS count FROM ${table}`);
    return `${table}: ${row.count}`;
  }));
  console.log(`Seed complete\n${summary.join("\n")}`);
}

seed().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
