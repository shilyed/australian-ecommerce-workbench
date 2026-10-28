# 澳洲电商趋势机器人

与原网站隔离的 Python 3.12 日采／中文周报程序，默认观察咖啡杯。**没有服务器访问和数据凭证时，
只能验收本地功能，不能据此认定已上线或已接通真实来源。**

先行发布的[中文需求报告](docs/requirements.md)为实施基线，独立文档提交为
[`d0bfa14`](https://github.com/shilyed/australian-ecommerce-workbench/commit/d0bfa1442061985bbb1993bbf5da79f34b88d58d)，早于实现代码。

## 能做什么

| 通道 | 已实现能力 | 尚需用户配置／真实边界 |
| --- | --- | --- |
| eBay AU | 官方应用 OAuth、Browse 关键词发现、已知商品复查、价格及商品所在地快照 | 独立应用／token 及 Browse 权限；**在售数据不是周销量** |
| TikTok | Apify actor 的关键词发现、URL 复查、持久 run ID、公开累计互动 | Apify 授权／token／额度；查询附加 `Australia` 只是弱相关筛选，全球互动不是 AU 观看量 |
| Google Trends | SerpApi 自动 AU 日序列、官网 AU 日粒度 CSV 导入、同份序列内周比较 | SerpApi 为自愿可选收费后端，需 key；CSV 是人工导入，不等同自动接口 |
| 授权成交 | 严格 CSV 导入、AU 买家／时间筛选、成交与估算／滚动三十天分表 | 需合法数据、明确买家国家及时间；不是自动获取竞品销量 |
| DeepSeek | 可选 OpenAI 兼容定性摘要、公共证据引用校验、显式失败状态 | 用户在独立环境文件中启用；默认模型 `deepseek-flash`，未用真实 key 联调 |
| 报告／通知 | HTML、CSV、JSON，TLS SMTP 或 HTTPS webhook，持久 outbox | 邮件或 webhook 需用户配置；接收端接受不等于最终阅读／送达 |
| Instagram／Facebook | 报告显示未实现及权限前提 | 明确属于后续范围，没有伪装成可用的空适配器 |

数值、去重、时间窗口和来源内排名全部由确定性代码计算。累计互动、成交样本和搜索兴趣不合成总分。
缺失写未知，不补零；没有精确周边界快照，只显示带实际起止的部分观察区间增量。

## 无密钥验收

在仓库根目录运行以下 **PowerShell** 命令。安装依赖需要 PyPI 网络；安装后的演示和测试不访问外部平台、不收费、不发通知。

```powershell
Set-Location bots\au-trend-bot
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"
.\.venv\Scripts\python.exe -m au_trend_bot demo
```

最后一条就是端到端验收命令：在独立 `demo-output\` 创建 SQLite、中文 HTML、CSV 和 JSON，
检查完整／部分增量、缺失、计数重置、AU 买家、右边界排除、搜索比较及幂等，全部通过才返回 `0`。
所有样例显著标注 **DEMO，非实时数据**。重复运行复用同一演示报告，不会创建 live 数据库。
演示数据库禁止联网／投递，不能混入 `data\`。

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -t . -v
.\.venv\Scripts\python.exe -m ruff check au_trend_bot tests
.\.venv\Scripts\python.exe -m ruff format --check au_trend_bot tests
```

Linux 使用 `.venv/bin/python` 替换上述解释器路径。实际执行记录及未验证项见[验收说明](docs/acceptance.md)。

## 本地真实运行

```powershell
Copy-Item config.example.toml config.toml
Copy-Item .env.example .env
# 在本机编辑器中配置 .env；不要在聊天、命令参数、日志或 git 中粘贴密钥。
.\.venv\Scripts\python.exe -m au_trend_bot --config config.toml --env-file .env doctor
.\.venv\Scripts\python.exe -m au_trend_bot --config config.toml --env-file .env collect
.\.venv\Scripts\python.exe -m au_trend_bot --config config.toml --env-file .env report
```

`doctor` 只检查配置，不发平台请求；“ready”不等于账号联调通过。无 key 时应返回 `2`、逐项显示
`unconfigured`，而不是空成功。`collect` 使用当前真实时间，不支持把今天快照伪造为历史日期。
首次运行通常没有足够历史，周报应显示未知／部分覆盖。

全局 `--config`、`--env-file` 放在子命令前。只读取 `ATB_*` 变量，不读取网站根 `.env`、
`DATABASE_URL` 或无前缀平台凭证。独立环境文件不做 shell 插值；环境变量优先于文件。
为兼容 Compose raw 环境文件，建议值不加引号、无前后空格；`$` 原样保留，不把文件当脚本执行。
配置赛道／关键词／词典变更会改变指纹，需选择新的 `ATB_DATA_DIR`，旧数据不混入新赛道。

| 命令 | 用途 |
| --- | --- |
| `doctor` / `status` / `health` | 配置、持久任务／来源／预算／outbox、数据就绪状态 |
| `health --scheduler-only` | 仅检查最近调度心跳，不证明数据或邮件正常 |
| `collect --retry` | 在每日次数上限内重试失败采集；成功的当日任务不重复采集 |
| `collect --no-notify` | 不发送采集告警，仍保留非成功状态和退出码 |
| `report [--end YYYY-MM-DD] [--revision 2] [--send]` | 默认最近完整当地周；end 必须是排他的当地周一；默认只写本地文件 |
| `import-sales FILE --provenance LABEL --authorized` | 校验并幂等导入授权成交；具体列见[数据契约](docs/data-sources.md) |
| `import-trends FILE --fetched-at OFFSET_TIMESTAMP --authorized` | 导入原始 AU 日粒度 CSV，显式记录获取时间 |
| `tick` / `run` | 单次调度／前台常驻调度；不要再同时配置另一套 cron |
| `backup --output NEW_FILE` | SQLite 一致性在线备份；不覆盖现有文件 |
| `prune --days 90` | 仅删除超过天数的快照／搜索序列；至少保留三十天，保留报告、成交和幂等记录 |
| `resolve-delivery KEY --outcome sent\|retry` | 人工核对后确认送达或允许重试，不确定发送不会自动重发 |
| `reconcile-apify JOB_KEY --run-id RUN_ID` | 核对 Console 后绑定不确定启动的现有 run，不启动新收费 run |
| `reconcile-apify JOB_KEY --no-run-confirmed` | 人工确认未启动后记录终止；当日不重新收费，下一日可新建 |

退出码：`0` 为该操作完成；`2` 为可检测的降级／未配置／窗口不全／投递阻塞；`1` 为无效输入、
配置或无法完成的操作；`130` 为中断。守护进程持续运行并输出降级状态，不会把未配置数据源变成正常。
CLI 的 `state`、报告的 `status` 和 outbox 的送达状态是不同层面的结果。

## 时间、成本和中断

- 业务周为 Sydney 当地周一零时到下周一零时，左闭右开；UTC 存储，夏令时周可为 167／169 小时。
  默认每天 06:00 采集，周一 08:00 周报，重启最多补两期；错过的日快照不伪造补回。
- 报告键为赛道、指纹、周末和修订号。相同键的报告不可变；补导数据或启用 AI 后需显式 `--revision 2`。
  修订是新的报告／通知，不会悄悄改写已发送内容。
- 默认每查询十条、复查二十条，每日 HTTP 上限一百二十次，安全读取最多重试两次；
  SerpApi 每日一次；Apify 每日最多发现／复查各一次。
- `ATB_ALLOW_PAID_PROVIDERS=false` 默认禁止收费后端；提供 token 不会自动授权收费。
  Apify 按每次费用上限预留月预算，不按未知失败退额度；默认上限以配置文件为准，
  单次最多 US$0.50、每月预留最多 US$31（覆盖三十一天每天两个最坏费用上限），
  **预留预算不是实际账单**。可下调这些上限，预算不足会明确阻塞；供应商账号仍应另设费用告警，
  其他程序的消费不受本机器人控制。
- AI 每日最多两次、默认最多八百输出 tokens；输入只含经限长／脱敏的公开标题、词典特征和引用。
  不发送原网站或完整私有成交导出。模型失败／无同意／无证据时明确降级。
- 收费 POST 和通知不盲目自动重试。SMTP 不承诺 exactly-once：中断后的 `sending`／`uncertain`
  必须先核对外部收件箱／接收端；`sent` 表示接收端接受，不是用户已读。

## 隔离与部署

本目录包含独立 Python 依赖、环境配置、SQLite 和 Compose project `au-trend-bot`。
不连接网站 MySQL，不读取其配置／数据，不占用端口，不修改原网站权限、交易状态或任何 marketplace 数据。
Compose 使用非 root 用户、只读代码、独立持久卷和有界资源；不挂载 Docker socket。

腾讯云准备、启动、日志、备份恢复和升级回滚见[部署手册](docs/deployment-tencent-cloud.md)。
需要用户提供服务器访问方式、所选数据服务凭证／授权和报告接收渠道后，才能完成目标机与真实来源验收。

代码入口：`cli.py`；采集：`providers.py`；时间／数据口径：`timeutil.py`、`analysis.py`；
持久化：`storage.py`；授权导入：`imports.py`；摘要／输出／投递：`ai.py`、`reports.py`、`delivery.py`；
日采周报：`service.py`。没有独立网页服务或新的前端页面。
