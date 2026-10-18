import { type FormEvent, useState } from "react";
import { KeyRound, PlugZap, RefreshCw, ShieldCheck, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/workbench/PageHeader";
import { EmptyPanel, LoadingPanel } from "@/components/workbench/States";
import { StatusPill } from "@/components/workbench/StatusPill";
import { dateTime, label } from "@/lib/format";
import { useWorkspace } from "@/hooks/useWorkspace";
import { trpc } from "@/providers/trpc";

const ROLE_TEXT: Record<string, string> = {
  admin: "管理员：全部权限，含成员与写回设置",
  operations: "运营：选品、采购、商品、订单、发货与售后",
  fulfillment: "履约：订单、发货、售后；成本与财务不可见",
  finance: "财务：成本、汇率、利润与结算；其他模块只读",
};

export default function Settings() {
  const { data, isLoading, error, refresh, refetch } = useWorkspace();
  const [syncStore, setSyncStore] = useState<string>("");
  const [syncType, setSyncType] = useState<string>("orders");

  const updateStore = trpc.workbench.updateStoreConnection.useMutation({
    onSuccess: async () => {
      toast.success("店铺连接状态已保存，并写入审计日志");
      await refresh();
    },
    onError: (err) => toast.error(err.message),
  });
  const createSync = trpc.workbench.createSyncJob.useMutation({
    onSuccess: async () => {
      toast.success("读取任务已进入队列");
      await refresh();
    },
    onError: (err) => toast.error(err.message),
  });
  const updateMember = trpc.workbench.updateMemberRole.useMutation({
    onSuccess: async () => {
      toast.success("成员角色已更新");
      await refresh();
    },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading) return <LoadingPanel />;
  if (error || !data) return <EmptyPanel title="设置加载失败" description={error?.message ?? "未知错误"} action={<Button onClick={() => refetch()}>重试</Button>} />;

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
      authorizationStatus: String(form.get("authorizationStatus")) as "not_connected" | "authorized" | "expired" | "revoked",
      shippingWritebackEnabled: shipping,
      inventoryWritebackEnabled: inventory,
      writebackMode: shipping || inventory ? (String(form.get("writebackMode")) as "system_controlled" | "manual_confirm") : undefined,
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
          <Button variant="outline" className="min-h-11" onClick={() => refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" />刷新
          </Button>
        }
      />

      {!isAdmin && (
        <div className="ops-panel mb-4 border-amber-500/30 p-4 text-sm leading-6 text-amber-200">
          当前角色不是管理员：可以查看授权与同步状态，但店铺写回开关和成员角色由服务端拦截，只有管理员可修改。
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="ops-panel">
          <div className="ops-panel-header">
            <div>
              <h2 className="ops-title flex items-center gap-2"><PlugZap className="h-4 w-4 text-primary" />店铺连接与授权</h2>
              <p className="ops-subtitle">诚实呈现授权状态：未连接 / 已授权 / 已过期 / 已撤销，绝不伪装同步成功</p>
            </div>
          </div>
          <div className="space-y-3 p-4">
            {data.stores.map((store) => (
              <div key={store.id} className="rounded-lg border border-border/60 bg-secondary/40 p-4">
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
                  <span>最近尝试：{store.lastAttemptAt ? dateTime(store.lastAttemptAt) : "—"}</span>
                  <span>最近成功：{store.lastSuccessAt ? dateTime(store.lastSuccessAt) : "—"}</span>
                  <span>发货写回：{store.shippingWritebackEnabled ? "开启" : "关闭（默认）"}</span>
                  <span>库存写回：{store.inventoryWritebackEnabled ? "开启" : "关闭（默认）"}</span>
                  <span>写回模式：{store.writebackMode ? label(store.writebackMode) : "未启用"}</span>
                  <span>积压：{store.backlogCount} 条</span>
                </div>
                {store.errorSummary && <p className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 p-2 text-xs leading-5 text-red-200">{store.errorSummary}</p>}
              </div>
            ))}
            {data.stores.length === 0 && <p className="text-sm text-muted-foreground">尚未登记任何店铺。</p>}
          </div>

          {isAdmin && (
            <form onSubmit={submitStore} className="space-y-3 border-t border-border/60 p-4">
              <p className="text-sm font-semibold">登记 / 更新店铺连接（管理员）</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="ops-label" htmlFor="platform">平台</label>
                  <select id="platform" name="platform" className="ops-input min-h-11" defaultValue="etsy">
                    <option value="etsy">Etsy</option>
                    <option value="ebay">eBay</option>
                  </select>
                </div>
                <div>
                  <label className="ops-label" htmlFor="externalShopId">外部店铺 ID</label>
                  <Input id="externalShopId" name="externalShopId" required className="min-h-11" placeholder="如 etsy-shop-01" />
                </div>
                <div>
                  <label className="ops-label" htmlFor="shopName">店铺名称</label>
                  <Input id="shopName" name="shopName" required className="min-h-11" />
                </div>
                <div>
                  <label className="ops-label" htmlFor="authorizationStatus">授权状态</label>
                  <select id="authorizationStatus" name="authorizationStatus" className="ops-input min-h-11" defaultValue="not_connected">
                    <option value="not_connected">未连接</option>
                    <option value="authorized">已授权</option>
                    <option value="expired">已过期</option>
                    <option value="revoked">已撤销</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="ops-label" htmlFor="errorSummary">异常摘要（可选，不写凭证）</label>
                  <Input id="errorSummary" name="errorSummary" className="min-h-11" placeholder="例如：令牌已过期，需重新授权" />
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
                  <label className="ops-label" htmlFor="writebackMode">写回模式（开启写回时必选）</label>
                  <select id="writebackMode" name="writebackMode" className="ops-input min-h-11" defaultValue="manual_confirm">
                    <option value="manual_confirm">人工确认后写回</option>
                    <option value="system_controlled">系统主控写回</option>
                  </select>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">P0-B 写回能力需独立验证后启用；写回失败不会回滚真实发货事实，也不会重复扣减库存。</p>
                </div>
              </div>
              <Button type="submit" className="min-h-11 w-full sm:w-auto" disabled={updateStore.isPending}>
                {updateStore.isPending ? "保存中…" : "保存店铺连接"}
              </Button>
            </form>
          )}
        </section>

        <section className="ops-panel">
          <div className="ops-panel-header">
            <div>
              <h2 className="ops-title flex items-center gap-2"><Users className="h-4 w-4 text-primary" />成员与角色</h2>
              <p className="ops-subtitle">角色权限在服务端强制执行，前端隐藏按钮只是体验层</p>
            </div>
          </div>
          <div className="space-y-3 p-4">
            {data.members.map((member) => (
              <div key={member.id} className="rounded-lg border border-border/60 bg-secondary/40 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold">{member.name ?? "未命名成员"}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{member.email ?? "无邮箱"}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{label(member.businessRole)}</Badge>
                    <StatusPill value={member.status} />
                  </div>
                </div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{ROLE_TEXT[member.businessRole]}</p>
                {isAdmin && member.id !== data.currentUser.id && (
                  <form
                    className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_2fr_auto]"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = new FormData(event.currentTarget);
                      updateMember.mutate({
                        userId: member.id,
                        businessRole: String(form.get("businessRole")) as "admin" | "operations" | "fulfillment" | "finance",
                        status: String(form.get("status")) as "active" | "disabled",
                        reason: String(form.get("reason") ?? ""),
                      });
                    }}
                  >
                    <select name="businessRole" className="ops-input min-h-11" defaultValue={member.businessRole} aria-label="业务角色">
                      <option value="admin">管理员</option>
                      <option value="operations">运营</option>
                      <option value="fulfillment">履约</option>
                      <option value="finance">财务</option>
                    </select>
                    <select name="status" className="ops-input min-h-11" defaultValue={member.status} aria-label="状态">
                      <option value="active">启用</option>
                      <option value="disabled">停用</option>
                    </select>
                    <Input name="reason" required minLength={3} placeholder="变更原因（写入审计）" className="min-h-11" aria-label="变更原因" />
                    <Button type="submit" variant="outline" className="min-h-11" disabled={updateMember.isPending}>更新</Button>
                  </form>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="ops-panel">
          <div className="ops-panel-header">
            <div>
              <h2 className="ops-title flex items-center gap-2"><KeyRound className="h-4 w-4 text-primary" />同步任务</h2>
              <p className="ops-subtitle">只有已授权店铺才能创建读取任务；失败任务保留错误摘要，可排队重试</p>
            </div>
          </div>
          <div className="space-y-3 p-4">
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <Select value={syncStore} onValueChange={setSyncStore}>
                <SelectTrigger className="min-h-11" aria-label="选择店铺"><SelectValue placeholder="选择店铺" /></SelectTrigger>
                <SelectContent>
                  {data.stores.map((store) => (
                    <SelectItem key={store.id} value={String(store.id)}>{store.shopName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={syncType} onValueChange={setSyncType}>
                <SelectTrigger className="min-h-11" aria-label="资源类型"><SelectValue /></SelectTrigger>
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
                onClick={() => createSync.mutate({ storeConnectionId: Number(syncStore), resourceType: syncType as "orders" | "listings" | "refunds" | "shipments" | "inventory" })}
              >
                排队读取
              </Button>
            </div>
            <div className="table-shell">
              <div className="table-scroll">
                <table className="ops-table">
                  <thead>
                    <tr><th>店铺</th><th>资源</th><th>状态</th><th>尝试</th><th>最近错误</th><th>创建时间</th></tr>
                  </thead>
                  <tbody>
                    {data.syncJobs.map((job) => (
                      <tr key={job.id}>
                        <td>{data.stores.find((store) => store.id === job.storeConnectionId)?.shopName ?? `#${job.storeConnectionId}`}</td>
                        <td>{label(job.resourceType)}</td>
                        <td><StatusPill value={job.status} /></td>
                        <td data-number="true">{job.attemptCount}</td>
                        <td className="max-w-56 truncate text-xs text-muted-foreground">{job.lastError ?? "—"}</td>
                        <td className="text-xs text-muted-foreground">{dateTime(job.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data.syncJobs.length === 0 && <p className="p-4 text-sm text-muted-foreground">暂无同步任务。</p>}
            </div>
          </div>
        </section>

        <section className="ops-panel">
          <div className="ops-panel-header">
            <div>
              <h2 className="ops-title flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" />审计日志</h2>
              <p className="ops-subtitle">高风险操作全部留痕：操作者、动作、对象、前后值与原因</p>
            </div>
          </div>
          <div className="table-shell m-4 mt-0">
            <div className="table-scroll max-h-[28rem]">
              <table className="ops-table">
                <thead>
                  <tr><th>时间</th><th>操作者</th><th>动作</th><th>对象</th><th>原因</th></tr>
                </thead>
                <tbody>
                  {data.auditLogs.map((logItem) => (
                    <tr key={logItem.id}>
                      <td className="whitespace-nowrap text-xs text-muted-foreground">{dateTime(logItem.createdAt)}</td>
                      <td>{data.members.find((member) => member.id === logItem.actorId)?.name ?? "系统"}</td>
                      <td className="font-mono text-xs">{logItem.action}</td>
                      <td className="text-xs text-muted-foreground">{logItem.entityType} #{logItem.entityId}</td>
                      <td className="max-w-64 truncate text-xs text-muted-foreground">{logItem.reason ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.auditLogs.length === 0 && <p className="p-4 text-sm text-muted-foreground">暂无审计记录。</p>}
          </div>
          <div className="border-t border-border/60 p-4 text-xs leading-5 text-muted-foreground">
            数据边界：买家地址仅在订单与履约流程内按权限展示；附件经服务端私有存储访问；令牌与凭证不会进入前端或审计日志；新西兰等非澳洲目的地的订单会被标记为超范围并阻断常规发货。
          </div>
        </section>
      </div>
    </div>
  );
}
