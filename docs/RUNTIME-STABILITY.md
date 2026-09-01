# Windows 运行稳定性

## 统一环境

- Node.js：22.x；`.nvmrc`、`package.json#engines`、README、CI 和部署文档保持一致。
- Next.js：`15.5.24`。
- React / ReactDOM：`19.2.8`。
- 以上核心运行依赖使用精确版本，`npm ci` 必须以仓库 `package-lock.json` 为准。

不要在旧 `.next` 上切换 Next.js 版本。出现 chunk 缺失、`webpack-runtime.js` 错误、HTML 有内容但 CSS 丢失或静态资源 404 时，先停止应用，再执行：

```powershell
npm run dev:clean
```

`npm run clean` 只解析并删除仓库根目录的真实 `.next` 目录；目标不是 `.next` 或目标为符号链接时会拒绝执行，不会触碰数据库、上传附件或源码。

## 标准安装与验证

在全新的 Windows 空目录执行：

```powershell
git clone https://github.com/gonewiththesakura-creator/soft-decoration-finance.git
Set-Location soft-decoration-finance
npm ci
Copy-Item .env.example .env.local
npm run db:seed
npm run typecheck
npm run lint
npm test
npm run clean
npm run build
npm run dev -- -p 3001
```

浏览器依次访问 `/login`、`/dashboard`、`/projects`、`/procurement-workspace`、`/finance-workspace` 和 `/imports`，检查 CSS、JS chunk、控制台运行错误和静态资源 404。

## 启停规则

必须使用 `npm run dev` 或 `npm start`。`scripts/run-app.mjs` 会检查并启动唯一的本地 PGlite 服务，Next 进程退出时关闭由自己创建的数据库进程。不要直接运行 `next dev`，也不要用第二个 PGlite 进程打开同一数据目录。

连续启停检查建议使用独立端口和独立临时 `PGLITE_DATA_DIR`。每次等待 `/login` 返回 200 后正常终止应用，再进行下一轮；至少完成 5 轮。

## 故障定位

1. 确认 `node --version` 为 22.x，`npm ls next react react-dom --depth=0` 与上方版本一致。
2. 停止占用应用端口和 3199 数据库端口的旧项目进程。
3. 执行 `npm run clean` 后重新构建。
4. 检查 `.env.local` 的 `PGLITE_DATA_DIR`、`PGLITE_SERVER_PORT` 和 `AUTH_SECRET`。
5. 验证 `_next/static` 请求均为 200；不要用旧浏览器标签页判断新构建是否缺 CSS。

数据库和附件不在 `.next` 中。清理构建缓存不会删除业务数据，但生产环境操作前仍应按部署文档完成备份。
