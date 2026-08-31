"use client";

import { useActionState } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { loginAction } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, { error: "" });
  return (
    <form className="login-form" action={action}>
      <h2>登录工作台</h2>
      <p>使用企业账号进入对应的数据范围</p>
      <div className="field"><label htmlFor="email">邮箱</label><input className="input" id="email" name="email" type="email" defaultValue="owner@zhiheng.local" autoComplete="username" required /></div>
      <div className="field"><label htmlFor="password">密码</label><input className="input" id="password" name="password" type="password" defaultValue="Demo@2026" autoComplete="current-password" required /></div>
      {state.error ? <div className="form-error">{state.error}</div> : null}
      <button className="button primary" type="submit" disabled={pending}>{pending ? <LoaderCircle className="animate-spin" /> : <ArrowRight />}{pending ? "正在验证" : "进入系统"}</button>
      <div className="demo-account"><strong>试用账号</strong><br />老板：owner@zhiheng.local<br />密码：Demo@2026<br />其他角色账号可在登录后从“用户与角色”中查看。</div>
    </form>
  );
}
