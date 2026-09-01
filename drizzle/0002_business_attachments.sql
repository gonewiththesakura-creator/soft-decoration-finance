-- Attachment references used by approval evidence and bank receipt records.
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS attachment_url text;
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS bank_receipt_url text;
ALTER TABLE skus ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE supplier_quotes ADD COLUMN IF NOT EXISTS attachment_url text;
ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS attachment_url text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS bank_receipt_url text;
