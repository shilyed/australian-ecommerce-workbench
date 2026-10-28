# 验收记录与未联调事项

日期：2026-10-28。环境：Windows，Python 3.12.1，机器人独立虚拟环境。
本页记录本地证据，**不是腾讯云部署、真实销量获取或第三方账号权限验收报告**。

## 已执行

| 项目 | 实际结果 |
| --- | --- |
| 需求先行 | 仅文档提交 `d0bfa1442061985bbb1993bbf5da79f34b88d58d` 已先 push，随后才编写实现 |
| 自动化测试 | `python -m unittest discover -s tests -t . -q`，**92 项通过** |
| 静态检查 | `ruff check au_trend_bot tests` 通过；`ruff format --check` 的 23 个 Python 文件均通过 |
| 无 key 端到端验收 | `python -m au_trend_bot demo --output <独立目录>`，十四项 checks 全 true，退出码 0 |
| 重复演示 | 同一目录再次运行成功，快照幂等，无网络预算记录／AI 调用／通知记录，`live_verified=false` |
| Python 包 | 构建 `au_trend_bot-1.0.0-py3-none-any.whl`；隔离安装后在源码目录外执行相同 DEMO 成功 |
| 包内容隔离 | wheel 仅包含 `au_trend_bot/` 和自身 dist-info，没有网站代码、凭证或运行数据 |
| 未配置状态 | `doctor` 实际返回 2 并逐项显示未配置；测试中的 collect、report、status 也验证降级退出码 |
| 网站隔离 | 与先行文档提交比较，`app/`、`deploy/`、根 Compose、根环境示例、`.github/` 和 `DESIGN.md` 无差异；根 README 仅新增入口 |

测试使用合成外部响应和临时数据库，不调用真实平台、DeepSeek、SMTP 或 webhook。
DEMO 中所有成交和互动数字均为合成数据，不能作为澳洲市场研究结果。

## 自动化覆盖

| 风险／口径 | 证据 |
| --- | --- |
| AU／UTC、夏令时 | Sydney 2026 春季 167 小时周、秋季 169 小时周、相邻当地周和 UTC 日期尚未跨周的边界 |
| 成交资格 | 左闭右开，恰好 end 的记录排除；非 AU／未知买家排除；站点／商品所在地不冒充买家国家 |
| 销量真实性 | 空成交是未知，估算／滚动三十天不入周成交，不从缺行计算成交环比 |
| 社媒增量 | 首期无基线、零值、部分区间、缺失、计数中途下降后恢复、两期完整快照比较 |
| Provider 时间近似 | actor run finishedAt 即使碰巧等于周边界，也不冒充逐条精确周边界计数 |
| 去重和外部冲突 | 跨关键词同 ID 合并，actor 重复对象冲突置未知，超限哨兵条目标记 partial，重复导入不重复计数；大量新发现不挤掉旧视频复查 |
| 搜索兴趣 | 单份归一化序列、两周各七日、拒绝跨请求拼接、部分／缺失／过期／错误粒度、上期为零 |
| 导入校验 | 明确授权、精确列、PII 列拒绝、坏行整批原子失败、带 offset 时间、不可变记录 ID、原始 AU CSV |
| 接口约束 | eBay OAuth／AU 头、Apify 输入和费用参数／actor/run ID、SerpApi 地区／查询／时区；错误类型不混为空成功 |
| 故障与费用 | 安全 GET 有界重试、收费请求不重试、原子预算、模糊启动停止重付费、已知 Apify run 跨日恢复 |
| 输出安全 | HTML／链接校验、CSV 公式防护、脱敏幂等、JSON 标量不会因字符串脱敏而损坏 |
| AI | 关闭／无同意不请求；限长公共输入不含私有成交导出；无效引用、数字／财务输出、截断、网络失败和中断不冒充成功 |
| 投递 | TLS 端口配置约束、空 204 webhook、稳定 key、已发送跳过、认证拒绝、模糊网络错误／中断后不自动重发、人工核对恢复 |
| 重启和持久化 | 重复 tick 不重复来源／通知，不伪造漏采日期；演示／主题身份隔离、单机锁、一致性备份及 outbox 保留 |
| 保留与健康 | 有界 prune 不删除幂等记录、备份 integrity_check、拒绝修改已有非 bot SQLite、心跳不冒充 provider 就绪 |

## 复现命令

先按本目录 README 建立独立虚拟环境并安装 `.[dev]`。以下是 PowerShell：

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -t . -q
.\.venv\Scripts\python.exe -m ruff check au_trend_bot tests
.\.venv\Scripts\python.exe -m ruff format --check au_trend_bot tests
.\.venv\Scripts\python.exe -m au_trend_bot demo
```

DEMO 同时验证 HTML／CSV／JSON 持久化和关键数据口径，自动检查失败会非零退出。
其 schema／数值不能代替真实 provider 权限验证。Linux 命令使用 `.venv/bin/python`。

## 尚未执行，不能据此宣称成功

- **Docker 构建／Compose 运行**：本机 `docker` 不存在，没有把静态配置文件当作容器验收。
  目标机需 Compose 2.30+，核对 raw env、非 root 写卷、资源限制、健康检查和重启。
- **腾讯云部署**：没有主机、SSH／登录授权或目标机环境信息；未安装服务、开放端口或修改网站。
- **真实 eBay／Apify／SerpApi**：没有用户独立凭证／权限／付费启用；只验证公开契约和合成响应，
  没有花费用户额度，也没有产出真实本周市场报告。
- **真实 DeepSeek 和通知**：没有 key／同意、SMTP 或接收端配置；错误和幂等路径已本地验证，
  但未进行真实调用、真实邮件最终送达或 webhook 接收方去重联调。
- **Instagram／Facebook**：明确未实现，等待适用账号及实际获批权限，不是首期已接通通道。
- **Linux 备份恢复演练／长期运行**：本地验证 SQLite backup／完整性及记录保留；
  目标机权限、实际恢复、外部已发送记录核对和长期日采需部署后验证。
- **原网站运行验收**：没有改动网站代码／依赖／部署，未启动或重新验证网站；文件隔离不等于替代网站自己的发布验收。

## 上线前最小输入

服务器系统／架构和用户许可的登录或代执行方式；可用资源；报告接收邮箱或 HTTPS 通道；
用户选择启用的独立 eBay、Apify、可选 SerpApi 凭证／额度，以及可选 DeepSeek key／公共摘要同意。
密钥在服务器私密环境文件配置，不发送到聊天。若要真实 AU 周销量，还需有权使用、
带买家国家和准确时间的成交数据；不能用在售或互动替代。

目标机验收和回退步骤见[部署手册](deployment-tencent-cloud.md)，数据限制见[数据契约](data-sources.md)。
