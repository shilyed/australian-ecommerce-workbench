import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  KeyRound,
  Monitor,
  Moon,
  PlugZap,
  RefreshCw,
  ShieldCheck,
  Sun,
  Users,
} from "lucide-react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/workbench/PageHeader";
import { EmptyPanel, LoadingPanel } from "@/components/workbench/States";
import { StatusPill } from "@/components/workbench/StatusPill";
import { StoreIntegrationCard } from "@/components/workbench/StoreIntegrationCard";
import { dateTime, label } from "@/lib/format";
import { useWorkspace } from "@/hooks/useWorkspace";
import { trpc } from "@/providers/trpc";
import { useTheme } from "@/providers/theme-context";

const ROLE_TEXT: Record<string, string> = {
  admin: "管理员：全部权限，含成员与写回设置",
  operations: "运营：选品、采购、商品、订单、发货与售后",
  fulfillment: "履约：订单、发货、售后；成本与财务不可见",
  finance: "财务：成本、汇率、利润与结算；其他模块只读",
};

export default function SettingsPage() {
  const { data, isLoading, error, refresh, refetch } = useWorkspace();
  const [syncStore, setSyncStore] = useState<string>("");
  const [syncType, setSyncType] = useState<string>("orders");

  const updateStore = trpc.workbench.updateStoreConnection.useMutation({
    onSuccess: async () => {
      toast.success("店铺连接状态已保存，并写入审计日志");
      await refresh();
    },
    onError: err => toast.error(err.message),
  });
  const createSync = trpc.workbench.createSyncJob.useMutation({
    onSuccess: async () => {
      toast.success("读取任务已进入队列");
      await refresh();
    },
    onError: err => toast.error(err.message),
  });
  const updateMember = trpc.workbench.updateMemberRole.useMutation({
    onSuccess: async () => {
      toast.success("成员角色已更新");
      await refresh();
    },
    onError: err => toast.error(err.message),
  });
  const createMember = trpc.auth.createMember.useMutation({
    onSuccess: async () => {
      toast.success("成员账号已创建，可以把邮箱和初始密码交给对方");
      await refresh();
    },
    onError: err => toast.error(err.message),
  });
  const resetMemberPassword = trpc.auth.resetMemberPassword.useMutation({
    onSuccess: async () => {
      toast.success("登录密码已重置，旧会话已失效");
      await refresh();
    },
    onError: err => toast.error(err.message),
  });
  const changePassword = trpc.auth.changePassword.useMutation({
    onSuccess: async () => {
      toast.success("登录密码已更新");
      await refresh();
    },
    onError: err => toast.error(err.message),
  });

  const [searchParams, setSearchParams] = useSearchParams();
  const handledResult = useRef<string | null>(null);
  const { mode, setMode, resolvedTheme } = useTheme();
  const providerQuery = trpc.integrations.providers.useQuery({
    origin: window.location.origin,
  });
  const refreshProfile = trpc.integrations.refreshProfile.useMutation({
    onSuccess: async profile => {
      toast.success(
        `已从 ${profile.platform === "etsy" ? "Etsy" : "eBay"} 读取最新店铺数据`
      );
      await refresh();
    },
    onError: err => toast.error(err.message),
  });
  const disconnectStore = trpc.integrations.disconnect.useMutation({
    onSuccess: async () => {
      toast.success("已断开官方授权，历史业务数据保留");
      await refresh();
    },
    onError: err => toast.error(err.message),
  });

  useEffect(() => {
    const status = searchParams.get("status");
    const integration = searchParams.get("integration");
    if (!status || !integration) return;
    const resultKey = searchParams.toString();
    if (handledResult.current === resultKey) return;
    handledResult.current = resultKey;
    const platformName = integration === "etsy" ? "Etsy" : "eBay";
    if (status === "connected") {
      toast.success(
        `${platformName} 店铺已连接：${searchParams.get("shop") ?? "已读取店铺信息"}`
      );
    } else if (status === "cancelled") {
      toast.info(`已取消 ${platformName} 授权，未做任何更改`);
    } else if (status === "error") {
      toast.error(
        `${platformName} 连接失败：${searchParams.get("message") ?? "未知错误"}`
      );
    }
    const next = new URLSearchParams(searchParams);
    ["integration", "status", "shop", "message"].forEach(key =>
      next.delete(key)
    );
    setSearchParams(next, { replace: true });
    void refresh();
  }, [searchParams, setSearchParams, refresh]);

  if (isLoading) return <LoadingPanel />;
  if (error || !data)
    return (
      <EmptyPanel
        title="设置加载失败"
        description={error?.message ?? "未知错误"}
        action={<Button onClick={() => refetch()}>重试</Button>}
      />
    );

  const isAdmin = data.permissions.settings;

  const submitStore = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const shipping = form.get("shippingWriteback") === "on";
    const inventory = form.get("inventoryWriteback") === "on";
    updateStore.mutate({
      platform: String(form.get("platform")) as "etsy" | "ebay",
      externalShopId: String(form.get("externalShopId") ?? ""),
      shopName: String(form.get("shopName") ?? ""),
      authorizationStatus: String(form.get("authorizationStatus")) as
        "not_connected" | "authorized" | "expired" | "revoked",
      shippingWritebackEnabled: shipping,
      inventoryWritebackEnabled: inventory,
      writebackMode:
        shipping || inventory
          ? (String(form.get("writebackMode")) as
              "system_controlled" | "manual_confirm")
          : undefined,
      errorSummary: String(form.get("errorSummary") ?? "") || undefined,
    });
    event.currentTarget.reset();
  };

  return (
    <div>
      <PageHeader
        eyebrow="SYSTEM / GOVERNANCE"
        title="系统设置"
        description="店铺授权、写回开关、成员角色、同步任务与审计日志集中在这里。平台写回属于 P0-B 能力，默认关闭，开启前必须单独验证。"
        actions={
          <Button
            variant="outline"
            className="min-h-11"
            onClick={() => refetch()}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            刷新
          </Button>
        }
      />

      {!isAdmin && (
        <div className="ops-panel mb-4 border-amber-500/30 p-4 text-sm leading-6 text-amber-200">
          当前角色不是管理员：可以查看授权与同步状态，但店铺写回开关和成员角色由服务端拦截，只有管理员可修改。
        </div>
      )}

      <section className="ops-panel mb-4">
        <div className="ops-panel-header">
          <div>
            <h2 className="ops-title flex items-center gap-2">
              <PlugZap className="h-4 w-4 text-primary" />
              平台官方直连（Etsy / eBay）
            </h2>
            <p className="ops-subtitle">
              用平台账号完成 OAuth
              授权，工作台自动读取店铺名称、在售刊登、订单与额度；令牌加密存储在服务端，前端永远拿不到。
            </p>
          </div>
          <Badge
            variant="outline"
            className="border-primary/30 bg-primary/10 text-primary"
          >
            OAuth 2.0
          </Badge>
        </div>
        <div className="grid gap-4 p-4 xl:grid-cols-2">
          <StoreIntegrationCard
            platform="etsy"
            provider={providerQuery.data?.providers.find(
              provider => provider.platform === "etsy"
            )}
            providerLoading={providerQuery.isLoading}
            stores={data.stores.filter(store => store.platform === "etsy")}
            isAdmin={isAdmin}
            onRefresh={storeId =>
              refreshProfile.mutate({ storeConnectionId: storeId })
            }
            onDisconnect={storeId =>
              disconnectStore.mutate({ storeConnectionId: storeId })
            }
            refreshPending={refreshProfile.isPending}
            disconnectPending={disconnectStore.isPending}
          />
          <StoreIntegrationCard
            platform="ebay"
            provider={providerQuery.data?.providers.find(
              provider => provider.platform === "ebay"
            )}
            providerLoading={providerQuery.isLoading}
            stores={data.stores.filter(store => store.platform === "ebay")}
            isAdmin={isAdmin}
            onRefresh={storeId =>
              refreshProfile.mutate({ storeConnectionId: storeId })
            }
            onDisconnect={storeId =>
              disconnectStore.mutate({ storeConnectionId: storeId })
            }
            refreshPending={refreshProfile.isPending}
            disconnectPending={disconnectStore.isPending}
          />
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="ops-panel">
          <div className="ops-panel-header">
            <div>
              <h2 className="ops-title flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-primary" />
                手工登记店铺（兜底）
              </h2>
              <p className="ops-subtitle">
                没有官方应用凭证时的兜底方案：只登记元数据，不会访问平台接口。优先使用上方的官方直连。
              </p>
            </div>
          </div>
          <div className="space-y-3 p-4">
            {data.stores.map(store => (
              <div
                key={store.id}
                className="rounded-lg border border-border/60 bg-secondary/40 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold">{store.shopName}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {label(store.platform)} · 店铺 ID {store.externalShopId}
                    </p>
                  </div>
                  <StatusPill value={store.authorizationStatus} />
                </div>
                <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                  <span>
                    最近尝试：
                    {store.lastAttemptAt ? dateTime(store.lastAttemptAt) : "—"}
                  </span>
                  <span>
                    最近成功：
                    {store.lastSuccessAt ? dateTime(store.lastSuccessAt) : "—"}
                  </span>
                  <span>
                    发货写回：
                    {store.shippingWritebackEnabled ? "开启" : "关闭（默认）"}
                  </span>
                  <span>
                    库存写回：
                    {store.inventoryWritebackEnabled ? "开启" : "关闭（默认）"}
                  </span>
                  <span>
                    写回模式：
                    {store.writebackMode
                      ? label(store.writebackMode)
                      : "未启用"}
                  </span>
                  <span>积压：{store.backlogCount} 条</span>
                </div>
                {store.errorSummary && (
                  <p className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 p-2 text-xs leading-5 text-red-200">
                    {store.errorSummary}
                  </p>
                )}
              </div>
            ))}
            {data.stores.length === 0 && (
              <p className="text-sm text-muted-foreground">
                尚未登记任何店铺。
              </p>
            )}
          </div>

          {isAdmin && (
            <form
              onSubmit={submitStore}
              className="space-y-3 border-t border-border/60 p-4"
            >
              <p className="text-sm font-semibold">
                登记 / 更新店铺元数据（管理员）
              </p>
              <p className="text-xs leading-5 text-muted-foreground">
                已通过 OAuth
                直连的店铺，其授权状态由平台令牌决定，手工表单不会覆盖。
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="ops-label" htmlFor="platform">
                    平台
                  </label>
                  <select
                    id="platform"
                    name="platform"
                    className="ops-input min-h-11"
                    defaultValue="etsy"
                  >
                    <option value="etsy">Etsy</option>
                    <option value="ebay">eBay</option>
                  </select>
                </div>
                <div>
                  <label className="ops-label" htmlFor="externalShopId">
                    外部店铺 ID
                  </label>
                  <Input
                    id="externalShopId"
                    name="externalShopId"
                    required
                    className="min-h-11"
                    placeholder="如 etsy-shop-01"
                  />
                </div>
                <div>
                  <label className="ops-label" htmlFor="shopName">
                    店铺名称
                  </label>
                  <Input
                    id="shopName"
                    name="shopName"
                    required
                    className="min-h-11"
                  />
                </div>
                <div>
                  <label className="ops-label" htmlFor="authorizationStatus">
                    授权状态
                  </label>
                  <select
                    id="authorizationStatus"
                    name="authorizationStatus"
                    className="ops-input min-h-11"
                    defaultValue="not_connected"
                  >
                    <option value="not_connected">未连接</option>
                    <option value="authorized">已授权</option>
                    <option value="expired">已过期</option>
                    <option value="revoked">已撤销</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="ops-label" htmlFor="errorSummary">
                    异常摘要（可选，不写凭证）
                  </label>
                  <Input
                    id="errorSummary"
                    name="errorSummary"
                    className="min-h-11"
                    placeholder="例如：令牌已过期，需重新授权"
                  />
                </div>
              </div>
              <div className="grid gap-3 rounded-lg border border-border/60 bg-secondary/30 p-3 sm:grid-cols-2">
                <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
                  发货确认写回
                  <Switch name="shippingWriteback" />
                </label>
                <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
                  库存数量写回
                  <Switch name="inventoryWriteback" />
                </label>
                <div className="sm:col-span-2">
                  <label className="ops-label" htmlFor="writebackMode">
                    写回模式（开启写回时必选）
                  </label>
                  <select
                    id="writebackMode"
                    name="writebackMode"
                    className="ops-input min-h-11"
                    defaultValue="manual_confirm"
                  >
                    <option value="manual_confirm">人工确认后写回</option>
                    <option value="system_controlled">系统主控写回</option>
                  </select>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    P0-B
                    写回能力需独立验证后启用；写回失败不会回滚真实发货事实，也不会重复扣减库存。
                  </p>
                </div>
              </div>
              <Button
                type="submit"
                className="min-h-11 w-full sm:w-auto"
                disabled={updateStore.isPending}
              >
                {updateStore.isPending ? "保存中…" : "保存店铺连接"}
              </Button>
            </form>
          )}
        </section>

        <section className="ops-panel">
          <div className="ops-panel-header">
            <div>
              <h2 className="ops-title flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" />
                成员与角色
              </h2>
              <p className="ops-subtitle">
                角色权限在服务端强制执行，前端隐藏按钮只是体验层
              </p>
            </div>
          </div>
          <div className="space-y-3 p-4">
            {isAdmin && (
              <details className="rounded-lg border border-primary/25 bg-primary/5 p-3">
                <summary className="cursor-pointer text-sm font-semibold text-primary">
                  添加成员账号
                </summary>
                <form
                  className="mt-3 grid gap-3 sm:grid-cols-2"
                  onSubmit={event => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    createMember.mutate({
                      name: String(form.get("name") ?? ""),
                      email: String(form.get("email") ?? ""),
                      password: String(form.get("password") ?? ""),
                      businessRole: String(form.get("businessRole")) as
                        "admin" | "operations" | "fulfillment" | "finance",
                      reason: String(form.get("reason") ?? ""),
                    });
                    event.currentTarget.reset();
                  }}
                >
                  <div>
                    <label className="ops-label" htmlFor="member-name">
                      姓名
                    </label>
                    <Input
                      id="member-name"
                      name="name"
                      required
                      className="min-h-11"
                    />
                  </div>
                  <div>
                    <label className="ops-label" htmlFor="member-email">
                      登录邮箱
                    </label>
                    <Input
                      id="member-email"
                      name="email"
                      type="email"
                      required
                      className="min-h-11"
                    />
                  </div>
                  <div>
                    <label className="ops-label" htmlFor="member-password">
                      初始密码
                    </label>
                    <Input
                      id="member-password"
                      name="password"
                      type="password"
                      required
                      minLength={12}
                      maxLength={128}
                      autoComplete="new-password"
                      className="min-h-11"
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      至少 12 位，包含字母和数字。
                    </p>
                  </div>
                  <div>
                    <label className="ops-label" htmlFor="member-role">
                      业务角色
                    </label>
                    <select
                      id="member-role"
                      name="businessRole"
                      className="ops-input min-h-11"
                      defaultValue="operations"
                    >
                      <option value="operations">运营</option>
                      <option value="fulfillment">履约</option>
                      <option value="finance">财务</option>
                      <option value="admin">管理员</option>
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="ops-label" htmlFor="member-reason">
                      创建原因（写入审计）
                    </label>
                    <Input
                      id="member-reason"
                      name="reason"
                      required
                      minLength={3}
                      placeholder="例如：新增悉尼仓履约同事"
                      className="min-h-11"
                    />
                  </div>
                  <Button
                    type="submit"
                    className="min-h-11 sm:col-span-2"
                    disabled={createMember.isPending}
                  >
                    {createMember.isPending ? "创建中…" : "创建成员账号"}
                  </Button>
                </form>
              </details>
            )}

            {data.members.map(member => (
              <div
                key={member.id}
                className="rounded-lg border border-border/60 bg-secondary/40 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold">
                      {member.name ?? "未命名成员"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {member.loginEmail ?? member.email ?? "未绑定登录邮箱"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={
                        member.hasPassword
                          ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-300"
                          : ""
                      }
                    >
                      {member.hasPassword ? "密码登录已启用" : "未启用密码"}
                    </Badge>
                    <Badge variant="outline">
                      {label(member.businessRole)}
                    </Badge>
                    <StatusPill value={member.status} />
                  </div>
                </div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  {ROLE_TEXT[member.businessRole]}
                </p>
                {isAdmin && member.id !== data.currentUser.id && (
                  <form
                    className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_2fr_auto]"
                    onSubmit={event => {
                      event.preventDefault();
                      const form = new FormData(event.currentTarget);
                      updateMember.mutate({
                        userId: member.id,
                        businessRole: String(form.get("businessRole")) as
                          "admin" | "operations" | "fulfillment" | "finance",
                        status: String(form.get("status")) as
                          "active" | "disabled",
                        reason: String(form.get("reason") ?? ""),
                      });
                    }}
                  >
                    <select
                      name="businessRole"
                      className="ops-input min-h-11"
                      defaultValue={member.businessRole}
                      aria-label="业务角色"
                    >
                      <option value="admin">管理员</option>
                      <option value="operations">运营</option>
                      <option value="fulfillment">履约</option>
                      <option value="finance">财务</option>
                    </select>
                    <select
                      name="status"
                      className="ops-input min-h-11"
                      defaultValue={member.status}
                      aria-label="状态"
                    >
                      <option value="active">启用</option>
                      <option value="disabled">停用</option>
                    </select>
                    <Input
                      name="reason"
                      required
                      minLength={3}
                      placeholder="变更原因（写入审计）"
                      className="min-h-11"
                      aria-label="变更原因"
                    />
                    <Button
                      type="submit"
                      variant="outline"
                      className="min-h-11"
                      disabled={updateMember.isPending}
                    >
                      更新
                    </Button>
                  </form>
                )}
                {isAdmin && member.id !== data.currentUser.id && (
                  <details className="mt-3 rounded-md border border-border/60 bg-background/40 p-3">
                    <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">
                      设置 / 重置登录密码
                    </summary>
                    <form
                      className="mt-3 grid gap-2 sm:grid-cols-[1.2fr_1fr_1.4fr_auto]"
                      onSubmit={event => {
                        event.preventDefault();
                        const form = new FormData(event.currentTarget);
                        resetMemberPassword.mutate({
                          userId: member.id,
                          email: String(form.get("email") ?? "") || undefined,
                          newPassword: String(form.get("newPassword") ?? ""),
                          reason: String(form.get("reason") ?? ""),
                        });
                        event.currentTarget.reset();
                      }}
                    >
                      <Input
                        name="email"
                        type="email"
                        defaultValue={member.loginEmail ?? member.email ?? ""}
                        placeholder="登录邮箱"
                        className="min-h-11"
                        aria-label="登录邮箱"
                      />
                      <Input
                        name="newPassword"
                        type="password"
                        required
                        minLength={12}
                        maxLength={128}
                        placeholder="新密码（至少 12 位）"
                        autoComplete="new-password"
                        className="min-h-11"
                        aria-label="新密码"
                      />
                      <Input
                        name="reason"
                        required
                        minLength={3}
                        placeholder="重置原因"
                        className="min-h-11"
                        aria-label="重置原因"
                      />
                      <Button
                        type="submit"
                        variant="outline"
                        className="min-h-11"
                        disabled={resetMemberPassword.isPending}
                      >
                        重置
                      </Button>
                    </form>
                  </details>
                )}
              </div>
            ))}

            <details className="rounded-lg border border-border/60 bg-background/30 p-3">
              <summary className="cursor-pointer text-sm font-semibold">
                修改我的登录密码
              </summary>
              <form
                className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
                onSubmit={event => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  changePassword.mutate({
                    currentPassword: String(form.get("currentPassword") ?? ""),
                    newPassword: String(form.get("newPassword") ?? ""),
                  });
                  event.currentTarget.reset();
                }}
              >
                <Input
                  name="currentPassword"
                  type="password"
                  required
                  placeholder="当前密码"
                  autoComplete="current-password"
                  className="min-h-11"
                  aria-label="当前密码"
                />
                <Input
                  name="newPassword"
                  type="password"
                  required
                  minLength={12}
                  maxLength={128}
                  placeholder="新密码（至少 12 位）"
                  autoComplete="new-password"
                  className="min-h-11"
                  aria-label="新密码"
                />
                <Button
                  type="submit"
                  variant="outline"
                  className="min-h-11"
                  disabled={changePassword.isPending}
                >
                  更新密码
                </Button>
              </form>
            </details>
          </div>
        </section>

        <section className="ops-panel">
          <div className="ops-panel-header">
            <div>
              <h2 className="ops-title flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-primary" />
                同步任务
              </h2>
              <p className="ops-subtitle">
                只有已授权店铺才能创建读取任务；失败任务保留错误摘要，可排队重试
              </p>
            </div>
          </div>
          <div className="space-y-3 p-4">
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <Select value={syncStore} onValueChange={setSyncStore}>
                <SelectTrigger className="min-h-11" aria-label="选择店铺">
                  <SelectValue placeholder="选择店铺" />
                </SelectTrigger>
                <SelectContent>
                  {data.stores.map(store => (
                    <SelectItem key={store.id} value={String(store.id)}>
                      {store.shopName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={syncType} onValueChange={setSyncType}>
                <SelectTrigger className="min-h-11" aria-label="资源类型">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="orders">订单</SelectItem>
                  <SelectItem value="listings">刊登</SelectItem>
                  <SelectItem value="refunds">退款</SelectItem>
                  <SelectItem value="shipments">发货</SelectItem>
                  <SelectItem value="inventory">库存</SelectItem>
                </SelectContent>
              </Select>
              <Button
                className="min-h-11"
                disabled={!syncStore || createSync.isPending}
                onClick={() =>
                  createSync.mutate({
                    storeConnectionId: Number(syncStore),
                    resourceType: syncType as
                      | "orders"
                      | "listings"
                      | "refunds"
                      | "shipments"
                      | "inventory",
                  })
                }
              >
                排队读取
              </Button>
            </div>
            <div className="table-shell">
              <div className="table-scroll">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>店铺</th>
                      <th>资源</th>
                      <th>状态</th>
                      <th>尝试</th>
                      <th>最近错误</th>
                      <th>创建时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.syncJobs.map(job => (
                      <tr key={job.id}>
                        <td>
                          {data.stores.find(
                            store => store.id === job.storeConnectionId
                          )?.shopName ?? `#${job.storeConnectionId}`}
                        </td>
                        <td>{label(job.resourceType)}</td>
                        <td>
                          <StatusPill value={job.status} />
                        </td>
                        <td data-number="true">{job.attemptCount}</td>
                        <td className="max-w-56 truncate text-xs text-muted-foreground">
                          {job.lastError ?? "—"}
                        </td>
                        <td className="text-xs text-muted-foreground">
                          {dateTime(job.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data.syncJobs.length === 0 && (
                <p className="p-4 text-sm text-muted-foreground">
                  暂无同步任务。
                </p>
              )}
            </div>
          </div>
        </section>

        <section className="ops-panel">
          <div className="ops-panel-header">
            <div>
              <h2 className="ops-title flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" />
                审计日志
              </h2>
              <p className="ops-subtitle">
                高风险操作全部留痕：操作者、动作、对象、前后值与原因
              </p>
            </div>
          </div>
          <div className="table-shell m-4 mt-0">
            <div className="table-scroll max-h-[28rem]">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>操作者</th>
                    <th>动作</th>
                    <th>对象</th>
                    <th>原因</th>
                  </tr>
                </thead>
                <tbody>
                  {data.auditLogs.map(logItem => (
                    <tr key={logItem.id}>
                      <td className="whitespace-nowrap text-xs text-muted-foreground">
                        {dateTime(logItem.createdAt)}
                      </td>
                      <td>
                        {data.members.find(
                          member => member.id === logItem.actorId
                        )?.name ?? "系统"}
                      </td>
                      <td className="font-mono text-xs">{logItem.action}</td>
                      <td className="text-xs text-muted-foreground">
                        {logItem.entityType} #{logItem.entityId}
                      </td>
                      <td className="max-w-64 truncate text-xs text-muted-foreground">
                        {logItem.reason ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.auditLogs.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">
                暂无审计记录。
              </p>
            )}
          </div>
          <div className="border-t border-border/60 p-4 text-xs leading-5 text-muted-foreground">
            数据边界：买家地址仅在订单与履约流程内按权限展示；附件经服务端私有存储访问；令牌与凭证不会进入前端或审计日志；新西兰等非澳洲目的地的订单会被标记为超范围并阻断常规发货。
          </div>
        </section>

        <section className="ops-panel xl:col-span-2">
          <div className="ops-panel-header">
            <div>
              <h2 className="ops-title flex items-center gap-2">
                {resolvedTheme === "dark" ? (
                  <Moon className="h-4 w-4 text-primary" />
                ) : (
                  <Sun className="h-4 w-4 text-primary" />
                )}
                外观与可读性
              </h2>
              <p className="ops-subtitle">
                默认跟随系统；选择会保存在本机，并在下次打开时于首屏渲染前生效
              </p>
            </div>
            <Badge variant="outline" className="text-muted-foreground">
              当前：{resolvedTheme === "dark" ? "夜间" : "日间"}
            </Badge>
          </div>
          <div className="grid gap-2 p-4 sm:grid-cols-3">
            {(
              [
                { value: "system", title: "跟随系统", icon: Monitor },
                { value: "light", title: "日间模式", icon: Sun },
                { value: "dark", title: "夜间模式", icon: Moon },
              ] as const
            ).map(option => (
              <Button
                key={option.value}
                type="button"
                variant={mode === option.value ? "default" : "outline"}
                className="min-h-12 justify-start"
                onClick={() => setMode(option.value)}
                aria-pressed={mode === option.value}
              >
                <option.icon className="mr-2 h-4 w-4" />
                {option.title}
              </Button>
            ))}
          </div>
          <div className="border-t border-border/60 p-4 text-xs leading-5 text-muted-foreground">
            夜间模式沿用深海军蓝 + 青色高亮；日间模式使用冷灰底 +
            深青主色，并单独压暗了状态标签颜色，保证表格在强光环境下仍然清晰。
          </div>
        </section>
      </div>
    </div>
  );
}
