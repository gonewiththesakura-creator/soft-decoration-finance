import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  if (await getSession()) redirect("/dashboard");
  return (
    <main className="login-page">
      <section className="login-context">
        <div className="login-brand"><div className="brand-mark">衡</div><div><div className="brand-title">织衡经营财务</div><div className="brand-sub">SOFT FURNISHING OPERATIONS</div></div></div>
        <div className="login-story"><h1>把每个项目的<br />钱与货，看清楚。</h1><p>合同、采购、应收、应付、付款和发票围绕项目形成一套可追溯的经营账，让每天的决策建立在同一份数据上。</p></div>
        <div className="login-facts"><div className="login-fact"><strong>3</strong><span>独立核算公司</span></div><div className="login-fact"><strong>30 天</strong><span>现金流前瞻</span></div><div className="login-fact"><strong>SKU</strong><span>采购成本颗粒度</span></div></div>
      </section>
      <section className="login-form-wrap"><LoginForm /></section>
    </main>
  );
}
