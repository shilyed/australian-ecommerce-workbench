# 多市场商品后台：开发进度（2026-10-22）

在 `bbd1838` 已有实现上补齐 eBay 详情操作页，沿用现有接口、草稿转换和权限规则。

## 已完成（后端）

- 数据表 `marketplace_listings`：一个主商品（SKU）× 一个平台 × 一个店铺 = 一份市场详情。
  - 状态：草稿 → 待发布 → 发布中 → 在售 / 已下架 / 失败。
  - 分开保存“本地详情”和“最近一次推送到平台的内容”，可判断是否有未推送修改。
  - 迁移文件 `app/db/migrations/0003_marketplace_listings.sql` 已纳入版本管理；部署用 `db-init` 按 schema 建表。
- eBay 适配器（Inventory API）：写入商品、创建/更新 Offer、发布、下架；读取运费/付款/退货政策、发货地点、类目推荐和类目属性。
- 业务规则：
  - 保存只写本地，不碰 eBay。
  - “更新到 eBay”只更新平台内容，不发布。
  - 发布前必须已推送且无未推送修改；有防重复发布锁。
  - 下架必须填写原因。所有操作写审计日志。
  - 更新、发布、下架仅管理员可做；编辑草稿管理员和运营可做。
- 接口 `marketplace.*`：list / get / createEbay / saveDraft / getOptions / push / publish / unpublish。
- eBay 授权范围改为可写的 `sell.inventory`，并增加 `commerce.taxonomy.readonly`；刷新旧 token 时不会因新权限失败。
- 已核实发布锁：Drizzle mysql2 的 `update` 返回原始 `[ResultSetHeader, FieldPacket[]]` 元组，`const [lock]` 可以正确读取 `affectedRows`，无需改写现有生产逻辑。新增回归覆盖真实 Drizzle 执行路径（仅 mock mysql2 传输）、零行抢锁失败、并发只发布一次和平台失败后的状态记录。

## 已完成（前端）

- 主商品详情页 `/products/:skuId`、库存页 SKU 跳转、状态中文名和颜色。
- eBay 详情页 `EbayListingPage`：`/products/:skuId/marketplaces/ebay`，以 lazy 路由加载，外层使用 `AuthLayout`。
- 先按 SKU 查找 eBay 刊登，再加载详情；复用 `formFromDraft` / `draftFromForm` 初始化和保存草稿。
- 可编辑 SKU、标题（80 字符计数）、描述、成色、类目搜索与 ID、可增删的类目属性、售价、数量、逐行图片 URL、包裹重量尺寸、三类 Business Policies 和发货地点。
- 展示刊登状态、未保存修改、未推送修改、平台错误、最近推送时间、线上链接、缺失字段和类目必填属性；缺少权限时引导到“设置 → 店铺连接”重新授权。
- 保存草稿不改动 eBay；未保存的修改必须先保存，更新到 eBay 不会替新刊登自动发布，但会直接更新已在售商品。
- 发布前展示完整核对摘要并通过 AlertDialog 二次确认；下架需填写 2–500 字原因并确认。每次写入操作后提示结果并刷新刊登和主商品数据，失败时也刷新平台错误。
- 管理员和运营可编辑、保存；仅管理员可更新、发布、下架。其他有库存查看权限的角色只读，不调用仅供编辑者使用的选项接口。
- 前端回归覆盖表单字段、草稿转换、角色权限、缺少授权和类目必填项、状态按钮、读取失败和重复操作保护。

## 使用与验收

1. 在库存页点击 SKU，进入主商品页，创建 eBay 详情。
2. 填写资料并“保存草稿”；未填完整时仍可保存合法的草稿字段。
3. 补齐检查项后由管理员“更新到 eBay”，此时新刊登为“待发布”。
4. 点击“核对并发布”，核对店铺、售价、数量、图片、类目属性和政策，再确认发布。
5. 需要停售时点击“下架”，填写原因并确认；本地草稿和审计记录保留。

已在 `app/` 下通过 `npm run check`、`npm test -- --run`（89 个测试）、`npm run build`，并在本地浏览器使用模拟数据验证保存、更新、确认发布、填写原因下架、每次操作后刷新、类目搜索和运营权限；未调用真实 eBay 写入接口。Windows PowerShell 若拦截 `npm.ps1`，使用同等的 `npm.cmd` 命令，不修改系统执行策略。

## 上线准备

- 在工作台“设置 → 店铺连接”重新授权 eBay，获得 `sell.inventory` 和 `commerce.taxonomy.readonly` 权限。
- 在 eBay 卖家后台开启 Business Policies，创建运费、付款、退货政策。
- 创建发货地点（Inventory Location）。
- 准备公开可访问的 https 商品图片地址。
- 用一件真实商品走完整流程：创建草稿 → 保存 → 更新到 eBay → 核对 → 发布 → 下架；开发测试不会操作真实 eBay 刊登。

腾讯云部署沿用 `docs/deployment-tencent-cloud.md`。升级前备份数据库，保留服务器未提交改动和 `.env`，执行数据库结构初始化及健康检查；不要重新导入选品或供应商数据。
