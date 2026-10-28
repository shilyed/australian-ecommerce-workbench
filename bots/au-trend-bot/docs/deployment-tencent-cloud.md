# 腾讯云 Linux 独立部署手册

**交付的是可部署代码和步骤，不是线上部署证明。** 当前没有服务器地址／SSH 授权、
用户的数据来源凭证或投递配置；开发机也没有 Docker CLI，镜像构建与以下容器操作尚未实际运行。
不要把离线 DEMO、静态文件检查或配置 ready 当作服务器／真实来源验收。

## 1. 前提与隔离

- 用户控制的 Linux 服务器、可授权的 SSH／终端访问、可拉取 PyPI 和 Docker 基础镜像的网络。
  不要在聊天发送密码、私钥或 API key；用户可自行登录后由终端执行。
- Docker Engine 与 **Compose plugin 2.30+**；`env_file.format: raw` 用于保留密钥中的 `$`，
  不把密码当 Compose 模板展开。先检查 `docker version` 和 `docker compose version`。
- 至少评估额外 512 MiB 容器内存、镜像／数据／备份磁盘和外部网络余量；限制值不是主机容量证明。
  现有网站和 MySQL 所需资源不包含在内，先确认 `free -h`、`df -h`。
- 不新增任何入站端口或安全组规则，不占用网站 80／443，不改 Caddy／网站 MySQL。
  只需出站 HTTPS 及选用的 SMTP TLS 端口。不要挂载 Docker socket。

下文全是 **目标 Linux 上的 Bash 命令**。所有 Compose 命令都显式使用
`-p au-trend-bot -f compose.yml`，绝不在网站根目录调用其根 Compose。
持久卷是 `au-trend-bot_trend_data`，不是网站卷；本机器人进程 UID/GID 为 `10001:10001`。

## 2. 独立检出与配置

使用单独目录，不覆盖网站运行中的检出；生产最终应固定到已评审提交。

```bash
git clone --branch shilyed-au-trend-bot --single-branch https://github.com/shilyed/australian-ecommerce-workbench.git au-trend-bot-repo
cd au-trend-bot-repo/bots/au-trend-bot
cp config.example.toml config.toml
cp .env.example .env
mkdir -p inputs
chmod 600 .env
chmod 644 config.toml
```

在服务器编辑器填入独立 `.env`。值建议不加引号、无前后空格，`$` 为字面量。
不要 `source .env`、不要把密钥写入命令历史，也不要输出 `docker inspect` 或完整
`docker compose config` 到聊天／日志。配置检查只用 `config --quiet`。

默认没有凭证也未授权收费，只有离线演示可完整验收。用户自行选择：

| 配置 | 作用 |
| --- | --- |
| `ATB_EBAY_CLIENT_ID/SECRET` 或 `ATB_EBAY_ACCESS_TOKEN` | 机器人独立 Browse 应用；不是网站凭证 |
| `ATB_APIFY_TOKEN`、可选 `ATB_SERPAPI_KEY` | 用户自己的服务账号，不自动订阅／购买 |
| `ATB_ALLOW_PAID_PROVIDERS=true` | 明确允许按本机器人限制调用上述后端；先确认供应商配额 |
| `ATB_NOTIFICATION=smtp` 及 SMTP 字段 | TLS 465 或 587，自己的接收邮箱 |
| `ATB_NOTIFICATION=webhook` 及 HTTPS URL／可选 Bearer | 用户控制的通知接收端，按幂等 key 去重 |
| `ATB_AI_ENABLED=true`、`ATB_AI_PUBLIC_EVIDENCE_CONSENT=true`、DeepSeek key | 可选 AI；默认关闭，不阻塞确定性报告 |

在 `config.toml` 设置赛道、数量／费用上限和当地调度时间。默认 Sydney 每日 06:00，
周一 08:00，最多补两期完整周。更换赛道／词典／关键词会产生新指纹，
应采用新的 Compose project／持久卷，不能在旧卷强行混跑新赛道。

## 3. 构建和验收

```bash
docker compose -p au-trend-bot -f compose.yml config --quiet
docker compose -p au-trend-bot -f compose.yml build --pull bot
docker compose -p au-trend-bot -f compose.yml run --rm --no-deps bot --config /opt/bot/config.toml demo --output /tmp/offline-demo
docker compose -p au-trend-bot -f compose.yml run --rm --no-deps bot --config /opt/bot/config.toml doctor
```

