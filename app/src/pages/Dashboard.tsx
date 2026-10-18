import { AlertTriangle, ArrowRight, CheckCircle2, Clock3, RefreshCw, ShieldAlert } from "lucide-react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { PageHeader } from "@/components/workbench/PageHeader";
import { EmptyPanel, LoadingPanel } from "@/components/workbench/States";
import { StatusPill } from "@/components/workbench/StatusPill";
import { dateTime, label, money, routeForBusiness } from "@/lib/format";
import { trpc } from "@/providers/trpc";

function Metric({ labelText, value, detail, tone = "text-foreground" }: { labelText: string; value: string | number; detail: string; tone?: string }) {
  return (
    <div className="ops-panel p-4">
      <p className="ops-label">{labelText}</p>
      <p className={`metric-value mt-3 ${tone}`} data-number="true">{value}</p>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{detail}</p>
    </div>
  );
}

export default function Dashboard() {
  const dashboard = trpc.workbench.dashboard.useQuery(undefined, { refetchInterval: 60_000 });
  const utils = trpc.useUtils();
  const closeTask = trpc.workbench.updateTask.useMutation({
    onSuccess: async () => {
      toast.success("待办已关闭并写入审计日志");
      await utils.workbench.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  if (dashboard.isLoading) return <LoadingPanel />;
  if (dashboard.error) return <EmptyPanel title="工作台加载失败" description={dashboard.error.message} action={<Button onClick={() => dashboard.refetch()}>重试</Button>} />;
  const data = dashboard.data!;
  const verifiedRate = data.counts.totalProfitOrders > 0 ? (data.counts.verifiedProfitOrders / data.counts.totalProfitOrders) * 100 : 0;
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 } as const;
  const tasks = [...data.tasks].sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || (a.dueAt?.getTime() ?? 0) - (b.dueAt?.getTime() ?? 0));

  return (
    <div>
      <PageHeader
        eyebrow="MISSION CONTROL / AU PILOT"
        title="今日工作台"
        description="按严重程度聚合授权中断、逾期发货、缺货、未匹配 SKU、待质检与售后超期。每条待办都保留稳定业务键，解决后关闭、重现时重新打开。"
        actions={
          <Button variant="outline" className="min-h-11" onClick={() => dashboard.refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" />刷新
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric labelText="严重/高风险待办" value={tasks.filter((task) => ["critical", "high"].includes(task.severity)).length} detail="授权、逾期、缺货与同步失败优先处理" tone="text-red-300" />
        <Metric labelText="已逾期订单" value={data.lateOrders.length} detail="以店铺时区展示承诺期限" tone="text-red-300" />
        <Metric labelText="24 小时内到期" value={data.dueSoon.length} detail="建议阈值可在设置中评审调整" tone="text-amber-300" />
        <Metric labelText="缺货 / 未匹配" value={`${data.counts.shortage} / ${data.counts.unmatched}`} detail="缺货独立展示，不用负库存掩盖" />
        <Metric labelText="利润已核实" value={`${data.counts.verifiedProfitOrders}/${data.counts.totalProfitOrders}`} detail="晚到费用会自动撤销核实状态" tone="text-emerald-300" />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)_380px]">
        <aside className="ops-panel">
          <div className="ops-panel-header">
            <div>
              <h2 className="ops-title">集成警戒</h2>
              <p className="ops-subtitle">店铺授权和同步状态</p>
            </div>
            <ShieldAlert className="h-4 w-4 text-red-300" />
          </div>
          <div className="space-y-3 p-4">
            {data.syncIssues.length === 0 ? (
              <p className="rounded-xl border border-emerald-300/20 bg-emerald-400/10 p-3 text-sm text-emerald-200">两家店铺当前无授权异常。</p>
            ) : (
              data.syncIssues.map((store) => (
                <div key={store.id} className="rounded-xl border border-red-400/25 bg-red-500/10 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium text-foreground">{store.shopName}</p>
                    <StatusPill value={store.authorizationStatus} />
                  </div>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">{store.errorSummary ?? "尚未完成官方授权，读取能力不可用。"}</p>
                  <p className="mt-2 text-[11px] text-muted-foreground">最后成功：{dateTime(store.lastSuccessAt)}</p>
                </div>
              ))
            )}
            <Button asChild variant="outline" className="min-h-11 w-full">
              <Link to="/settings">处理集成设置<ArrowRight className="ml-2 h-4 w-4" /></Link>
            </Button>
          </div>
        </aside>

        <section className="ops-panel min-w-0">
          <div className="ops-panel-header">
            <div>
              <h2 className="ops-title">履约风险队列</h2>
              <p className="ops-subtitle">平台事实与内部处理状态分离，旧快照不回退本地交运事实</p>
            </div>
            <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">AU/Sydney</Badge>
          </div>
          <div className="table-scroll">
            <table className="ops-table">
              <thead>
                <tr>
                  <th>订单</th>
                  <th>平台事实</th>
                  <th>内部状态</th>
                  <th>负责人</th>
                  <th>发货期限</th>
                  <th className="text-right">金额</th>
                </tr>
              </thead>
              <tbody>
                {[...data.lateOrders, ...data.dueSoon].map((order) => (
                  <tr key={order.id}>
                    <td>
                      <Link className="font-mono font-medium text-primary hover:underline" to={`/orders?focus=${order.id}`}>{order.orderNo}</Link>
                      <p className="mt-1 text-xs text-muted-foreground">{order.destinationCountry} · {order.addressSummary ?? "地址摘要未提供"}</p>
                    </td>
                    <td><StatusPill value={order.paymentStatus} /><p className="mt-2 text-xs text-muted-foreground">{order.rawStatus}</p></td>
                    <td><StatusPill value={order.internalStatus} /><p className="mt-2 text-xs text-muted-foreground">{label(order.fulfillmentStatus)}</p></td>
                    <td>{order.owner?.name ?? "待分配"}</td>
                    <td><span className="inline-flex items-center gap-1 text-amber-200"><Clock3 className="h-3.5 w-3.5" />{dateTime(order.shipBy)}</span></td>
                    <td className="text-right font-mono">{money(order.total, order.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.lateOrders.length + data.dueSoon.length === 0 && <EmptyPanel title="暂无逾期或 24 小时内到期订单" description="新订单满足付款和可履约条件时会自动进入库存分配队列。" />}
        </section>

        <aside className="ops-panel">
          <div className="ops-panel-header">
            <div>
              <h2 className="ops-title">站内待办</h2>
              <p className="ops-subtitle">自动任务按稳定键去重并保留历史</p>
            </div>
            <AlertTriangle className="h-4 w-4 text-amber-300" />
          </div>
          <div className="max-h-[720px] space-y-3 overflow-y-auto p-4">
            {tasks.length === 0 ? <EmptyPanel title="没有打开待办" description="异常解决后任务会自动关闭；再次出现时会重新打开并记录次数。" /> : tasks.map((task) => (
              <article key={task.id} className="rounded-xl border bg-secondary/35 p-3">
                <div className="flex items-start justify-between gap-3">
                  <StatusPill value={task.severity} />
                  <span className="text-[11px] text-muted-foreground">{task.dueAt ? dateTime(task.dueAt) : "无截止"}</span>
                </div>
                <h3 className="mt-3 text-sm font-semibold leading-5 text-foreground">{task.title}</h3>
                <p className="mt-2 line-clamp-3 text-xs leading-5 text-muted-foreground">{task.reason}</p>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <Button asChild size="sm" variant="outline" className="min-h-10">
                    <Link to={routeForBusiness(task.businessType, task.businessId)}>打开对象</Link>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="min-h-10 text-emerald-300 hover:text-emerald-200"
                    onClick={() => {
                      const reason = window.prompt("请输入关闭原因（写入审计日志）", "已人工核对并处理");
                      if (reason) closeTask.mutate({ id: task.id, status: "closed", reason });
                    }}
                  >
                    <CheckCircle2 className="mr-1 h-4 w-4" />关闭
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </aside>
      </div>

      <section className="ops-panel mt-4">
        <div className="ops-panel-header">
          <div>
            <h2 className="ops-title">试点数据质量</h2>
            <p className="ops-subtitle">只展示有依据的指标；没有浏览/曝光数据时不生成虚构转化率</p>
          </div>
        </div>
        <div className="grid gap-4 p-4 md:grid-cols-3">
          <div>
            <div className="mb-2 flex justify-between text-xs text-muted-foreground"><span>利润核实覆盖率</span><span className="font-mono">{verifiedRate.toFixed(1)}%</span></div>
            <Progress value={verifiedRate} className="h-2 bg-secondary" />
          </div>
          <div className="rounded-xl border bg-secondary/30 p-3 text-sm text-muted-foreground">待质检数量：<span className="font-mono text-foreground">{data.counts.pendingInspection}</span>（待检和残次不会进入可售）</div>
          <div className="rounded-xl border bg-secondary/30 p-3 text-sm text-muted-foreground">售后打开：<span className="font-mono text-foreground">{data.counts.afterSalesOpen}</span>（退款执行与退货实物状态分开）</div>
        </div>
      </section>
    </div>
  );
}
