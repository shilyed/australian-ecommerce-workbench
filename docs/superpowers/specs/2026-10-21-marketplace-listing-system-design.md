# 多市场商品刊登系统设计

日期：2026-10-21  
状态：已确认架构，待实现

## 目标

将现有 SKU 升级为统一的主商品记录，在主商品详情页集中维护所有市场共享的信息，并为每个销售市场提供独立的刊登详情、校验和同步操作。

首个接入市场是 eBay 澳大利亚站。Etsy 和 Amazon 使用相同的市场刊登框架扩展，不共享平台专属字段。

前端交互参考 ZARA 商品后台，但不复制其视觉样式。核心行为是：

1. 主商品资料集中维护。
2. 市场详情在工作台本地编辑和保存。
3. 保存本地详情不会自动推送平台。
4. 用户明确点击“更新”后才调用平台接口。
5. 发布和上下架是独立动作，必须人工确认。

## V1 范围

V1 只实现 eBay：

- `EBAY_AU`
- 单规格商品
- 固定价 `FIXED_PRICE`
- 一个主商品在一个 eBay 店铺下对应一个活跃刊登
- 本地草稿、推送 Offer、确认发布、下架
- Etsy 和 Amazon 只显示“未接入”，不实现发布

V1 不支持：

- 多变体 listing
- 拍卖 listing
- 批量发布
- 自动定时发布
- 自动改价或自动补库存

## 核心概念

### 主商品

现有 `skus` 表继续作为主商品的权威来源，不新增独立 `products` 表。

主商品保存跨市场共享的数据：

- SKU、内部名称、英文品名
- 商品描述
- 图片
- 材质、规格、重量、尺寸
- 原产地、HS 编码、供应商款号
- 供应商和采购来源
- 内部成本

### 市场刊登

新增通用 `marketplace_listings` 表，保存某个主商品在某个平台店铺下的本地刊登状态和平台专属数据。

每个 `(skuId, platform, storeConnectionId)` 只能有一条当前记录。

平台专属数据保存在 `localPayload` JSON 中，进入平台适配器前必须经过平台 schema 校验。不能把未校验 JSON 直接发送给平台。

### 已同步平台快照

现有 `channel_listings` 继续保存平台返回的已发布刊登快照。

`marketplace_listings` 负责本地草稿和发布状态，`channel_listings` 负责平台远端事实，两者职责分开。

## 数据模型

新增 `marketplace_listings`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | serial | 主键 |
| skuId | bigint unsigned | 主商品 |
| platform | enum | ebay / etsy / amazon |
| storeConnectionId | bigint unsigned | 店铺连接 |
| status | enum | draft / ready / publishing / published / unpublished / failed |
| platformSku | varchar(255) | 平台 SKU |
| externalListingId | varchar(255) | 平台刊登 ID |
| listingUrl | varchar(1024) | 平台商品 URL |
| localPayload | json | 平台专属本地草稿 |
| lastPushedPayload | json | 最近一次成功推送的载荷 |
| lastPushedHash | varchar(64) | 最近成功推送载荷的 SHA-256 |
| lastError | text | 最近一次平台错误 |
| lastPushedAt | timestamp | 最近推送时间 |
| publishedAt | timestamp | 发布时间 |
| createdBy | bigint unsigned | 创建人 |
| timestamps | timestamp | createdAt / updatedAt |

唯一索引：`(skuId, platform, storeConnectionId)`。

辅助索引：`(platform, status)`、`(storeConnectionId)`。

迁移文件：`db/migrations/0003_marketplace_listings.sql`，并同步更新 Drizzle schema。

## eBay 本地草稿结构

`localPayload` 使用以下结构，由 Zod 在服务端校验：

```ts
type EbayLocalPayload = {
  title: string;
  description: string;
  categoryId: string;
  condition: string;
  priceAud: number;
  quantity: number;
  imageUrls: string[];
  aspects: Record<string, string[]>;
  packageWeightG: number;
  packageLengthCm: number;
  packageWidthCm: number;
  packageHeightCm: number;
  fulfillmentPolicyId: string;
  paymentPolicyId: string;
  returnPolicyId: string;
  merchantLocationKey: string;
  ebaySku: string;
};
```

