export const attachmentCategories = ["合同", "报价单", "产品图片", "采购附件", "银行回单", "发票", "收款凭证", "退换货凭证", "其他"] as const;
export type AttachmentCategory = typeof attachmentCategories[number];
