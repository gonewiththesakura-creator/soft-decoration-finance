"use client";

import { useEffect, useState } from "react";
import { Check, ExternalLink, LoaderCircle, Upload, X } from "lucide-react";
import { AttachmentPanel } from "@/components/attachment-panel";
import { formatDate, formatMoney } from "@/lib/format";

type Detail = { header: Record<string, unknown>; items?: Record<string, unknown>[]; quotes?: Record<string, unknown>[]; approvals: Record<string, unknown>[] };

function Fact({ label, value, money = false }: { label: string; value: unknown; money?: boolean }) {
  return <div className="approval-fact"><span>{label}</span><strong>{money ? formatMoney(Number(value ?? 0)) : String(value ?? "-")}</strong></div>;
}

export function ApprovalDetail({ type, id, role, onClose, onDone }: { type: "purchase" | "payment"; id: number; role: string; onClose: () => void; onDone: (message: string) => void }) {
  const [detail, setDetail] = useState<Detail | null>(null); const [error, setError] = useState(""); const [comment, setComment] = useState(""); const [bankReceiptFile, setBankReceiptFile] = useState<File | null>(null); const [pending, setPending] = useState(false);
  useEffect(() => {
    let active = true;
    fetch(`/api/workflows/${type}/${id}`).then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "加载审批详情失败"); if (active) setDetail(data); }).catch((reason) => active && setError(reason instanceof Error ? reason.message : "加载失败"));
    return () => { active = false; };
  }, [id, type]);
  async function act(action: "approve" | "reject" | "pay") {
    if (action !== "pay" && !comment.trim()) { setError("请填写审批意见"); return; } if (action === "pay" && !bankReceiptFile) { setError("请上传银行回单或电子凭证"); return; }
    setPending(true); setError("");
    let bankReceiptUrl = "";
    if (action === "pay" && bankReceiptFile) {
      const upload = new FormData(); upload.set("objectType", "payment_request"); upload.set("objectId", String(id)); upload.set("category", "银行回单"); upload.set("file", bankReceiptFile);
      const uploadResponse = await fetch("/api/attachments", { method: "POST", body: upload }); const uploadData = await uploadResponse.json();
      if (!uploadResponse.ok) { setPending(false); setError(uploadData.error ?? "银行回单上传失败"); return; }
      bankReceiptUrl = String(uploadData.url);
    }
    const response = await fetch(`/api/workflows/${type}/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action === "pay" ? { action, bankReceiptUrl } : { decision: action, comment }) });
    const data = await response.json(); setPending(false); if (!response.ok) { setError(data.error ?? "操作失败"); return; }
    onDone(action === "pay" ? "付款已由财务执行" : action === "approve" ? "审批已通过" : "申请已驳回");
  }
  const header = detail?.header; const canApprove = role === "owner" && header?.status === "待审批"; const canPay = type === "payment" && role === "finance" && header?.status === "已通过" && Number(header.remainingAfterCents) >= 0;
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal approval-modal" aria-label={type === "purchase" ? "采购审批详情" : "付款审批详情"}>
    <div className="modal-header"><div><div className="modal-title">{type === "purchase" ? "采购审批详情" : "付款审批详情"}</div><div className="panel-subtitle">确认完整业务信息后再处理</div></div><button className="icon-plain" onClick={onClose} aria-label="关闭"><X /></button></div>
    {!detail && !error ? <div className="approval-loading"><LoaderCircle className="animate-spin" />正在加载详情</div> : null}{error ? <div className="form-error approval-error">{error}</div> : null}
    {header ? <div className="approval-body"><section><h3>申请概况</h3><div className="approval-facts">{type === "purchase" ? <><Fact label="公司" value={header.companyName} /><Fact label="项目" value={header.projectName} /><Fact label="供应商" value={header.supplierName} /><Fact label="申请人" value={header.requesterName} /><Fact label="付款类型" value={header.paymentType} /><Fact label="总金额" value={header.amountCents} money /><Fact label="申请说明" value={header.reason} /><Fact label="当前状态" value={header.status} /></> : <><Fact label="项目" value={header.projectName} /><Fact label="供应商" value={header.supplierName} /><Fact label="采购单" value={header.orderNumber} /><Fact label="应付编号" value={header.payableNumber} /><Fact label="应付总额" value={header.payableAmountCents} money /><Fact label="已付款" value={header.paidCents} money /><Fact label="本次申请" value={header.requestAmountCents} money /><Fact label="付款后剩余应付" value={header.remainingAfterCents} money /><Fact label="发票状态" value={header.invoiceStatus} /><Fact label="欠票金额" value={header.missingInvoiceCents} money /><Fact label="付款账户" value={header.accountName} /><Fact label="当前账户余额" value={header.accountBalanceCents} money /><Fact label="付款后预计余额" value={header.accountBalanceAfterCents} money /><Fact label="申请原因" value={header.reason} /></>}</div>{header.attachmentUrl ? <a className="approval-link" href={String(header.attachmentUrl)} target="_blank" rel="noreferrer"><ExternalLink />查看申请附件</a> : type === "purchase" ? <div className="approval-empty-note">申请附件：未上传</div> : null}</section>
      {type === "purchase" && detail?.items?.length ? <section><h3>SKU 清单</h3><div className="table-scroll"><table className="data-table"><thead><tr><th>SKU</th><th>产品</th><th>图片</th><th className="right">数量</th><th className="right">预算单价</th><th className="right">最终单价</th><th className="right">超预算</th><th className="right">小计</th></tr></thead><tbody>{detail.items.map((item) => <tr key={String(item.id)}><td>{String(item.skuCode)}</td><td>{String(item.skuName)}</td><td>{item.imageUrl ? <a href={String(item.imageUrl)} target="_blank" rel="noreferrer">查看</a> : "未上传"}</td><td className="right">{Number(item.quantity).toLocaleString("zh-CN", { maximumFractionDigits: 4 })} {String(item.unit)}</td><td className="right">{formatMoney(Number(item.budgetUnitCents))}</td><td className="right">{formatMoney(Number(item.finalUnitCents))}</td><td className="right">{formatMoney(Number(item.overBudgetCents))} / {String(item.overBudgetPercent)}%</td><td className="right">{formatMoney(Number(item.itemAmountCents))}</td></tr>)}</tbody></table></div></section> : null}
      {type === "purchase" && detail?.quotes?.length ? <section><h3>供应商比价</h3><div className="table-scroll"><table className="data-table"><thead><tr><th>供应商</th><th className="right">报价</th><th className="right">运费</th><th className="right">安装费</th><th>税率</th><th>付款条件</th><th>交期</th><th>附件</th></tr></thead><tbody>{detail.quotes.map((quote, index) => <tr key={index}><td>{String(quote.supplierName)}</td><td className="right">{formatMoney(Number(quote.unitPriceCents))}</td><td className="right">{formatMoney(Number(quote.freightCents))}</td><td className="right">{formatMoney(Number(quote.installCents))}</td><td>{Number(quote.taxRateBps) / 100}%</td><td>{String(quote.paymentTerms ?? "-")}</td><td>{String(quote.leadDays)} 天</td><td>{quote.attachmentUrl ? <a href={String(quote.attachmentUrl)} target="_blank" rel="noreferrer">查看</a> : "-"}</td></tr>)}</tbody></table></div></section> : null}
      {type === "purchase" ? <AttachmentPanel objectType="purchase_request" objectId={id} canUpload={false} title="申请附件" /> : null}
      <section><h3>历史审批</h3>{detail?.approvals.length ? <div className="approval-history">{detail.approvals.map((approval, index) => <div key={index}><strong>{String(approval.decision)}</strong><span>{String(approval.approverName)} · {formatDate(String(approval.decidedAt))}</span><p>{String(approval.comment || "无意见")}</p></div>)}</div> : <div className="approval-empty-note">暂无历史审批</div>}</section>{canApprove ? <section><h3>审批意见</h3><textarea className="input approval-comment" value={comment} onChange={(event) => setComment(event.target.value)} placeholder="填写核价、预算、交期或付款风险判断" /></section> : null}{canPay ? <section><h3>付款回单</h3><label className="payment-upload"><Upload /><span>{bankReceiptFile ? bankReceiptFile.name : "选择银行回单或电子凭证"}</span><input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={(event) => setBankReceiptFile(event.target.files?.[0] ?? null)} /></label></section> : null}</div> : null}
    <div className="modal-footer"><button className="button" onClick={onClose}>关闭</button>{canApprove ? <><button className="button danger" disabled={pending} onClick={() => act("reject")}><X />驳回</button><button className="button primary" disabled={pending} onClick={() => act("approve")}><Check />批准</button></> : null}{canPay ? <button className="button primary" disabled={pending} onClick={() => act("pay")}><Check />财务执行付款</button> : null}</div>
  </section></div>;
}