约束：

- `title` 1–80 字符。
- `description` 非空。
- `priceAud` 大于 0。
- `quantity` 为 1–999999 的整数。
- `imageUrls` 至少 1 条、最多 12 条，仅允许 HTTPS。
- `categoryId`、三项政策、地点、eBay SKU 均必填。
- 包裹重量和三维尺寸必须大于 0。
- `aspects` 的键和值不能为空。

## 平台适配器

新增 `app/api/marketplaces/`：

```text
marketplaces/
  types.ts
  service.ts
  ebay/
    adapter.ts
    schema.ts
    payload.ts
    adapter.test.ts
```

统一接口：

```ts
interface MarketplaceAdapter {
  validate(draft: MarketplaceDraft): ValidationResult;
  createOrUpdate(draft: MarketplaceDraft): Promise<MarketplacePushResult>;
  publish(draft: MarketplaceDraft): Promise<MarketplacePublishResult>;
  unpublish(draft: MarketplaceDraft): Promise<void>;
  fetchOptions(storeId: number): Promise<MarketplaceOptions>;
}
```

eBay V1 接口实现使用：

- `POST /sell/inventory/v1/inventory_item/{sku}`：创建或更新 Inventory Item
- `POST /sell/inventory/v1/offer`：首次创建 Offer
- `PUT /sell/inventory/v1/offer/{offerId}`：更新已有 Offer
- `POST /sell/inventory/v1/offer/{offerId}/publish`：发布
- `POST /sell/inventory/v1/offer/{offerId}/withdraw`：下架
- Account API：读取物流、付款、退货政策
- Inventory API：读取 Merchant Location
- Taxonomy API：读取类目和必填 Item Aspects

eBay 适配器返回的 Offer ID、Listing ID、平台错误和原始响应摘要写入 `marketplace_listings` 和审计日志。原始响应中不得记录 OAuth 令牌。

## 服务端操作

新增 tRPC 路由：

### `marketplace.list`

按 SKU 返回该主商品的全部市场刊登记录、平台状态和“是否有未推送修改”。

### `marketplace.get`

返回单个市场刊登记录及本地载荷。

### `marketplace.saveDraft`

只写本地数据库，不调用平台。

保存后计算本地载荷哈希。如果与 `lastPushedHash` 不同，返回 `hasUnpushedChanges: true`。

### `marketplace.getOptions`

读取平台可选项：

- eBay 店铺
- 物流政策
- 付款政策
- 退货政策
- Merchant Location
- 类目属性

读取失败时返回可操作的错误信息，不伪造空选项。

### `marketplace.push`

执行平台适配器的 `createOrUpdate`：

1. 校验本地载荷。
2. 校验店铺授权和写权限。
3. Inventory Item upsert。
4. 已有 Offer 时更新，无 Offer 时创建。
5. 保存 `platformSku`、`externalListingId`（如返回）、`offerId`、`lastPushedPayload` 和哈希。
6. 状态改为 `ready`。
7. 写审计日志。

### `marketplace.publish`

要求 `confirm: true`：

1. 只允许 `ready` 状态。
2. 调用平台发布接口。
3. 写入 `externalListingId` 和 `listingUrl`。
4. 在 `channel_listings` 写入/更新远端快照。
5. 状态改为 `published`。
6. 写审计日志。

### `marketplace.unpublish`

要求 `confirm: true`，只允许已发布记录。调用平台下架接口，状态改为 `unpublished`。

## 状态与幂等

允许状态转换：

```text
draft -> ready
ready -> publishing -> published
draft/ready -> failed
failed -> draft/ready
published -> unpublished
```

推送使用 `(skuId, platform, storeConnectionId)` 唯一键和已保存的 Offer ID 保证幂等。

发布前检查 `externalListingId`：

- 已有 Listing ID：禁止重复发布，返回现有刊登。
- 没有 Listing ID：允许发布。

