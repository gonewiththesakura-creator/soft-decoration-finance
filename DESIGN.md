# ZHIHENG DESIGN SYSTEM

Version: 2.0

Status: Single Source of Truth

Positioning: Premium AI Business Operating System / 高级 AI 经营操作系统

## 1. Governance

本文件是织衡产品视觉设计的唯一规则源。`docs/design-references/` 只保存参考数据，不能直接驱动组件实现；具体来源与取舍见 `docs/DESIGN-SOURCES.md`。动效规则由根目录 `MOTION.md` 管理。

任何 Agent 不得为了让当前代码“符合验收”而修改、删除或降低 `DESIGN.md` / `MOTION.md` 的标准。确需修改时，必须先提交 **Design System Change Proposal**，说明问题、影响范围、拟议规则和迁移成本，并等待人工确认。

## 2. Product Character

织衡应同时传达 Enterprise AI、Financial Intelligence、Quiet Technology、Warm Precision 与 Living Data。第一眼是精确而安静的经营系统，第二眼能感知 AI 与经营数据正在运行。

织衡不是传统 ERP、网页 Excel、Admin Template、科技大屏、Cyberpunk、消费金融 App 或 Marketing Landing Page。视觉不复制 Cohere、Mastercard、Linear、Revolut 或 Apple 的品牌特征。

## 3. Color System

### Foundation

| Token | Value | Role |
| --- | --- | --- |
| Mineral Canvas | `#F2F3EF` | 默认页面底层 |
| Warm Canvas | `#F6F5F1` | 暖色开放区域 |
| Elevated Surface | `#FBFCFA` | 内容、表单、明细表面 |

### Ink

| Token | Value | Role |
| --- | --- | --- |
| Primary Ink | `#151D1A` | 标题、关键数字 |
| Secondary Ink | `#35413D` | 正文、表格 |
| Muted | `#727C77` | 元数据、说明 |

### Brand And Intelligence

| Token | Value | Role |
| --- | --- | --- |
| Forest Core | `#103B33` | 品牌、主要控制、余额 |
| Deep Intelligence | `#0B2924` | AI、深色智能表面 |
| Technical Teal | `#357E70` | 技术、交互、预测 |
| Living Teal | `#67AD9A` | AI Online、Pulse、活跃数据 |
| Champagne | `#C6A66C` | Executive、重要高光 |
| Soft Gold | `#DBC594` | 克制的暖色强调 |

### Semantic

| Token | Value | Role |
| --- | --- | --- |
| Receivable | `#3E806B` | 应收、回款、正向 |
| Payable | `#B9803B` | 应付、等待、提醒 |
| Risk | `#B4574A` | 风险、逾期、缺口 |
| Budget | `#8F918B` | 预算、基线、弱化 |

### Dark And Hairline

| Token | Value | Role |
| --- | --- | --- |
| Dark 0 | `#0B1F1B` | 最深品牌背景 |
| Dark 1 | `#102A24` | Sidebar / Intelligence |
| Dark 2 | `#17372F` | 深色抬升层 |
| Hairline Light | `#DCDDDA` | 浅色分隔 |
| Hairline Dark | `rgba(255,255,255,.10)` | 深色分隔 |

Forest 表达身份与主控制，Technical Teal 表达技术与交互，Living Teal 表达在线与活跃，Champagne 表达重要但非风险的高光，Risk 只表达真实风险。禁止 AI Purple、Neon Blue、Rainbow，以及全局使用纯黑或纯白。

## 4. Surface System

| Level | Name | Treatment | Use |
| --- | --- | --- | --- |
| 0 | Canvas | Mineral / Warm 微弱明度变化 | 页面底层与开放空间 |
| 1 | Base Surface | `#F6F5F1` 或透明暖色层 | 工具带、分组背景 |
| 2 | Elevated Surface | `#FBFCFA` + Hairline | 独立业务对象、表单、分析面板 |
| 3 | Intelligence Surface | Deep Intelligence / Dark 2 | AI、经营指挥、关键行动 |
| 4 | Floating Surface | Elevated 或 Intelligence + 精确阴影 | AI 浮窗、Modal、Tooltip |

层级主要依靠明度、边线和留白，不依靠 Shadow everywhere。Card 只用于独立对象、重复项目、Modal 或真正需要边界的工具；禁止 Card 套 Card。普通业务 Surface 圆角 8-10px，Executive / Floating 12-16px，小标签 4-6px。

## 5. Typography And Numbers

中文与 UI 使用 `PingFang SC`, `Microsoft YaHei`, `Noto Sans CJK SC`, `system-ui`, `sans-serif`。不加载参考品牌的专有字体。宋体气质只允许用于极少量 Executive 经营结论；Mono 只用于技术 ID、代码和 AI Tool 元数据。

