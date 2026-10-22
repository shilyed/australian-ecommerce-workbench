# 交接文档：多市场商品后台（2026-10-22）

## 目标

参考 ZARA GEMA，实现多市场商品后台：

- 一个主商品详情页，右侧显示 eBay / Etsy / Amazon 市场卡片。
- 每个市场有独立详情页。本地保存只写工作台，不自动推送平台。
- “更新到 eBay / 发布 / 下架”必须由管理员人工点击，发布和下架需二次确认，下架需填写原因。

GEMA 结构已调研完毕，不需要再登录 GEMA。不要索取或记录任何密码。

## 环境

- 本地仓库：`C:\Users\somakuc\OneDrive - Inditex\文档\ChatGPT\Australian_Ecommerce\repo`
- 分支：`codex/local-auth-deploy`，基准提交 `67d7866`；GitHub：`shilyed/australian-ecommerce-workbench`
- 代码在 `repo/app/`，在 `app/` 下运行：`npm run check`、`npm test -- --run`、`npm run build`
- PowerShell；`apply_patch` 用绝对路径。
- 技术栈：React 19、react-router 7、tRPC 11（superjson）、Hono、Drizzle（MySQL）、Zod 4、Vitest、Tailwind、shadcn。
- 前端 tsconfig 启用了 `noUnusedLocals` / `noUnusedParameters`。

## 已完成（未提交）

后端（check 通过，64 个测试通过）：

- `app/db/schema.ts`：新增 `marketplace_listings` 表与 `MarketplaceListing` 类型。
- `app/db/migrations/0003_marketplace_listings.sql`（被 .gitignore 忽略，提交时用 `git add -f`）。
- `app/api/marketplaces/`：`types.ts`、`state.ts`、`service.ts`、`router.ts`、`ebay/schema.ts`、`ebay/payload.ts`、`ebay/adapter.ts`、`ebay/adapter.test.ts`。
- `app/api/router.ts` 注册 `marketplace` 路由。
- `app/api/integrations/providers.ts`、`store-service.ts`：eBay 卖家 scope 使用 `sell.inventory`；刷新 token 只用已授予的 scope。Taxonomy 改用 `client_credentials` 应用令牌及基础 `api_scope`，不能把不存在的 `commerce.taxonomy.readonly` 放进卖家授权请求。
- tRPC 接口：`marketplace.list({skuId})`、`get({listingId})`、`createEbay({skuId, storeConnectionId})`、`saveDraft({listingId, payload})`、`getOptions({storeConnectionId, categoryId?, categoryQuery?})`（返回政策/地点/aspects/categories，各为 `{items, error}`，另有 `missingScopes`）、`push({listingId})`、`publish({listingId, confirm: true})`、`unpublish({listingId, confirm: true, reason})`。
- `get` 返回 `{ listing, sku, store, canWriteToPlatform, marketplaceId }`；listing 带 `localPayload`、`hasUnpushedChanges`、`status`、`externalOfferId`、`externalListingId`、`listingUrl`、`lastError`、`lastPushedAt`。
- 待核实：`service.ts` 中 `publishListing` 用 `const [lock] = await db.update(...)` 读取 `affectedRows`，需确认 drizzle mysql2 返回结构（`[ResultSetHeader, ...]`）。

前端（已写，尚未跑 check）：

- `app/src/features/products/ProductDetailPage.tsx`：主商品页（左主资料，右市场卡片，创建 eBay 详情）。
- `app/src/features/products/ebay-form.ts`：表单 ↔ 草稿转换、`readinessIssues`、`missingRequiredAspects`、成色选项。

## 剩余工作

1. 新建 `app/src/features/products/EbayListingPage.tsx`（路由 `/products/:skuId/marketplaces/ebay`）：
   - 用 `marketplace.list` 找到该 SKU 的 eBay listing，再 `marketplace.get`。
   - 表单：标题、eBay SKU、描述、类目搜索（`getOptions.categoryQuery`）与类目 ID、类目属性（显示 required aspects，可增删行）、价格、数量、成色、图片 URL（每行一个）、包裹重量尺寸、运费/付款/退货政策与发货地点下拉。
   - 按钮：保存本地草稿；更新到 eBay；发布（先显示核对摘要，AlertDialog 确认）；下架（填写原因 + 确认）。
   - 显示状态、未推送修改、`lastError`、`missingScopes`（提示去设置页重新授权 eBay）。
   - 非管理员：推送/发布/下架按钮禁用（`useAuth().user.role === "admin"`）。
2. `app/src/app/routes.tsx`：新增两个 lazy 路由，用 `AuthLayout` 包裹。
3. `CatalogPage.tsx`：库存表每行 SKU 下加 `<Link to={`/products/${sku.id}`}>打开主商品</Link>`。
4. `src/lib/format.ts` labels 增加：`ready: 待发布`、`publishing: 发布中`、`published: 在售`、`unpublished: 已下架`、`not_created: 未创建`；`StatusPill` 加对应颜色。
5. 运行 check / test / build 并修复。
6. 写变更文档（如 `docs/CHANGELOG.md` 或 README 中的使用说明），删除本地 `MARKETPLACE_PROGRESS.md` 或合并进文档。
7. 提交（英文提交信息，如 `Add multi-marketplace listing workflow with eBay adapter`），推送到 GitHub。
8. 部署（可选，视用户要求）：
   - 服务器：腾讯云 Lighthouse `lhins-59ljdx66`，IP `124.221.221.165`，目录 `/opt/australian-ecommerce-workbench`，docker 需 `sudo`。
   - 服务器 git 工作区有未提交改动（`app/api/boot.ts`、`app/api/integrations/providers.ts`、`app/api/lib/secrets.ts`），部署前先 `git status` 并 stash；不要覆盖 `.env`。
   - `sudo docker compose build app && sudo docker compose up -d app && sudo docker compose --profile tools run --rm db-init && curl http://127.0.0.1:8080/api/health`
   - 访问：`https://behind-hoped-jean-flower.trycloudflare.com`（临时，2026-10-22 仍可用），`http://124-221-221-165.nip.io:8080`。
   - eBay 店铺 `storeConnectionId = 1`（angelz51，EBAY_AU）。已导入 29 个选品和 28 家供应商，不要重复导入。

## 上线后需要用户操作

- 设置页重新授权 eBay（获得刊登写入权限；类目读取由服务端应用级令牌处理）。
- eBay 卖家后台开启 Business Policies，建好运费、付款、退货政策；创建发货地点。
- 准备公开的 https 图片链接。
- 用一件真实商品走完：创建草稿 → 保存 → 更新到 eBay → 核对 → 发布 → 下架。
