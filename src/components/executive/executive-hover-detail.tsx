export function ExecutiveHoverDetail({ id, title = "经营细分", items }: { id: string; title?: string; items: string[] }) {
  return <div className="executive-hover-detail" id={id} role="tooltip">
    <strong>{title}</strong>
    <div>{items.length ? items.slice(0, 5).map((item, index) => <span key={`${item}-${index}`}><i aria-hidden="true" />{item}</span>) : <span><i aria-hidden="true" />暂无需要展开的异常明细</span>}</div>
  </div>;
}
