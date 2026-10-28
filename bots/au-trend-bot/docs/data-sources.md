# 数据契约和真实来源接入

所有真实来源均需使用用户自己有权使用的账号、服务及数据。适配器契约已用合成响应自动验证，
**没有用用户凭证实时联调**。接口／模型可变，部署时须单独验证实际账号权限和供应商当前条款。
本程序不处理登录 Cookie、验证码、账号爬取或私有群组。

## eBay AU

使用 `POST https://api.ebay.com/identity/v1/oauth2/token` 的应用 client credentials，
scope 为 `https://api.ebay.com/oauth/api_scope`；或使用用户配置的独立应用 access token。
自动申请的 token 只留进程内；不复用原网站 eBay 应用配置，也不执行 marketplace 写入。

发现：`GET /buy/browse/v1/item_summary/search?q=...&limit=...`；
复查：`GET /buy/browse/v1/item/{itemId}`。
请求头固定 `X-EBAY-C-MARKETPLACE-ID: EBAY_AU`。按 `itemId` 去重，读取
`title`、`itemWebUrl`、`price.value/currency`、`itemLocation.country`。
价格保留原币种，不擅自汇率换算；商品链接去掉查询／跟踪参数。
复查 404 记录为不可用，不推定已成交；其他错误显式失败，不默默丢弃坏行。

Browse 不提供所需的竞品 AU 周销量。`itemLocation.country` 不是卖家注册地，
AU 站点不是 AU 买家证明。Product Research 后台权限、导出能力和 API 权限须分别确认。
没有合格导入时，成交章节显示“本周 AU 买家销量未知”。

## TikTok / Apify

需要 `ATB_APIFY_TOKEN` 和 `ATB_ALLOW_PAID_PROVIDERS=true`，不会为用户购买套餐。
使用官方 Apify REST 的：

- `POST /v2/actors/clockworks~tiktok-scraper/runs`
- `GET /v2/actor-runs/{runId}`
- `GET /v2/datasets/{defaultDatasetId}/items`

输入采用 actor 公布的 `searchQueries`、`searchSection="/video"`、`resultsPerPage` 和 `postURLs`。
发现查询在赛道词后附加 `Australia`，仅为弱相关检索上下文，**不是观众地理过滤器**。
已有但本日未重新发现的视频按 URL 有界复查。下载、字幕、评论明细、额外作者资料和 actor AI 均不开启。
查询条件和输入保存在任务记录中，复查不伪造新的关键词命中。

读取 `id`、`webVideoUrl`、`text`、`createTimeISO/createTime`、`playCount`、`diggCount`、
`commentCount`、`shareCount`、`collectCount` 和可选 `locationCreated`。
缺失数字为未知，负值、布尔值或数字字符串不悄悄转型。按视频 ID 去重。
指标时间以 provider run 的 `finishedAt` 为近似观察时间，明确写入 `time_basis`，不是逐条精确采集时刻。

`locationCreated` 仅为服务返回的内容创作地区，不是创作者户籍或观众国家；
正文澳洲词汇单独作为弱相关信号。观众国家和买家国家始终未知。

每次设置 `timeout`、`maxItems`、`maxTotalChargeUsd`、`restartOnError=false`。
官方 `maxItems` **仅约束适用计费模式的收费件数，不保证返回条数**，因此另外检查实际 dataset 大小；
`maxTotalChargeUsd` 为 run 总费用上限。达到限制不代表覆盖了全部搜索结果。
多取一个哨兵条目检测截断，保留上限内样本并显式标为 partial；同一 run 重复视频的冲突计数
保守置未知并报告冲突，而不是取最大数伪装增长或把整个正常批次清空。
启动前持久化最坏费用预留和任务键。已知 run 跨重启／跨日继续查询；
启动响应丢失则停在不确定状态，禁止自动重启收费任务。

人工处理：用 `status` 查 `apify:YYYY-MM-DD:discover`／`refresh`，先在用户自己的 Apify Console
核对 actor、输入和时间，再 `reconcile-apify KEY --run-id ID`，之后 `collect --retry`。
若确认没有外部 run，可 `--no-run-confirmed`；当日不会再启动该任务。不要猜 run ID。

## Google Trends / SerpApi

用户自愿选择 SerpApi 时配置 `ATB_SERPAPI_KEY` 并显式启用收费后端。
请求 `https://serpapi.com/search.json`：

```text
engine=google_trends
q=<同一组、最多五个赛道查询词，逗号分隔>
geo=AU
data_type=TIMESERIES
date=<当地今日减八十九天> <当地昨日>
tz=<按当前 Sydney UTC offset 计算的负分钟数>
```

日期范围用于获得日粒度并覆盖两个完整周；供应商若改为周／小时粒度、稀疏或部分数据，
代码会拒绝计算周均／环比，而不是做隐含换算。
读取 `interest_over_time.timeline_data[].timestamp` 和 `values[].query`（或可验证的 `query_index`）、
`extracted_value`。`<1` 保留未知而非擅自填零或小数。
每日响应作为独立归一化序列存储；每个查询只在同一份序列内比较两期。
需要两期各七个非部分日点；获取超过三天、缺点或上期均值为零均给出具体状态／原因。
收费请求不自动重试，失败也占用当日预留，防止模糊失败无限收费。

Google 官方 API 当前仍需实际 Alpha 资格；未提供凭证时不会冒充已接通，也没有 `pytrends` 隐式回退。

## 授权 eBay 成交 CSV

命令示例（时间必须带 offset；全局选项放在子命令前）：

```text
python -m au_trend_bot --config config.toml --env-file .env import-sales inputs/authorized.csv --provenance "authorized supplier export" --authorized
```

