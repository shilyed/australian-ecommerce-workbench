import { ArrowRight, RefreshCw } from "lucide-react";
import { Link } from "react-router";
import {
  isActiveOrder,
  matchesOrderQueue,
  nextOrderAction,
  shippingDeadline,
  sydneyDay,
} from "@contracts/merchant-workflow";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/workbench/PageHeader";
import { EmptyPanel, LoadingPanel } from "@/components/workbench/States";
import { useWorkspace } from "@/hooks/useWorkspace";
import { dateTime, money, routeForBusiness } from "@/lib/format";

export default function OverviewPage() {
  const workspace = useWorkspace();
  if (workspace.isLoading) return <LoadingPanel />;
  if (workspace.error || !workspace.data)
    return (
      <EmptyPanel
        title="今日经营加载失败"
        description={workspace.error?.message ?? "未收到经营数据"}
        action={<Button onClick={() => workspace.refetch()}>重试</Button>}
      />
    );
  const data = workspace.data;
  const now = new Date();
  const today = sydneyDay(now);
  const todayOrders = data.orders.filter(
    order =>
      sydneyDay(order.orderedAt) === today &&
      order.paymentStatus === "paid" &&
      order.rawStatus !== "cancelled"
  );
  const audOrders = todayOrders.filter(order => order.currency === "AUD");
  const verified = data.report.filter(
    row => sydneyDay(row.orderedAt) === today && row.profitStatus === "verified"
  );
  const toShip = data.orders.filter(order =>
    matchesOrderQueue(order, "to_ship")
  );
  const blocked = data.orders.filter(order =>
    matchesOrderQueue(order, "blocked")
  );
  const openCases = data.afterSales.filter(item => item.status !== "closed");
  const receiving = data.purchaseOrders.filter(
    po =>
      po.flowStatus === "ordered" &&
      po.lines.some(line => line.quantity > line.receivedQty + line.closedQty)
  );
  const urgent = data.orders
    .filter(order => isActiveOrder(order) && order.paymentStatus === "paid")
    .sort(
      (a, b) =>
        (shippingDeadline(a)?.getTime() ?? Infinity) -
        (shippingDeadline(b)?.getTime() ?? Infinity)
    )
    .slice(0, 8);
  const syncIssues = data.stores.filter(
    store => store.authorizationStatus !== "authorized" || store.errorSummary
  );
  const metrics = [
    {
      title: "今日付款订单",
      value: `${todayOrders.length} 单`,
      detail: "悉尼日期，不含取消订单",
    },
    {
      title: "今日订单金额 · AUD",
      value: money(
        audOrders.reduce((sum, order) => sum + Number(order.total), 0)
      ),
      detail: "含运费与代收税，不代表利润",
    },
    {
      title: "已核实贡献利润",
      value:
        data.permissions.finance && verified.length
          ? money(verified.reduce((sum, row) => sum + row.contribution, 0))
          : "—",
      detail:
        data.permissions.finance && verified.length
          ? "仅已核实订单，非净利润或到账"
          : "暂无已核实数据",
    },
  ];
  const queues = [
    {
      title: "准备发货",
      count: toShip.length,
      detail: "已付款且无缺货或商品匹配问题",
      to: "/orders?queue=to_ship",
    },
    {
      title: "解决缺货 / 匹配",
      count: blocked.length,
      detail: "先处理卡住订单的问题，再继续发货",
      to: "/orders?queue=blocked",
    },
    {
      title: "采购待收货",
      count: receiving.length,
      detail: "核对到货数量，质检合格后入库",
      to: "/procurement?view=receiving",
    },
    {
      title: "处理售后",
      count: openCases.length,
      detail: "分别核对退款、退货和补发进展",
      to: "/after-sales",
    },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="工作台 / 每日经营"
        title="今日经营"
        description="先看生意，再处理今天的订单。所有日期以悉尼时区展示。"
        actions={
          <Button variant="outline" onClick={() => workspace.refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            刷新数据
          </Button>
        }
      />
      <div className="workbench-metrics overview-metrics grid gap-0">
        {metrics.map(metric => (
          <section key={metric.title} className="ops-panel p-4">
            <p className="ops-label">{metric.title}</p>
            <p className="metric-value mt-3">{metric.value}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              {metric.detail}
            </p>
          </section>
        ))}
      </div>

      {data.stores.length === 0 && (
        <section className="ops-panel mt-4 p-5">
          <h2 className="ops-title">从连接店铺开始</h2>
          <p className="my-3 text-sm text-muted-foreground">
            连接后可读取店铺概况；订单自动导入能力需单独确认，也可以先手工录入订单。
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link to="/settings">连接店铺</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/inventory?panel=create">建立商品</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/orders?queue=all&import=1">录入订单</Link>
            </Button>
          </div>
        </section>
      )}

      {syncIssues.length > 0 && (
        <section className="ops-panel mt-4 border-amber-500/40 p-4">
          <h2 className="ops-title">有店铺需要检查连接，订单数据可能不完整</h2>
          {syncIssues.map(store => (
            <p key={store.id} className="mt-2 text-sm text-muted-foreground">
              {store.shopName}：{store.errorSummary ?? "尚未完成授权"} ·
              上次成功更新 {dateTime(store.lastSuccessAt)}
            </p>
          ))}
          <Button asChild variant="outline" className="mt-3">
            <Link to="/settings">检查店铺连接</Link>
          </Button>
        </section>
      )}

      <h2 className="mb-3 mt-6 text-lg font-semibold">今天要做</h2>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {queues.map(queue => (
          <Link
            key={queue.to}
            to={queue.to}
            className="ops-panel workbench-action-tile p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            <p className="font-medium">
              {queue.title}
              <ArrowRight className="float-right h-4 w-4" />
            </p>
            <div className="mt-3 flex items-center gap-3">
              <p className="text-2xl font-bold tabular-nums">{queue.count}</p>
              <p className="text-xs leading-5 text-muted-foreground">
                {queue.detail}
              </p>
            </div>
          </Link>
        ))}
      </div>

      <section className="ops-panel mt-4">
        <div className="ops-panel-header">
          <div>
            <h2 className="ops-title">先处理这些订单</h2>
            <p className="ops-subtitle">
              按平台与内部期限中较早的时间排序；点击下一步继续处理
            </p>
          </div>
          <Button asChild variant="ghost">
            <Link to="/orders?queue=all">全部订单</Link>
          </Button>
        </div>
        {urgent.length === 0 ? (
          <EmptyPanel
            title="暂无待处理的已付款订单"
            description="新订单录入后，会按库存和商品匹配情况进入对应队列。"
          />
        ) : (
          <div className="table-scroll">
            <table className="ops-table">
              <thead>
                <tr>
                  <th>订单</th>
                  <th>发货期限</th>
                  <th>下一步</th>
                </tr>
              </thead>
              <tbody>
                {urgent.map(order => {
                  const deadline = shippingDeadline(order);
                  const action = nextOrderAction(order);
                  return (
                    <tr key={order.id}>
                      <td>
                        <Link
                          className="font-mono text-primary hover:underline"
                          to={`/orders?queue=all&focus=${order.id}`}
                        >
                          {order.orderNo}
                        </Link>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {order.platform.toUpperCase()} · {order.lines.length}{" "}
                          种商品
                        </p>
                      </td>
                      <td
                        className={
                          deadline && deadline < now ? "text-destructive" : ""
                        }
                      >
                        {dateTime(deadline)}
                        {deadline && deadline < now ? " · 已逾期" : ""}
                      </td>
                      <td>
                        <Button asChild variant="outline">
                          <Link to={action.to}>
                            {action.label}
                            <ArrowRight className="ml-2 h-4 w-4" />
                          </Link>
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="ops-panel mt-4">
        <div className="ops-panel-header">
          <h2 className="ops-title">其他待办</h2>
        </div>
        <div className="divide-y">
          {data.tasks
            .filter(task => task.status === "open")
            .slice(0, 6)
            .map(task => (
              <Link
                key={task.id}
                to={routeForBusiness(task.businessType, task.businessId)}
                className="flex items-center justify-between gap-3 p-4 hover:bg-accent/20"
              >
                <div>
                  <p className="text-sm font-medium">{task.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {task.reason}
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0" />
              </Link>
            ))}
        </div>
        {!data.tasks.some(task => task.status === "open") && (
          <p className="p-4 text-sm text-muted-foreground">暂无其他待办。</p>
        )}
      </section>
    </div>
  );
}