| Role | Size | Weight | Notes |
| --- | --- | --- | --- |
| Page Heading | 22-26px | 680-720 | 紧凑、非营销式 |
| Section Heading | 14-17px | 650-700 | 分析模块标题 |
| Body | 12-14px | 400-500 | 高密度但可读 |
| Caption | 10-11px | 450-600 | 元数据与范围 |
| Executive Metric | 28-34px | 650-720 | 只用于核心经营数字 |
| Major Finance | 20-26px | 620-700 | 资金、应收、应付 |
| Table Number | 12-14px | 550-650 | 与表格行高匹配 |

所有金额、比例和日期使用正常 Sans 与 `font-variant-numeric: tabular-nums`。全系统 letter-spacing 为 0，不用负字距。

## 6. Navigation

Sidebar 是 Dark Mineral Forest，而不是传统 ERP 的整块深绿。背景使用 `#0B211C` 到 `#102D27` 的低对比纵向变化，并叠加极轻 Teal luminance。默认导航低对比；Hover 使用 Technical Teal Tint；Active 使用轻表面、左侧信号、图标亮度和 Hairline Glow，禁止大面积亮色块。

品牌区保持“衡”字标识，但使用 Dark Glass、Technical Teal 与 Champagne Hairline 增加精密度。Topbar 使用 Warm Mineral Glass：半透明暖矿物表面、18px blur 和 1px premium hairline，不使用强阴影。

## 7. Controls

- Primary Button：Forest Core，白色标签，承担明确提交或创建。
- Secondary Button：Mineral / Elevated Surface，Primary Ink，Hairline 边框。
- AI Button：Deep Intelligence 或 Technical Teal，只用于 AI 行为。
- Danger Button：Risk Tint + Risk 文本，实心 Risk 只用于高确定性破坏操作。
- Input：Elevated Surface，Technical Teal Focus Hairline 与柔和 Ring。
- Badge：低饱和 Tint Background + Strong Text；禁止大量彩色实心 Badge。
- Icon Button：稳定方形尺寸，Lucide 图标，可访问名称和 Tooltip。

按钮不全部同样沉重。熟悉的单一工具动作优先图标按钮；明确业务命令使用图标加文字。输入、按钮与动态文本不得改变布局尺寸。

## 8. Tables And Charts

Table 是高密度执行工具，不做 Card Table。Header 使用 Mineral Surface，行分隔使用 Hairline，Hover 使用 Technical Tint，Selected 使用 Teal Signal。表格数字为 12-14px Sans Tabular。

图表语义固定：Balance = Forest Core，Receivable = Receivable Green，Payable = Amber，Risk = Brick，Forecast = Technical Teal，Secondary = Sage，Premium Highlight = Champagne。禁止 Rainbow。

Cashflow 使用 Financial Intelligence Surface；Project Health 使用 Light Analytical Surface；Donut 可使用 Open Surface。图表必须有真实查询数据、稳定尺寸、Tooltip、空状态、文字图例、Drill-down 与 Reduced Motion。

## 9. Dashboard And AI

Dashboard Hero 是 Dark Intelligence Field，不是普通深绿 Card。它可以包含低浓度 Deep Forest、Technical Teal、Champagne Light、Mesh、Flow 和 Executive Pulse，但不增加新动画。KPI 分为 Primary、Secondary 与 Risk 层级，避免六张同构白卡。

Executive Pulse 是 Financial System Heartbeat：保留真实状态逻辑，使用 Forest Core、Living Teal 与 Champagne，禁止游戏技能图标感。

Global AI Orb 使用 Deep Intelligence 与 Living Teal，可有极少 Champagne 高光。Floating AI Window 使用 Dark Intelligence Header、Mineral Body 与 Technical Hairline，保持非模态、精确、克制，不模仿通用聊天产品。

## 10. Responsive And Accessibility

设计基线：Desktop 1440x900 / 1920x1080，Mobile 390x844。桌面保持高信息密度；移动端调整为单列或水平滚动工具，不裁切长文本、不产生页面横向溢出。交互不只依赖颜色或 Hover，Focus Visible 必须清晰，所有状态包含文字或数值表达。

## 11. Anti-Patterns

- 不做 KPI Card 海、Card 套 Card、Shadow everywhere 或所有页面同构。
- 不做 Landing Page Hero、科技大屏、Cyberpunk、紫蓝 AI 渐变或消费金融彩虹色。
- 不把所有金额设成 Monospace，不用负字距，不用装饰性超大标题。
- 不用颜色替代状态文字，不硬编码图表数据，不绕过 RBAC 和公司/项目范围。
- 不为美观创造业务状态，不让 Hover、Loading 或动态内容造成布局跳动。

## 12. Delivery Gate

任何全局视觉改动必须检查 Dashboard、Project、Finance、Procurement、AI 与 Mobile。工程侧可记录 `Implementation QA complete`；最终视觉验收只由用户决定，禁止自行声明 `Visual Acceptance Passed`。
