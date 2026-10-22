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
- eBay 卖家授权使用可写的 `sell.inventory`；刷新旧 token 时只申请已获准的范围。类目接口另用 `client_credentials` 应用令牌和基础 `api_scope`，不向卖家申请不存在的类目 scope。
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

1. 先在“商品与补货”建立真实商品的 SKU，再点击 SKU 进入主商品页，创建 eBay 详情；已有 SKU 不要重复新增。
2. 填写资料并“保存草稿”；未填完整时仍可保存合法的草稿字段。
3. 补齐检查项后由管理员“更新到 eBay”，此时新刊登为“待发布”。
4. 点击“核对并发布”，核对店铺、售价、数量、图片、类目属性和政策，再确认发布。
5. 需要停售时点击“下架”，填写原因并确认；本地草稿和审计记录保留。

已在 `app/` 下通过 `npm run check`、`npm test -- --run`（105 个测试，含授权修复回归）、`npm run build`，并在本地浏览器使用模拟数据验证保存、更新、确认发布、填写原因下架、每次操作后刷新、类目搜索和运营权限；未调用真实 eBay 写入接口。Windows PowerShell 若拦截 `npm.ps1`，使用同等的 `npm.cmd` 命令，不修改系统执行策略。

## 上线准备

- 在工作台“设置 → 店铺连接”重新授权 eBay，获得 `sell.inventory` 刊登写入权限。类目查询由工作台自动获取应用级令牌，不需要卖家另行授予类目 scope。
- 在 eBay 卖家后台开启 Business Policies，创建运费、付款、退货政策。
- 创建发货地点（Inventory Location）。
- 准备公开可访问的 https 商品图片地址。
- 用一件真实商品走完整流程：创建草稿 → 保存 → 更新到 eBay → 核对 → 发布 → 下架；开发测试不会操作真实 eBay 刊登。

腾讯云部署沿用 `docs/deployment-tencent-cloud.md`。升级前备份数据库，保留服务器未提交改动和 `.env`，执行数据库结构初始化及健康检查；不要重新导入选品或供应商数据。

## 部署记录（2026-10-22）

- 功能提交 `1d3187c` 已依次推送到 `codex/local-auth-deploy` 和 `main`，并通过腾讯云控制台部署至现有 Lighthouse 实例。
- 已构建当前版本的 app 和 db-init 镜像、初始化 `marketplace_listings` 表；应用与数据库健康检查正常，商品页和 eBay 页的浏览器直达地址均返回 HTML，线上 eBay 页面产物的 SHA256 与本地验证产物一致。
- 主地址：`http://124-221-221-165.nip.io:8080`；现有临时 HTTPS 地址在部署后也通过健康检查。
- 数据库、原服务器代码改动和回滚镜像已保留，服务器原有修复已包含在发布版本中，`.env` 校验未变化。备份目录：`/opt/australian-ecommerce-workbench/backups/ebay-20261022-1d3187c`，原代码改动另保留在服务器 git stash 中。
- 部署前后均为 29 个选品、28 家供应商、0 个 SKU，没有重复导入或自动创建商品。首次真实验收需要先建立 SKU，再按上述流程操作；本次没有对真实 eBay 刊登执行写入。

## 授权机制修正（2026-10-22）

- 真实重新授权返回 `invalid_scope`。已在生产应用的 OAuth Scopes 列表核实：`sell.inventory` 可用，但 `commerce.taxonomy.readonly` 不是可申请的权限，已从卖家授权和缺失权限检查中移除。
- 按 [eBay 官方类目接口说明](https://developer.ebay.com/api-docs/commerce/taxonomy/resources/category_tree/methods/getItemAspectsForCategory)，类目搜索和属性查询使用独立的 `client_credentials` 应用令牌及基础 `https://api.ebay.com/oauth/api_scope`；政策、地点、库存和刊登操作继续使用卖家令牌。
- 应用令牌仅保存在服务端内存中，合并并发请求，在到期前刷新；取令牌失败会保留分项错误，不使用卖家令牌冒充应用授权，也不会影响其他分项读取。
- 新增回归覆盖生产授权 scope、旧卖家只读令牌刷新、应用令牌获取/并发/缓存/到期/失败重试，以及类目和卖家接口的令牌隔离。
- 实际上架还需要 eBay 账户具备 Business Policies 资格、三类有效政策、真实发货地点及完整商品资料；授权修复不会自动创建这些业务数据或发布商品。
