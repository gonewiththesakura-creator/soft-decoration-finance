# 部署说明

## 试点部署（推荐）

第一版适合部署到单台 Windows 或 Linux Node.js 主机，挂载持久磁盘保存 `data/finance-db`。

1. 安装 Node.js 22.x。
2. 拉取源码并执行 `npm ci`。
3. 创建 `.env.local`，设置强随机 `AUTH_SECRET` 和持久化路径。
4. 首次执行 `npm run db:seed`。
5. 执行 `npm run build`。
6. 使用进程管理器运行 `npm start`。
7. 反向代理到应用端口并启用 HTTPS。

示例环境变量：

```dotenv
AUTH_SECRET=至少32字节的随机值
PGLITE_DATA_DIR=D:/zhiheng-data/finance-db
PGLITE_SERVER_PORT=3199
ALLOW_DEMO_SEED=false
NEXT_PUBLIC_APP_NAME=织衡经营财务
```

`PGLITE_SERVER_PORT` 仅监听 `127.0.0.1`，不要暴露到公网。应用启动器会先启动数据库服务，再启动 Next.js，并在应用退出时关闭自己创建的数据库进程。

## 进程管理

Windows 可使用 NSSM 或任务计划程序，Linux 可使用 systemd。进程工作目录必须是仓库根目录，启动命令为：

```bash
npm start -- -p 3000
```

健康检查可请求 `/login`。数据库服务内部健康检查为 `http://127.0.0.1:3199/health`。

## 备份与恢复

- 每日停止服务后备份 `PGLITE_DATA_DIR` 整个目录。
- 试点期间建议保留 7 个日备份和 4 个周备份。
- 恢复前停止应用，将目标目录移走，再放回完整备份。
- 恢复后先执行 `npm test`（使用独立临时库），再启动生产服务。

## 安全检查

- 更换所有 Seed 密码，禁用不使用的账号。
- 生产环境默认拒绝执行演示 Seed；仅隔离演示环境可临时设置 `ALLOW_DEMO_SEED=true`。
- 使用至少 32 字节随机 `AUTH_SECRET`。
- 只通过 HTTPS 暴露 Next.js 端口。
- 限制主机与备份目录访问权限。
- 不把 `.env.local`、`data/` 或银行回单附件提交到 Git。
- 定期检查操作日志和异常登录。

## 扩展到正式 PostgreSQL

PGlite 适合 2-3 个真实项目的单机试点，不适合多实例水平扩展。正式多人生产环境建议迁移到托管 PostgreSQL：保留 `src/db/schema.ts` 和 `src/db/migration.ts` 的 PostgreSQL 结构，将本地数据库服务客户端替换为连接池，并增加对象存储、备份、监控和高可用。该迁移属于部署增强，不改变业务表与金额口径。
