# 多市场商品后台：开发进度（2026-10-21）

分支：`codex/local-auth-deploy`（基准 `67d7866`），改动尚未提交、尚未部署。

## 已完成（后端）

- 数据表 `marketplace_listings`：一个主商品（SKU）× 一个平台 × 一个店铺 = 一份市场详情。
  - 状态：草稿 → 待发布 → 发布中 → 在售 / 已下架 / 失败。
  - 分开保存“本地详情”和“最近一次推送到平台的内容”，可判断是否有未推送修改。
  - 迁移文件 `app/db/migrations/0003_marketplace_listings.sql`（被 .gitignore 忽略，提交时需 `git add -f`；部署用 `db-init` 按 schema 建表）。
- eBay 适配器（Inventory API）：写入商品、创建/更新 Offer、发布、下架；读取运费/付款/退货政策、发货地点、类目推荐和类目属性。
- 业务规则：
  - 保存只写本地，不碰 eBay。
  - “更新到 eBay”只更新平台内容，不发布。
  - 发布前必须已推送且无未推送修改；有防重复发布锁。
  - 下架必须填写原因。所有操作写审计日志。
  - 更新、发布、下架仅管理员可做；编辑草稿管理员和运营可做。
- 接口 `marketplace.*`：list / get / createEbay / saveDraft / getOptions / push / publish / unpublish。
- eBay 授权范围改为可写的 `sell.inventory`，并增加 `commerce.taxonomy.readonly`；刷新旧 token 时不会因新权限失败。
- 验证：`npm run check` 通过；`npm test -- --run` 64 个测试全部通过。

## 待完成

1. 前端：
   - 主商品详情页 `/products/:skuId`：左侧主资料，右侧 eBay / Etsy（未接入）/ Amazon（未接入）市场卡片。
   - eBay 详情页 `/products/:skuId/marketplaces/ebay`：编辑表单、保存草稿、更新到 eBay、核对后发布、填写原因下架；提示缺少的授权。
   - 库存页每个 SKU 增加“打开主商品”入口；补充状态中文名和颜色。
2. 再跑 check / test / build，提交代码。
3. 部署到腾讯云服务器（注意服务器上已有未提交改动和 `.env`，不要覆盖）。
4. 上线后需要用户操作：
   - 在设置页重新授权 eBay（获取刊登写入权限）。
   - 在 eBay 卖家后台开启 Business Policies，建好运费、付款、退货政策。
   - 创建发货地点（Inventory Location）。
   - 准备公开的 https 商品图片地址。
   - 用一件真实商品走一遍：创建草稿 → 保存 → 更新到 eBay → 核对 → 发布 → 下架。


## 状态更新（2026-10-22，已推送到 main）

- 已合入：后端 marketplace 接口与 eBay 适配器、数据表与迁移、主商品详情页 `/products/:skuId`、库存页 SKU 跳转、状态中文名与颜色。
- 未完成：eBay 详情编辑页 `EbayListingPage`（`/products/:skuId/marketplaces/ebay`）尚未编写，路由暂未注册；主商品页上的“打开 eBay 详情”按钮目前会进入 404。
- 未部署。
