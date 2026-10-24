# 腾讯云部署说明

目标架构：

```text
Internet
  └─ Caddy :80/:443
       └─ Node/Hono app :3000（仅容器网络）
            └─ MySQL 8.4（仅容器网络，持久卷）
```

应用、数据库和管理端口都不直接暴露公网。Caddy 负责反向代理、压缩和 HTTPS；
MySQL、应用数据和 Caddy 证书分别保存在 Docker named volume 中。

## 1. 服务器要求

- Ubuntu 22.04 / 24.04 或 Debian 12
- 建议至少 2 vCPU / 2 GB 内存；首次构建 Node 依赖建议 4 GB 或临时增加 swap
- 系统盘至少 20 GB
- 安全组放行 SSH `22`，以及下面的 Web 端口

### 有域名

1. 域名 A 记录指向服务器公网 IP。
2. 中国大陆地域的服务器需要先完成 ICP 备案，否则 80/443 可能被拦截。
3. 安全组放行 `80`、`443`。
4. `.env` 使用：

```dotenv
SITE_ADDRESS=workbench.example.com
HTTP_PORT=80
HTTPS_PORT=443
APP_ORIGIN=https://workbench.example.com
```

Caddy 会自动申请并续期 Let's Encrypt 证书。

### 暂时没有域名

可以先用公网 IP + 非标准端口访问：

```dotenv
SITE_ADDRESS=:80
HTTP_PORT=8080
HTTPS_PORT=443
APP_ORIGIN=http://YOUR_SERVER_IP:8080
```

安全组还要放行 `8080`。这种方式可以正常登录和经营工作台，但 Etsy / eBay
OAuth 回调通常要求 HTTPS，正式绑定店铺前仍应配置域名和证书。

## 2. 安装 Docker

Ubuntu / Debian：

```bash
curl -fsSL https://get.docker.com | sh
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

退出 SSH 再重新登录，使 docker 组权限生效。验证：

```bash
docker version
docker compose version
```

如果服务器拉取 Docker Hub 镜像很慢，需要先在腾讯云容器镜像服务中配置加速器，
或给 Docker 配置可访问的 registry mirror。

## 3. 上传代码

推荐目录 `/opt/australian-ecommerce-workbench`。

```bash
sudo mkdir -p /opt/australian-ecommerce-workbench
sudo chown "$USER":"$USER" /opt/australian-ecommerce-workbench
git clone https://github.com/shilyed/australian-ecommerce-workbench.git \
  /opt/australian-ecommerce-workbench
cd /opt/australian-ecommerce-workbench
```

如果服务器访问 GitHub 不稳定，可以在本地打包后使用 `scp` 上传：

```bash
tar --exclude=.git --exclude=node_modules --exclude=dist \
  -czf aew.tar.gz .
scp aew.tar.gz USER@SERVER_IP:/opt/australian-ecommerce-workbench/
```

## 4. 配置环境变量

```bash
cp .env.example .env
```

至少修改：

- `SITE_ADDRESS`、`APP_ORIGIN`、`HTTP_PORT`
- `APP_SECRET`：`openssl rand -base64 48`
- `MYSQL_PASSWORD`、`MYSQL_ROOT_PASSWORD`：使用 `openssl rand -hex 24`，避免 URL 特殊字符
- `ADMIN_EMAIL`、`ADMIN_PASSWORD`、`ADMIN_NAME`

管理员密码至少 12 位，同时包含字母和数字。`ADMIN_PASSWORD` 只用于首次创建，
创建成功后建议从 `.env` 删除并重启应用。

## 5. 首次部署

```bash
# 1) 构建镜像
docker compose build

# 2) 启动数据库并等待 healthy
docker compose up -d mysql
docker compose ps

# 3) 按 schema 创建 / 升级数据库结构
docker compose --profile tools run --rm db-init

# 4) 启动应用和反向代理
docker compose up -d app caddy

# 5) 检查
docker compose ps
docker compose logs -f app
```

浏览器打开 `APP_ORIGIN`。如果配置了 `ADMIN_*`，直接使用管理员邮箱和密码登录；
未配置时，首次打开 `/login` 会显示管理员初始化表单。

健康检查：

```bash
curl -fsS http://127.0.0.1:8080/api/health
```

端口按 `.env` 中的 `HTTP_PORT` 调整。

## 6. 升级

升级前先备份数据库：

```bash
mkdir -p backups
docker compose exec -T mysql sh -c \
  'mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --triggers "$MYSQL_DATABASE"' \
  > "backups/aew-$(date +%Y%m%d-%H%M%S).sql"
```

然后：

```bash
git pull
docker compose build
docker compose --profile tools run --rm db-init
docker compose up -d app caddy
docker compose ps
```

`db-init` 会按当前 schema 对齐数据库。涉及删列、改类型等潜在数据变更时，
先阅读代码变更并在测试库演练，不要直接对生产库强制同步。

### 纯前端外观升级

确认数据库 schema 和后端契约未变化时，只需构建和更新 `app` 服务，不必执行
`db-init`，也不要重建或清空 MySQL / 附件数据卷。切换前保留旧镜像、源码版本、
数据库备份和 `.env` 校验值；健康检查不通过时回滚应用镜像与源码，不覆盖业务数据。

腾讯云「执行命令」默认超时为 60 秒，完整镜像构建可能超过该时间。执行部署前应确认
提交给自动化助手的命令超时已设为足够的时长（例如 900 秒）；不要把构建中途超时
误认为已部署完成。若服务器拉取 GitHub 不稳定，可使用校验过 SHA256 的增量
Git bundle 导入同一已评审提交，再离线校验提交版本，避免覆盖服务器未提交改动。

## 7. 备份

数据库和附件分别位于 named volume：

- `australian-ecommerce-workbench_mysql_data`
- `australian-ecommerce-workbench_app_data`

数据库至少每日 `mysqldump` 到服务器其他目录或对象存储。附件目录也应定期打包备份。
Caddy 证书不需要手工备份，重新申请即可。

## 8. 常见问题

### 页面能打开但登录报数据库错误

先看 `docker compose logs mysql` 和 `docker compose logs app`，确认 `db-init` 已成功执行。

### 登录成功后又回到登录页

- 检查 `APP_ORIGIN` 是否与实际访问地址完全一致（协议、域名、端口）
- 如果前面还有一层 CDN / 负载均衡，确认它传递 `X-Forwarded-Proto: https`
- 检查浏览器是否拦截了 Secure Cookie

### Caddy 申请证书失败

- 域名 A 记录是否已生效：`dig +short workbench.example.com`
- 安全组是否放行 80/443
- 中国大陆服务器是否完成 ICP 备案
- 查看 `docker compose logs caddy`

### 想重置管理员密码

登录管理员后，在「系统设置 → 成员与角色」重置密码。若完全无法登录，
在服务器仓库目录执行：

```bash
docker compose exec -T \
  -e EMAIL=admin@example.com \
  -e NEW_PASSWORD='NewPassword123' \
  app npm run db:set-password
```

该命令只更新现有账号的密码并让旧会话失效，不会删除业务数据。
注意生产镜像默认只包含运行时代码；如果镜像中没有 `db/set-password.mjs`，
可直接在宿主机仓库的 `app/` 目录用同一个 `DATABASE_URL` 执行：

```bash
cd app
EMAIL=admin@example.com NEW_PASSWORD='NewPassword123' \
  DATABASE_URL='mysql://...' node db/set-password.mjs
```
