"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Eye, File, FileImage, LoaderCircle, Paperclip, Trash2, Upload } from "lucide-react";
import { attachmentCategories } from "@/lib/attachment-types";
import { formatDate } from "@/lib/format";

type Attachment = { id: number; category: string; originalFilename: string; mimeType: string; fileSize: number; url: string; uploaderName: string; createdAt: string };

function formatSize(size: number) { return size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`; }

export function AttachmentPanel({ objectType, objectId, canUpload, defaultCategory = "其他", title = "附件" }: { objectType: string; objectId: number; canUpload: boolean; defaultCategory?: string; title?: string }) {
  const [items, setItems] = useState<Attachment[]>([]); const [category, setCategory] = useState(defaultCategory); const [error, setError] = useState(""); const [loading, setLoading] = useState(true); const [uploading, setUploading] = useState(false); const [dragging, setDragging] = useState(false); const inputRef = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => { setLoading(true); const response = await fetch(`/api/attachments?objectType=${encodeURIComponent(objectType)}&objectId=${objectId}`); const data = await response.json(); setLoading(false); if (!response.ok) setError(data.error ?? "附件加载失败"); else { setItems(data.attachments); setError(""); } }, [objectId, objectType]);
  useEffect(() => { void load(); }, [load]);
  async function uploadFile(file: File) {
    setUploading(true); setError(""); const body = new FormData(); body.set("objectType", objectType); body.set("objectId", String(objectId)); body.set("category", category); body.set("file", file);
    const response = await fetch("/api/attachments", { method: "POST", body }); const data = await response.json(); setUploading(false);
    if (!response.ok) { setError(data.error ?? "附件上传失败"); return; } if (inputRef.current) inputRef.current.value = ""; await load();
  }
  async function voidItem(item: Attachment) {
    const reason = window.prompt(`请输入“${item.originalFilename}”的作废原因`); if (!reason?.trim()) return;
    const response = await fetch(`/api/attachments/${item.id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) }); const data = await response.json(); if (!response.ok) { setError(data.error ?? "附件作废失败"); return; } await load();
  }
  return <section className="attachment-panel"><div className="panel-header"><div><div className="panel-title">{title}</div><div className="panel-subtitle">{items.length} 个有效文件</div></div>{canUpload ? <div className="attachment-upload-actions"><select className="input compact" value={category} onChange={(event) => setCategory(event.target.value)} aria-label="附件分类">{attachmentCategories.map((value) => <option value={value} key={value}>{value}</option>)}</select><input ref={inputRef} hidden type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.docx" onChange={(event) => event.target.files?.[0] && void uploadFile(event.target.files[0])} /><button className="button primary" disabled={uploading} onClick={() => inputRef.current?.click()}>{uploading ? <LoaderCircle className="animate-spin" /> : <Upload />}上传附件</button></div> : null}</div>
    {canUpload ? <button type="button" className={`attachment-dropzone ${dragging ? "dragging" : ""}`} onClick={() => inputRef.current?.click()} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files[0]; if (file) void uploadFile(file); }}><Paperclip /><span>拖放文件或点击选择</span><small>PDF · JPG · PNG · WebP · XLSX · DOCX，最大 10 MB</small></button> : null}
    {error ? <div className="form-error attachment-error">{error}</div> : null}
    {loading ? <div className="attachment-empty"><LoaderCircle className="animate-spin" />加载中</div> : items.length ? <div className="attachment-list">{items.map((item) => <div className="attachment-item" key={item.id}><div className="attachment-icon">{item.mimeType.startsWith("image/") ? <FileImage /> : <File />}</div><div className="attachment-info"><strong>{item.originalFilename}</strong><span>{item.category} · {formatSize(item.fileSize)} · {item.uploaderName} · {formatDate(item.createdAt)}</span></div><div className="attachment-actions"><a className="icon-plain" href={item.url} target="_blank" rel="noreferrer" aria-label="预览附件" title="预览附件"><Eye /></a><a className="icon-plain" href={`${item.url}?download=1`} aria-label="下载附件" title="下载附件"><Download /></a>{canUpload ? <button className="icon-plain danger-text" onClick={() => void voidItem(item)} aria-label="作废附件" title="作废附件"><Trash2 /></button> : null}</div></div>)}</div> : <div className="attachment-empty"><Paperclip />暂无附件</div>}
  </section>;
}