文件 UTF-8，可有 BOM；最多 5 MB／一万条，列名和顺序必须**完全**如下。拒绝额外列，
尤其买家姓名、邮件、地址；`record_id` 使用稳定伪名，入库前哈希，不保存原始订单标识。

```csv
record_id,item_id,title,url,kind,quantity,sold_at,period_start,period_end,buyer_country,marketplace,item_location_country,seller_country
```

此处只定义表头，不提供可能被误当真实成交的数据行。

| 字段 | 约束 |
| --- | --- |
| `record_id` | 在同一 eBay 数据域全局稳定、唯一、非个人身份标识；重复 ID 相同内容幂等，不同内容整批报错 |
| `item_id`、`title`、`url` | 公开商品标识、最小化商品文案、HTTPS eBay AU／com 链接 |
| `kind` | `transaction`、`period_estimate` 或 `rolling_30d`，不能混用 |
| `quantity` | 非负整数，transaction 必须大于零 |
| `sold_at` | transaction 必填且不得在未来，如 `2026-10-20T08:30:00+11:00`；聚合行必须留空 |
| `period_start/end` | 聚合行必填，左闭右开、结束不得在未来；transaction 必须留空 |
| `buyer_country` | 明确的两位大写国家码或空；AU 站点／卖家所在地不能拿来补 AU |
| `marketplace` | 明确的 `EBAY_AU`、`EBAY_US` 等；不是买家国家 |
| `item_location_country`、`seller_country` | 有证据时填写，否则空；不能互相代填 |

`transaction` 表示用户有权导入的逐条成交证据；系统并未独立核验真实性。
只有 AU 买家且 sold_at 属于 `[start,end)` 才计入成交样本榜。
未知国家、其他国家及其他时间的记录均排除，并报告排除数量。
一个文件中存在坏行时整批不入库，不能忽略坏行后称全部成功。

`period_estimate` 是**明确标注的第三方估算**，仅在原始区间完整位于本周时独立展示；
即使买家地区写 AU，也不与逐条成交相加。`rolling_30d` 要求原始区间为三十个当地日期，
报告只保留原口径，不差分、不除以天数换算七天销量。
只有日期范围的 Product Research 聚合值不能伪造 `sold_at` 变成逐条交易；
若以后要支持经核实的官方聚合成交，应另加独立、可验收的数据契约。

`--provenance` 只写不敏感的授权来源描述；不要放 key、完整私有下载链接或买家信息。
没有明确两期覆盖范围时，不以缺少记录为零销量计算成交环比。

## Google 官网 CSV 后备

从用户有权使用的 Google Trends 网站导出 **Australia、日粒度** 的原始 CSV。
支持前置 `Category` 行，要求标题如：

```csv
Day,coffee cup: (Australia)
```

也支持 `日期` 与 `(澳大利亚)`，查询词必须在配置内，可以只导入其中部分查询。
拒绝 Week／小时表头、未标地区、非 AU、重复日期、未知查询和无法解析的数值；
`<1`／空值为未知，当天数据标为部分，不能用于完整周比较。
不要修改表头把其他国家数据伪装成 Australia；授权确认和原始来源由操作者负责。

```text
python -m au_trend_bot --config config.toml --env-file .env import-trends inputs/multiTimeline.csv --fetched-at 2026-10-28T08:00:00+11:00 --authorized
```

`fetched-at` 是真实下载时间，不是导入时间或任意“让数据变新”的日期。
CSV 序列来源标为 `google_csv`，不会让 SerpApi 适配器变成“已联通”。

## AI 与通知

同时设置 `ATB_AI_ENABLED=true`、`ATB_AI_PUBLIC_EVIDENCE_CONSENT=true` 和独立 key 才调用 DeepSeek。
默认 `https://api.deepseek.com/chat/completions`，模型可配置；不在源码或命令行传 key。
只发送公开商品／内容文案及确定性词典命中，不发送成交明细、买家信息或网站数据。
返回结构化定性假设，引用必须属于输入且支持对应词典特征；数字／财务输出、无效结构和截断均为失败。
此防御不等于事实认证，报告始终把 AI 文字标为待核实假设。原始容量和全部数值由代码表格呈现。
同一报告的 AI 结果缓存；调用中断不盲目重付费，需新修订报告重试。

SMTP 仅支持 TLS 的 465／587；HTTPS webhook 收到 JSON `{id,subject,html,csv}`，
头部带稳定的 `Idempotency-Key`，可另配 Bearer。接收端仍应按该 key 去重。
外部错误响应正文、HTTP 完整 URL、密钥和 SMTP 远端认证消息不写日志。
本地 outbox 在发送前写 `sending`；未知结果停为 `uncertain`，人工核对后才能允许重试。
每日采集错误告警按“日期＋来源”去重，默认最多二十次通知尝试；未配置渠道则只留状态／退出码。

## 状态解释

`ready` 仅配置就绪；`ok` 是有样本的该次操作成功；`empty` 是服务可用但样本为空；
`partial` 是不完整或警告；`pending` 是已知外部 run 尚未结束；`unconfigured`、`disabled`、
`blocked`、`failed`、`stale` 不能解释成数据完整成功。Instagram／Facebook 的
`not_implemented` 是明确的后续范围，不是正在采集。

所有请求超时／响应大小／速率／重试和费用预留都有上限。原始指标、观察时间、UTC 和当地窗口、
配置指纹、AU 证据类型、来源链接、未知原因与置信度可在 SQLite／JSON／HTML／CSV 中追溯。
公开文案并不等于产品性能认证，也不保证拥有澳洲观众或产生购买。
