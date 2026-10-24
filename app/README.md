# 中澳跨境电商工作台

React 19 + Vite + Tailwind/shadcn 前端，Hono + tRPC + Drizzle(MySQL) 后端。

## V2 Alpha 架构版

包版本为 `2.0.0-alpha.1`。原版保留在 `main`，新版通过独立分支 / PR 管理，详见 [架构与兼容说明](../docs/architecture-v2.md)。

- 页面从 `src/pages/` 改为 `src/features/<业务>/`，应用路由和导航统一位于 `src/app/`，按页懒加载。
- 共享工作流规则位于 `contracts/merchant-workflow.ts`；API 保持原端点，内部划分为读模型、事务操作与权限策略。
- 主流程变为今日经营、订单队列、打包发货、独立售后、商品补货与采购收货。
- 原版数据库结构不变，**不需要因代码重组清空数据**；建议新版使用独立测试数据库。

## 当前能力

- 今日经营：生意概况、按期限排序的订单、待发货 / 缺货匹配 / 待收货 / 售后入口
- 选品 / 采购与收货 / 商品与补货 / 订单处理 / 打包发货 / 独立售后 / 利润与到账
- 系统设置：店铺授权、写回开关、成员角色、同步任务、审计日志
- **日间 / 夜间主题**：默认跟随系统，可手动切换并持久化
- **Etsy / eBay 官方 OAuth 直连**：在工作台内用平台账号登录授权，自动读取店铺信息
- **自托管账户体系**：邮箱 + 密码登录、首次管理员初始化、成员账号与密码重置，不依赖 Kimi 登录

## 本地启动

```bash
# 1) 安装依赖
npm ci
# 若 npm ci 报 ENOTFOUND npm.mirrors.msh.team（lock 文件里记录的是内网镜像），改用：
# npm install --registry=https://registry.npmjs.org --package-lock=false

# 2) 配置环境变量
cp .env.example .env
# 至少填写 APP_SECRET / DATABASE_URL

# 3) 同步数据库结构（新增了 store_credentials 表）
npm run db:push
# 或者对已有库执行：mysql -u <user> -p <db> < db/migrations/0001_store_oauth.sql

# 4) 启动
npm run dev          # http://localhost:3000
```

Node.js 20+，MySQL 8.0+。

首次打开 `/login` 会进入管理员初始化；也可以提前在 `.env` 设置
`ADMIN_EMAIL` / `ADMIN_PASSWORD`，生产环境启动时会自动创建首个管理员。
密码至少 12 位且同时包含字母和数字，数据库只保存 scrypt 加盐散列。

## 登录与成员账号

- 登录账号是邮箱，会话使用 HttpOnly + SameSite=Lax Cookie，默认 7 天有效
- 首次管理员创建后，登录页关闭初始化入口；管理员可在「系统设置 → 成员与角色」添加成员或重置密码
- 连续输错 5 次会锁定账号 15 分钟；同一 IP + 邮箱在 15 分钟内失败 10 次会被限流
- 停用成员或重置密码会立即让旧会话失效
- `APP_SECRET` 用于会话签名，生产环境至少 32 个字符；轮换后所有用户需要重新登录

## 清空数据

仓库不再内置任何演示 / 试点数据。若数据库里已有历史记录，可用下面的脚本清空：

```bash
npm run db:reset -- --yes                 # 清空全部表（含用户与登录凭据）
npm run db:reset -- --yes --keep-users    # 只清业务数据，保留登录用户
```

- 不可逆，执行前请先备份数据库
- 只清数据库行；`files` 表对应的对象存储附件不会被删除
- 不带 `--yes` 时只会打印提示，不会执行
- 清空 `users` 后重新打开 `/login` 初始化管理员；如果配置了 `ADMIN_*`，重启应用也会创建

## 主题（日间 / 夜间）

- 切换入口：侧边栏右上角 ☀️/🌙、移动端顶栏、用户菜单「切换主题」，以及「系统设置 → 外观与可读性」
- 选择保存在 `localStorage["aew-theme"]`（`light` / `dark` / `system`）
- `index.html` 内联脚本在首屏渲染前写入 `html.dark` / `html.light`，避免闪烁
- 颜色全部走 CSS 变量（`src/index.css`），运营面板、表格、状态标签在两种模式下都有独立对比度校准
- 全站遵循根目录 `DESIGN.md` 的 Nike 风格中台规范：黑白灰、系统字体、平面化面板与胶囊按钮，
  不依赖远程字体或 Nike 品牌素材；红 / 黄 / 绿 / 蓝只表达业务状态。