演示的所有 `checks` 应为 true，退出码 `0`，且 `live_verified=false`。
该容器演示写到 `/tmp`，容器退出后不会保留；要查看长期演示 HTML，使用 README 的本地 Python
命令输出到独立 `demo-output`。不能向正式 `/data` 写演示数据库或把 DEMO 发送给客户。

`doctor` 只检查配置，不是网络探测。无凭证返回 `2` 是预期的可检测阻塞，不得改代码掩盖。
具备授权及额度后，才执行一次真实采集：

```bash
docker compose -p au-trend-bot -f compose.yml run --rm --no-deps bot --config /opt/bot/config.toml collect
docker compose -p au-trend-bot -f compose.yml run --rm --no-deps bot --config /opt/bot/config.toml report
```

采集处于 `pending` 时是外部 actor 仍在运行；再次 `collect` 会继续同一 run，不重新收费启动。
异常后先检查 `status`，需要时 `collect --retry`。当日安全采集重试有次数限制，
SerpApi 失败不会在同一天盲目再收费；Apify 不确定启动必须人工核对。
第一周没有历史基线是正常边界：报告应显示未知／部分覆盖，而不是凭空给完整周增长。

## 4. 常驻运行与文件取出

```bash
docker compose -p au-trend-bot -f compose.yml up -d --no-deps bot
docker compose -p au-trend-bot -f compose.yml ps
docker compose -p au-trend-bot -f compose.yml logs --tail 100 bot
docker compose -p au-trend-bot -f compose.yml exec -T bot python -m au_trend_bot --config /opt/bot/config.toml status
docker compose -p au-trend-bot -f compose.yml exec -T bot python -m au_trend_bot --config /opt/bot/config.toml health --scheduler-only
```

Compose 的 healthcheck 只判断调度是否近期响应，**不证明平台权限／样本完整／邮件送达**；
用 `status` 和不带 `--scheduler-only` 的 `health` 检查数据就绪，降级返回 `2`。
Docker 本身不会仅因 unhealthy 自动重启容器；应监控状态与日志，不把 restart policy 当数据质量监控。
日志轮转上限三份，每份 10 MiB。进程异常退出由 `unless-stopped` 重启，
SQLite／run ID／预算／outbox 位于独立卷。

程序内已做日采周报，不要额外同时运行第二个 cron。单机锁阻止相同卷并行修改。
重启后仅采集当前真实快照，漏采日期显示覆盖缺口；历史周报只根据已有证据有限补跑。
进程较长时间运行或外部网络缓慢时也应监控容器健康与最近尝试时间。

文件在 `/data/reports/<report-key>.html/.csv/.json`：

```bash
docker compose -p au-trend-bot -f compose.yml cp bot:/data/reports ./reports-export
```

不要经不受保护的公网静态目录发布报告。邮件 `report --send` 会附 HTML／CSV，
webhook JSON 包含内容；不依赖临时本地路径让接收者自行访问服务器。
手动生成／投递示例：

```bash
docker compose -p au-trend-bot -f compose.yml exec -T bot python -m au_trend_bot --config /opt/bot/config.toml report --send
```

同一周同一修订重复执行不重复发送。补导数据、修复来源或打开 AI 后若要更新已生成报告，
显式加 `--revision 2`，它会成为新报告／新通知，操作者应知晓会再次投递。

## 5. 授权导入

只读挂载的 `inputs` 不应包含个人买家信息。对于需要私密读取的文件，给容器用户权限，
而不是全局开放，例如：

```bash
sudo chown 10001:10001 inputs/authorized.csv
sudo chmod 400 inputs/authorized.csv
docker compose -p au-trend-bot -f compose.yml exec -T bot python -m au_trend_bot --config /opt/bot/config.toml import-sales /imports/authorized.csv --provenance "authorized export" --authorized
```

目录本身还需对 UID 10001 有读／遍历权限；必要时用该目录专用 ACL，不开放其他业务目录。
完整列、时间、AU 证据和 Google CSV 命令见[数据契约](data-sources.md)。
导入文件不是自动采集证明；未经许可的账号或缺失权限不能靠导入流程绕过。

## 6. 失败和不确定发送

`status` 中 provider 的 `unconfigured`／`blocked`／`failed`、报告 `degraded`、
outbox 的 `uncertain` 都需要处理。已配置渠道按每日来源去重发送告警；
无渠道只能依赖容器日志／状态／退出码，不承诺不存在的外部告警。

SMTP／webhook 发送前先写 `sending`。若发送后崩溃，接收端可能已收到，但本地未确认；
系统保守停在不确定状态，不自动重发。用户核对邮箱／接收端后执行：