同一请求重复提交时，服务端返回已有状态，不重复创建平台记录。

## 前端

新增主商品详情路由：`/products/:skuId`。

页面结构：

- 左栏：商品图片、描述、材质、规格、重量尺寸、供应商、成本
- 右栏：市场连接卡片
- 顶部：市场操作菜单

市场卡片显示：

- 平台名称
- 本地状态
- 远端状态
- 价格、数量
- 最近更新时间
- 未推送修改警告
- 打开市场详情

市场操作菜单：

- 创建市场刊登
- 更新到平台
- 发布
- 下架

### eBay 市场详情页

新增路由：`/products/:skuId/marketplaces/ebay`。

页面使用本地表单保存，不自动调用 eBay：

- 基本描述
- 类目与属性
- 价格、数量
- 图片
- 物流与包裹
- 平台政策

底部提供：

- 保存本地草稿
- 更新 eBay
- 发布 eBay
- 下架 eBay

“更新 eBay”与“发布 eBay”必须分开。发布前展示核对摘要。

### 兼容现有页面

保留 `/sourcing` 和 `/inventory`：

- 选品页继续负责候选、样品、渠道合规和转 SKU。
- 商品与补货页增加“打开主商品”链接。
- 主商品详情页成为市场刊登的唯一入口。

## 权限

- 管理员：查看、编辑草稿、推送、发布、下架。
- operations：查看和编辑草稿，不可推送或发布。
- finance/fulfillment：只读市场刊登状态。

服务端强制权限，前端隐藏按钮只是体验层。

## eBay OAuth 权限

新增 scope：

- `https://api.ebay.com/oauth/api_scope/sell.inventory`

保留现有只读 scope。

升级 scope 后必须重新授权 eBay 店铺。现有只读令牌不能用于发布。

类目建议和类目属性通过 `client_credentials` 应用令牌读取，scope 为 `https://api.ebay.com/oauth/api_scope`。`commerce.taxonomy.readonly` 并非有效的卖家授权范围，申请它会导致整个 OAuth 授权返回 `invalid_scope`。参见 [eBay 官方 Taxonomy 说明](https://developer.ebay.com/api-docs/commerce/taxonomy/resources/category_tree/methods/getItemAspectsForCategory)。

## 错误处理

- 平台错误原样保存在 `lastError`，前端显示“平台返回错误”及可操作摘要。
- 校验错误在本地阻止推送，不调用平台。
- 授权缺失时提示重新授权。
- 未配置政策或地点时提示在 eBay 卖家后台配置。
- 推送失败不影响本地草稿。
- 发布失败保持 `failed`，不能让状态显示为已发布。

## 审计

新增审计动作：

- `marketplace.draft.create`
- `marketplace.draft.update`
- `marketplace.push`
- `marketplace.publish`
- `marketplace.unpublish`

审计记录包含平台、SKU、Offer ID、Listing ID、动作结果摘要，不包含令牌和完整买家数据。

## 测试

单元测试：

- eBay payload 映射
- 标题、图片、价格、政策、重量尺寸校验
- 本地哈希和未推送修改判断
- 状态转换
- 已有 Offer 的更新路径
- 重复推送不重复创建 Offer
- 已发布记录禁止重复发布
- 平台错误写入失败状态

集成测试：

- 保存草稿不调用平台
- 推送成功后保存 Offer ID
- 发布成功后写入 `channel_listings`
- 下架后状态为 `unpublished`
- operations 角色不能发布

## 验收标准

1. 管理员可以从主商品详情页创建 eBay 市场草稿。
2. 修改草稿不会自动调用 eBay。
3. 保存后能看到“有未推送修改”。
4. 点击“更新 eBay”生成 Inventory Item 和 Offer。
5. 点击“发布 eBay”前必须人工确认。
6. 发布成功后商品出现在 eBay，且工作台保存 Listing ID。
7. 重复点击更新/发布不会生成重复刊登。
8. 失败时草稿数据保留，错误可见，可重试。
9. 未来接入 Etsy 和 Amazon 时不需要改主商品数据模型。