- 新增表单使用带未保存确认的抽屉，决策说明使用统一确认窗口；失败保留输入。
  从订单或补货链接进入时，继续保留原来的业务上下文与数量预填，不改变平台操作规则。

## 平台官方直连（Etsy / eBay）

### 1. 准备应用

**Etsy**（[开发者后台](https://www.etsy.com/developers/your-apps)）

- 回调地址填写：`https://<你的域名>/api/integrations/etsy/callback`
- 本地开发可填 `http://localhost:3000/api/integrations/etsy/callback`
- 需要的 scope：`profile_r shops_r listings_r transactions_r`（PKCE 由服务端自动生成）
- 环境变量：`ETSY_CLIENT_ID`（keystring）；可选 `ETSY_CLIENT_SECRET`、`ETSY_REDIRECT_URI`、`ETSY_SHOP_ID`

**eBay**（[开发者后台](https://developer.ebay.com/my/keys)）

- 在「User tokens / Redirect URL」里创建 **RuName**，`EBAY_REDIRECT_URI` 填 RuName（不是完整网址）
- 需要的 scope：`api_scope`、`sell.inventory.readonly`、`sell.fulfillment.readonly`、`sell.account.readonly`、`commerce.identity.readonly`
- 环境变量：`EBAY_CLIENT_ID`、`EBAY_CLIENT_SECRET`、`EBAY_REDIRECT_URI`；可选 `EBAY_ENVIRONMENT=sandbox`、`EBAY_MARKETPLACE_ID`
- `commerce.identity.readonly` 用于读取账号 ID / 用户名；若应用未开通，连接会明确报错而不是写入假数据

公网部署时建议设置 `APP_ORIGIN=https://<你的域名>`，让回调地址不依赖反向代理头。

没有 HTTPS 域名时可以先按 IP + 端口运行工作台，但 Etsy / eBay 的 OAuth 回调通常要求
HTTPS，正式连接店铺前需要域名和证书。

### 2. 在工作台连接

1. 管理员登录 →「系统设置 → 平台官方直连」
2. 点击「用 Etsy 账号连接」/「用 eBay 账号连接」
3. 在平台完成授权后自动回到 `/settings?integration=...&status=connected`
4. 店铺卡片展示：店铺名 / 账号 ID、币种、在售刊登、订单数、累计销量或销售额度、评价（Etsy）、数据读取时间
5. 可随时「刷新数据」（重新拉取）或「断开授权」（删除令牌并停止读取，历史业务数据保留）

店铺实时概况统一在设置中查看；「今日经营」展示连接异常与最后成功时间，避免把店铺概况快照误认为订单已实时同步。

### 3. 安全边界

- 令牌使用 AES-256-GCM 加密后存入 `store_credentials`，密钥由 `APP_SECRET` 派生；前端与 tRPC 查询永远拿不到令牌
- OAuth `state` 使用 JWE 加密 + 10 分钟过期，并绑定发起授权的用户 ID
- 只有 `role=admin` 的账号可以连接/断开/刷新；普通成员只能查看
- 回调只允许跳回站内相对路径，防止开放重定向
- 平台接口失败时原样展示错误摘要，不会伪装成“同步成功”；令牌失效会把店铺标记为 `expired` 并要求重新授权

轮换 `APP_SECRET` 会让已存令牌无法解密，需要重新授权一次，这是预期的安全取舍。

## Docker 部署

仓库根目录提供 `docker-compose.yml`、`deploy/Caddyfile` 和 `.env.example`。
完整步骤见 [腾讯云部署说明](../docs/deployment-tencent-cloud.md)。核心命令：

```bash
cp .env.example .env
# 编辑 .env：域名/IP、APP_ORIGIN、APP_SECRET、MySQL 密码、管理员邮箱与初始密码
docker compose build
docker compose up -d mysql
docker compose --profile tools run --rm db-init
docker compose up -d app caddy
```

MySQL 和 Node 应用都不直接暴露公网，只有 Caddy 监听 HTTP/HTTPS。

## 常用命令

```bash
npm run dev        # 开发服务器（Vite + Hono）
npm run build      # 前端构建 + 后端 esbuild 打包
npm run check      # TypeScript 类型检查
npm run lint       # ESLint
npm test           # Vitest
```
