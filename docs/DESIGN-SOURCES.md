# ZHIHENG Design Sources

## Upstream

- Repository: `VoltAgent/awesome-design-md`
- Upstream ref: `main`
- Pinned commit: `8147538b4226ae41e2487a9179e3bcc1f68e8554`
- Commit date: `2026-07-31T12:32:38Z`
- License: MIT，已保存在 `docs/design-references/awesome-design-md/UPSTREAM-LICENSE`
- Integration mode: 仅作为 Design Reference Dataset；不是 npm 依赖，不在运行时联网读取，不直接驱动组件。

Vendored 文本保持上游内容，仓库写入时统一补齐最终 LF。根目录 `DESIGN.md` 是织衡唯一设计规则源，`MOTION.md` 是唯一动效规则源。

## Reference Map

| Reference | Vendored path | Upstream blob | Borrow | Explicitly do not borrow |
| --- | --- | --- | --- | --- |
| Cohere | `docs/design-references/awesome-design-md/cohere/DESIGN.md` | `cc8bdf0482e7609c93a35d9b4526293d575dde8d` | Enterprise AI、Deep Green、Command Center、Dark Intelligence Surface、technical restraint | 超大营销标题、Landing Page 布局、品牌蓝与 Coral taxonomy |
| Mastercard | `docs/design-references/awesome-design-md/mastercard/DESIGN.md` | `8087e66a902ea478f73cf9902a258a639b3311a2` | 暖金融感、Editorial Cream、Orbit / trajectory、Premium warmth、克制的视觉移动 | 品牌橙、过度 Pill、超大圆角、大规模圆形营销图片 |
| Linear | `docs/design-references/awesome-design-md/linear.app/DESIGN.md` | `88bcd11faa4f050982c7e84ca70bdf43d660ed6a` | Software precision、Hairline、受控高密度、Floating UI、Dark hierarchy、细致交互 | Lavender 品牌色、全黑 Dark Mode、Marketing SaaS Hero |
| Revolut | `docs/design-references/awesome-design-md/revolut/DESIGN.md` | `23b014f45600f1d852dc1c8bbca5c144255ddde4` | Fintech 数字层级、强 light/dark 对比、清洁现代的数据表达 | 消费金融多彩 palette、高饱和产品色、纯黑大面积背景、Pill everywhere |

## Principle Reference

Apple 只作为 restraint、focus、visual subtraction 三项原则参考，不 vendoring 品牌资产，不复制字体、控件、布局或视觉标识。

## Synthesis Boundary

织衡最终语言由 Deep Forest 身份、Technical Teal 交互、Living Teal 在线状态、Champagne Executive 高光、Warm Mineral Canvas 与财务语义色共同构成。任何实现若第一眼可被识别为上述某个参考品牌，应继续做减法和语义校正，直到结果明确属于 ZHIHENG。
