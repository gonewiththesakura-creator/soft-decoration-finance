# ZHIHENG MOTION SYSTEM

Version: 1.0

Status: Motion Source of Truth

## 1. Governance

本文件与 `DESIGN.md` 共同约束织衡界面。任何 Agent 不得为了通过当前验收而降低动效标准；需要修改时必须先提交 **Design System Change Proposal** 并等待人工确认。

动效的职责只有三类：解释层级、反馈交互、表达真实的系统运行状态。动效不能创造业务事实，也不能让用户误判审批、付款、回款、风险或 AI 状态。

## 2. Motion Principles

- Quiet：没有闪烁、弹跳、弹性过冲或游戏化反馈。
- Legible：动画前后信息层级一致，不隐藏关键数字。
- Sparse：同一视口只允许少数明确主动态。
- Asynchronous：持续动效错峰，不同步闪烁。
- Efficient：优先 `transform`、`opacity`、SVG `stop-opacity` 和低频 dash offset。

Dashboard 持续主生命核心严格限定为 Executive Pulse、Cashflow Pulse、Global AI Orb。Mesh、光场和 Flow 只能是低强度 Secondary Ambient；普通 Card、Table、KPI、Donut 和按钮不得持续呼吸。

## 3. Motion Tokens

| Token | Duration | Easing | Use |
| --- | --- | --- | --- |
| Hover | 150ms | ease-out | 颜色、边线、轻位移 |
| Tooltip | 150ms | ease-out | opacity + 4-6px 位移 |
| Page Entrance | 240ms | emphasized ease-out | 首次内容进入 |
| Drawer / Window | 240ms | emphasized ease-out | Drawer、AI 浮窗 |
| Chart Entrance | 640-780ms | ease-out | 首次绘制 |
| Scroll Reveal | 360-520ms | ease-out | 一次性区块揭示 |

列表可按 55ms 错峰进入，最大累计延迟 330ms。用户连续操作时不得排队播放旧动画。

## 4. Idle Motion

Idle Motion 只在页面静置时表达“系统正在运行”。观察 3-6 秒应能感知核心呼吸，但第一眼不能觉得背景动画很多。用户开始输入、拖动、打开 Modal 或启用 Reduced Motion 时，装饰动效不应争夺注意力。

## 5. Executive Pulse

Executive Pulse 是 Dashboard 的主要生命核心：

- Inner Core：`scale(.985 -> 1.025 -> .985)`，5.2s，ease-in-out。
- Ambient Glow：`opacity(.16 -> .34 -> .16)`，5.2s。
- Ring A：`scale(.96 -> 1.22)`、`opacity(.30 -> 0)`，5.2s，ease-out。
- Ring B：与 Ring A 相同，延迟 2.6s。

状态颜色来自现有真实规则。视觉应像金融系统心跳，不能像游戏技能、雷达告警或霓虹能量球。

## 6. Global AI Orb

Global AI Orb 持续表达可用性：

- Core：`scale(.98 -> 1.04 -> .98)`，4.6s。
- Halo A/B：`scale(.92 -> 1.28)`、`opacity(.32 -> 0)`，4.6s；B 延迟 2.3s。
- Ambient Glow：`opacity(.20 -> .38 -> .20)`，4.6s。
- Thinking：周期可缩短到 3.2s，不用覆盖整个 Orb 的 Spinner。
- Warning / Error：使用低饱和 Amber，禁止持续红色闪烁。

Hover / Focus 暂停 Core 呼吸并稳定放大到 1.04，Glow 轻微增强。点击后浮窗以 opacity + 轻微 Y/scale 进入，不使用 Backdrop。

## 7. Ambient Motion

Dashboard Mesh / Light Field 周期 28-42s，位移小于自身尺寸的 10%，峰值 opacity 保持低饱和。Hero Flow 可用 18-24s 的 dash offset。员工业务页保持静态 Canvas，不启用 Ambient Drift。

Ambient 永远位于内容之下、`pointer-events: none`，不能降低文字对比度或触发布局重排。

## 8. Chart Motion

- Entrance：Recharts 首次绘制 640-780ms；路由内普通筛选不重复戏剧性进入。
- Cashflow Living Area：只改渐变 `stop-opacity(.18 -> .30 -> .18)`，7-9s。
- Today / First Risk Point：Ring 周期 3.8-4.5s，不改变折线坐标。
- Hover：只突出当前数据、弱化同组数据，150ms。
- Donut / 普通 Bar / 普通 KPI：无持续呼吸。

## 9. Hover, Tooltip And Focus

Hover 使用边线、背景 tint、图标亮度与最多 1-3px 位移。Tooltip 150ms 进入，稳定尺寸，不遮挡触发项。Focus Visible 与 Hover 信息等价，不能把业务说明只放在鼠标 Hover。

## 10. Drawer, Window And Modal

Drawer / AI Window 为 240ms emphasized ease-out。非模态 AI 浮窗不使用 Backdrop；业务 Modal 可使用静态低透明遮罩。关闭后焦点必须归还触发项，打开后焦点进入第一个有效控件或输入框。

## 11. Scroll Reveal

Scroll Reveal 每个元素只播放一次，位移 6-10px，持续 360-520ms。禁止持续 `requestAnimationFrame` 轮询；使用 IntersectionObserver 或 CSS。首屏内容不能因 reveal 长时间不可见。

## 12. Reduced Motion

`prefers-reduced-motion: reduce` 必须关闭 Executive Pulse、AI Orb Ring、Ambient Drift、Flow、Chart Living State、Scroll Reveal、平滑滚动和非必要过渡。保留静态 Glow、状态颜色、图表数值、Tooltip 内容和全部业务操作。

Reduced Motion 不是隐藏元素或移除反馈；Focus、Loading 文案、状态文本仍须完整。

## 13. Performance

- 禁止为装饰引入 Three.js、WebGL、粒子系统、高频 mousemove 或持续 JavaScript rAF。
- 动画不改变布局属性，不持续改变大面积 blur/filter。
- 同一视口不超过 3 个明显持续脉冲主体。
- 动画组件必须有稳定尺寸；Loading、Hover、状态切换不能造成布局跳动。

## 14. Verification Gate

Dashboard 静置观察 10 秒：Executive Pulse 至少 1 次、AI Orb 至少 2 次、Cashflow 有轻微 Living State、环境光场有缓慢变化，但不能出现第 4 个主要脉冲主体。另需检查 1440x900、1920x1080、390x844 和 Reduced Motion 静态状态。
