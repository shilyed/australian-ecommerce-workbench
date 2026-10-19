# 中澳跨境电商工作台

React 19 + Vite + Tailwind/shadcn 前端，Hono + tRPC + Drizzle(MySQL) 后端。

## 当前能力

- 今日工作台：授权异常、逾期发货、缺货/未匹配、待质检与售后超期聚合
- 选品 / 采购 / 商品与库存 / 订单 / 发货与售后 / 成本与报表
- 系统设置：店铺授权、写回开关、成员角色、同步任务、审计日志
- **日间 / 夜间主题**：默认跟随系统，可手动切换并持久化
- **Etsy / eBay 官方 OAuth 直连**：在工作台内用平台账号登录授权，自动读取店铺信息

## 本地启动

```bash
# 1) 安装依赖
npm ci
# 若 npm ci 报 ENOTFOUND npm.mirrors.msh.team（lock 文件里记录的是内网镜像），改用：
# npm install --registry=https://registry.npmjs.org --package-lock=false

# 2) 配置环境变量
cp .env.example .env
# 至少填写 APP_ID / APP_SECRET / DATABASE_URL / KIMI_* / OWNER_UNION_ID

# 3) 同步数据库结构（新增了 store_credentials 表）
npm run db:push
# 或者对已有库执行：mysql -u <user> -p <db> < db/migrations/0001_store_oauth.sql

# 4) 启动
npm run dev          # http://localhost:3000
```

Node.js 20+，MySQL 8.0+。

## 主题（日间 / 夜间）

- 切换入口：侧边栏右上角 ☀️/🌙、移动端顶栏、用户菜单「切换主题」，以及「系统设置 → 外观与可读性」
- 选择保存在 `localStorage["aew-theme"]`（`light` / `dark` / `system`）
- `index.html` 内联脚本在首屏渲染前写入 `html.dark` / `html.light`，避免闪烁
- 颜色全部走 CSS 变量（`src/index.css`），运营面板、表格、状态标签在两种模式下都有独立对比度校准

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

### 2. 在工作台连接

1. 管理员登录 →「系统设置 → 平台官方直连」
2. 点击「用 Etsy 账号连接」/「用 eBay 账号连接」
3. 在平台完成授权后自动回到 `/settings?integration=...&status=connected`
4. 店铺卡片展示：店铺名 / 账号 ID、币种、在售刊登、订单数、累计销量或销售额度、评价（Etsy）、数据读取时间
5. 可随时「刷新数据」（重新拉取）或「断开授权」（删除令牌并停止读取，历史业务数据保留）

「今日工作台」顶部的**店铺概览**同步展示这些实时指标。

### 3. 安全边界

- 令牌使用 AES-256-GCM 加密后存入 `store_credentials`，密钥由 `APP_SECRET` 派生；前端与 tRPC 查询永远拿不到令牌
- OAuth `state` 使用 JWE 加密 + 10 分钟过期，并绑定发起授权的用户 ID
- 只有 `role=admin` 的账号可以连接/断开/刷新；普通成员只能查看
- 回调只允许跳回站内相对路径，防止开放重定向
- 平台接口失败时原样展示错误摘要，不会伪装成“同步成功”；令牌失效会把店铺标记为 `expired` 并要求重新授权

轮换 `APP_SECRET` 会让已存令牌无法解密，需要重新授权一次，这是预期的安全取舍。

## 常用命令

```bash
npm run dev        # 开发服务器（Vite + Hono）
npm run build      # 前端构建 + 后端 esbuild 打包
npm run check      # TypeScript 类型检查
npm run lint       # ESLint
npm test           # Vitest
```