```text
python -m au_trend_bot --config /opt/bot/config.toml resolve-delivery <report-key> --outcome sent
python -m au_trend_bot --config /opt/bot/config.toml resolve-delivery <report-key> --outcome retry
```

二选一，不要连续执行。`sent` 表示人工确认；`retry` 允许下一次明确／定时投递。
固定 Message-ID 和 webhook Idempotency-Key 是辅助去重，SMTP 并无严格 exactly-once 保证。
Apify 模糊启动的处理见数据契约；不得删除任务键来强行重启收费 run。

## 7. 一致性备份和恢复

不要直接复制正在写入的 `trend.sqlite3`，WAL 中可能有未复制记录。CLI 使用 SQLite backup API：

```bash
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
docker compose -p au-trend-bot -f compose.yml exec -T bot python -m au_trend_bot --config /opt/bot/config.toml backup --output "/data/backups/$STAMP.sqlite3"
mkdir -p backups
docker compose -p au-trend-bot -f compose.yml cp "bot:/data/backups/$STAMP.sqlite3" "./backups/$STAMP.sqlite3"
chmod 600 "./backups/$STAMP.sqlite3"
```

如果单机任务锁正忙，备份命令会显式失败；待当次采集结束再执行，不杀掉整个网站或删锁文件。
另外备份报告目录与非密钥配置；密钥只进用户控制的加密配置备份，不进 git 或普通报告包。
同卷 `/data/backups` 不是异地备份，需复制到用户控制的离机加密存储。
定期恢复演练；保留与程序提交和配置指纹相匹配的备份。

恢复会覆盖机器人自己的当前数据库，必须先备份当前状态并**停止本机器人及其他使用同卷的临时命令**，
不影响网站。以下示例将选定备份复制到专用只读导入目录，再用 SQLite API 恢复，
避免手工覆盖数据库和残留 WAL 不一致。把 `CHOSEN.sqlite3` 替换为明确文件名，不使用通配符：

```bash
docker compose -p au-trend-bot -f compose.yml stop bot
sudo install -o 10001 -g 10001 -m 0400 backups/CHOSEN.sqlite3 inputs/restore.sqlite3
docker compose -p au-trend-bot -f compose.yml run --rm --no-deps --entrypoint python bot -c 'import sqlite3; from contextlib import closing; src=sqlite3.connect("file:/imports/restore.sqlite3?mode=ro",uri=True); assert src.execute("PRAGMA integrity_check").fetchone()[0]=="ok"; dst=sqlite3.connect("/data/trend.sqlite3"); src.backup(dst); dst.close(); src.close()'
docker compose -p au-trend-bot -f compose.yml run --rm --no-deps bot --config /opt/bot/config.toml status
```

必须检查指纹、来源、run ID 和 outbox。**旧备份会回退本地发送记录**：
启动调度前核对备份后已经投递的周报，在本地生成对应报告并用 `resolve-delivery ... --outcome sent`
补录人工确认，避免把已经送过的报告再次投递。不要用 `--outcome retry` 代替核对。
确认后再 `up -d --no-deps bot`。`inputs/restore.sqlite3` 是明确的临时文件，演练结束可单独删除。

`prune --days 90` 只删历史快照／搜索响应，至少保留三十天，不删除成交、报告或投递／预算任务记录。
报告、授权成交与备份的长期保留和离机清理应按用户自己的合规政策操作，别递归删除卷或仓库。

## 8. 升级、回滚和停止

先记录当前 `git rev-parse HEAD` 并做一致性备份，确认无外部不确定 run／发送。
在**机器人独立检出** fetch 并切到已评审提交，保留未跟踪的私密 `.env`、`config.toml`：

```bash
git fetch origin
git switch --detach REVIEWED_COMMIT
docker compose -p au-trend-bot -f compose.yml build --pull bot
docker compose -p au-trend-bot -f compose.yml up -d --no-deps bot
```

检查 health、status 和最近报告，不因为容器“running”就宣布真实来源通过。
当前 schema 为 1；未来跨 schema 升级必须有明确迁移方案，本版本不静默迁移不同主题或模式。
回滚先停止 bot、切回记录的旧提交并重建；只有确认数据库版本兼容时才复用当前数据，
否则按上节恢复匹配备份并核对备份后外部副作用。

停止仅运行：

```bash
docker compose -p au-trend-bot -f compose.yml stop bot
```

不要对网站根 Compose 执行命令，不要 `down -v`，不改网站端口／凭证／卷。
目标机验收至少包括：真实 provider 权限、两次运行去重、来源失败告警、报告投递、
容器重启恢复、AU 时区与覆盖、备份恢复、原网站仍正常。
