import { type FormEvent, useMemo, useState } from "react";
import { FilePlus2, Search, UserRoundCheck } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import {
  matchesOrderQueue,
  nextOrderAction,
  orderQueues,
  parseOrderQueue,
} from "@contracts/merchant-workflow";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/workbench/PageHeader";
import { EmptyPanel, LoadingPanel } from "@/components/workbench/States";
import { StatusPill } from "@/components/workbench/StatusPill";
import { dateTime, money } from "@/lib/format";
import { useWorkspace } from "@/hooks/useWorkspace";
import { trpc } from "@/providers/trpc";

export default function OrdersPage() {
  const workspace = useWorkspace();
  const [params, setParams] = useSearchParams();
  const focusId = Number(params.get("focus") ?? 0);
  const [importStoreId, setImportStoreId] = useState<number | null>(null);
  const query = params.get("q") ?? "";
  const queue = parseOrderQueue(params.get("queue"));
  const [operation, setOperation] = useState<{
    orderId: number;
    kind: "assign" | "note" | "cancel" | "match";
  } | null>(null);
  const updateParam = (key: string, value: string) =>
    setParams(
      previous => {
        const next = new URLSearchParams(previous);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true }
    );
  const createOrder = trpc.workbench.createOrder.useMutation({
    onSuccess: async result => {
      toast.success(
        result.duplicated
          ? "这笔订单已存在，无需重复录入"
          : "订单已录入，已检查付款和库存"
      );
      updateParam("import", "");
      await workspace.refresh();
    },
    onError: error => toast.error(error.message),
  });
  const assign = trpc.workbench.assignOrder.useMutation({
    onSuccess: async () => {
      toast.success("负责人已更新");
      setOperation(null);
      await workspace.refresh();
    },
    onError: error => toast.error(error.message),
  });
  const cancel = trpc.workbench.cancelOrder.useMutation({
    onSuccess: async () => {
      toast.success("本地订单已取消，预留库存已释放；平台取消及退款需另行核对");
      setOperation(null);
      await workspace.refresh();
    },
    onError: error => toast.error(error.message),
  });
  const addNote = trpc.workbench.addNote.useMutation({
    onSuccess: async () => {
      toast.success("内部备注已保存，不会发送给买家");
      setOperation(null);
      await workspace.refresh();
    },
    onError: error => toast.error(error.message),
  });
  const resolveLines = trpc.workbench.resolveOrderLines.useMutation({
    onSuccess: async result => {
      toast.success(
        result.shortage
          ? "库存仍不足，可在商品与补货中查看缺口"
          : "商品与库存已重新检查，请查看订单下一步"
      );
      setOperation(null);
      await workspace.refresh();
    },
    onError: error => toast.error(error.message),
  });

  const rows = useMemo(() => {
    const source = workspace.data?.orders ?? [];
    return source
      .filter(order => {
        const text =
          `${order.orderNo} ${order.externalOrderId} ${order.buyerName ?? ""} ${order.lines.map(line => line.title).join(" ")}`.toLowerCase();
        return (
          (!query || text.includes(query.toLowerCase())) &&
          matchesOrderQueue(order, queue)
        );
      })
      .sort((a, b) => Number(b.id === focusId) - Number(a.id === focusId));
  }, [workspace.data?.orders, query, queue, focusId]);

  if (workspace.isLoading) return <LoadingPanel />;
  if (workspace.error)
    return (
      <EmptyPanel
        title="订单加载失败"
        description={workspace.error.message}
        action={<Button onClick={() => workspace.refetch()}>重试</Button>}
      />
    );
  const data = workspace.data!;
  const importStore =
    data.stores.find(store => store.id === importStoreId) ?? data.stores.at(0);
  const focused = rows.find(order => order.id === focusId) ?? rows.at(0);
  const operationOrder = data.orders.find(
    order => order.id === operation?.orderId
  );

  const submitOrder = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!importStore) {
      toast.error("请先在店铺与设置中登记或连接店铺");
      return;
    }
    const listing = data.listings.find(
      item => item.id === Number(form.get("listingId"))
    );
    const subtotal = Number(form.get("subtotal"));
    const shipping = Number(form.get("shippingPaid") ?? 0);
    const tax = Number(form.get("taxCollected") ?? 0);
    createOrder.mutate({
      platform: importStore.platform,
      externalShopId: importStore.externalShopId,
      externalOrderId: String(form.get("externalOrderId") ?? ""),
      orderNo: String(form.get("orderNo") ?? ""),
      buyerName: String(form.get("buyerName") ?? "") || undefined,
      destinationCountry: String(form.get("destinationCountry") ?? "AU"),
      postalCode: String(form.get("postalCode") ?? "") || undefined,
      addressSummary: String(form.get("addressSummary") ?? "") || undefined,
      rawStatus: String(form.get("rawStatus") ?? "paid"),
      paymentStatus: String(form.get("paymentStatus")) as
        "unpaid" | "paid" | "partial_refund" | "refunded" | "unknown",
      orderedAt: new Date(String(form.get("orderedAt"))),
      shipBy: String(form.get("shipBy"))
        ? new Date(String(form.get("shipBy")))
        : undefined,
      currency: "AUD",
      subtotal,
      shippingPaid: shipping,
      taxCollected: tax,
      discount: 0,
      total: subtotal + shipping + tax,
      note: String(form.get("note") ?? ""),
      lines: [
        {
          listingId: listing?.id,
          skuId: listing?.skuId ?? undefined,
          externalSku: listing?.platformSku ?? undefined,
          title:
            listing?.title ??
            String(form.get("manualTitle") ?? "未映射平台商品"),
          quantity: Number(form.get("quantity")),
          unitPrice: subtotal / Math.max(1, Number(form.get("quantity"))),
          discount: 0,
        },
      ],
    });
  };

  return (
    <div>
      <PageHeader
        eyebrow="交易 / 订单队列"
        title="订单处理"
        description="先处理待发货和卡住的订单。每笔订单都有明确的下一步，筛选条件会保留在链接中。"
        actions={
          <Button onClick={() => updateParam("import", "1")}>
            <FilePlus2 className="mr-2 h-4 w-4" />
            录入订单
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2" aria-label="订单工作队列">
        {orderQueues.map(item => (
          <Button
            key={item.value}
            variant={queue === item.value ? "default" : "outline"}
            aria-pressed={queue === item.value}
            onClick={() => {
              setParams(previous => {
                const next = new URLSearchParams(previous);
                next.set("queue", item.value);
                next.delete("focus");
                return next;
              });
            }}
          >
            {item.label} ·{" "}
            {
              data.orders.filter(order => matchesOrderQueue(order, item.value))
                .length
            }
          </Button>
        ))}
      </div>
      <div>
        <Dialog
          open={params.get("import") === "1"}
          onOpenChange={open => updateParam("import", open ? "1" : "")}
        >
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
            <DialogTitle>手工录入订单</DialogTitle>
            <DialogDescription>
              选择实际店铺，填写平台订单信息。重复订单不会重复预留库存；此操作不会向平台创建订单。
            </DialogDescription>
            <form onSubmit={submitOrder} className="grid gap-3 p-4">
              <label className="grid gap-1">
                <span className="ops-label">订单所属店铺</span>
                <select
                  required
                  value={importStore?.id ?? ""}
                  onChange={event =>
                    setImportStoreId(Number(event.target.value))
                  }
                  className="ops-input"
                >
                  <option value="" disabled>
                    选择实际店铺
                  </option>
                  {data.stores.map(store => (
                    <option key={store.id} value={store.id}>
                      {store.shopName} · {store.platform.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>
              {!importStore && (
                <Link className="text-sm text-primary" to="/settings">
                  请先登记或连接店铺，再录入订单
                </Link>
              )}
              <p className="text-xs text-muted-foreground">
                此手工录入表单使用 AUD 金额，请先核对原订单币种。
              </p>
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1">
                  <span className="ops-label">外部订单 ID</span>
                  <Input
                    required
                    name="externalOrderId"
                    className="ops-input font-mono"
                  />
                </label>
                <label className="grid gap-1">
                  <span className="ops-label">订单号</span>
                  <Input
                    required
                    name="orderNo"
                    className="ops-input font-mono"
                  />
                </label>
              </div>
              <label className="grid gap-1">
                <span className="ops-label">刊登/变体</span>
                <select
                  key={importStore?.id}
                  name="listingId"
                  className="ops-input"
                >
                  <option value="">无法识别（进入待匹配）</option>
                  {data.listings
                    .filter(
                      listing =>
                        listing.platform === importStore?.platform &&
                        listing.externalShopId === importStore?.externalShopId
                    )
                    .map(listing => (
                      <option key={listing.id} value={listing.id}>
                        {listing.platform.toUpperCase()} · {listing.title} ·{" "}
                        {listing.sku?.code ?? "未映射"}
                      </option>
                    ))}
                </select>
              </label>
              <label className="grid gap-1">
                <span className="ops-label">未映射商品标题</span>
                <Input name="manualTitle" className="ops-input" />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1">
                  <span className="ops-label">数量</span>
                  <Input
                    required
                    name="quantity"
                    type="number"
                    min="1"
                    defaultValue="1"
                    className="ops-input"
                  />
                </label>
                <label className="grid gap-1">
                  <span className="ops-label">付款状态</span>
                  <select name="paymentStatus" className="ops-input">
                    <option value="paid">已付款</option>
                    <option value="unpaid">未付款</option>
                    <option value="unknown">待确认</option>
                  </select>
                </label>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <label className="grid gap-1">
                  <span className="ops-label">商品金额</span>
                  <Input
                    required
                    name="subtotal"
                    type="number"
                    step="0.01"
                    min="0"
                    className="ops-input"
                  />
                </label>
                <label className="grid gap-1">
                  <span className="ops-label">买家运费</span>
                  <Input
                    name="shippingPaid"
                    type="number"
                    step="0.01"
                    min="0"
                    defaultValue="0"
                    className="ops-input"
                  />
                </label>
                <label className="grid gap-1">
                  <span className="ops-label">代收税</span>
                  <Input
                    name="taxCollected"
                    type="number"
                    step="0.01"
                    min="0"
                    defaultValue="0"
                    className="ops-input"
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1">
                  <span className="ops-label">下单时间</span>
                  <Input
                    required
                    name="orderedAt"
                    type="datetime-local"
                    className="ops-input"
                  />
                </label>
                <label className="grid gap-1">
                  <span className="ops-label">发货期限</span>
                  <Input
                    name="shipBy"
                    type="datetime-local"
                    className="ops-input"
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1">
                  <span className="ops-label">国家</span>
                  <Input
                    required
                    name="destinationCountry"
                    defaultValue="AU"
                    className="ops-input"
                  />
                </label>
                <label className="grid gap-1">
                  <span className="ops-label">邮编</span>
                  <Input name="postalCode" className="ops-input" />
                </label>
              </div>
              <label className="grid gap-1">
                <span className="ops-label">买家姓名</span>
                <Input name="buyerName" className="ops-input" />
              </label>
              <label className="grid gap-1">
                <span className="ops-label">地址摘要（脱敏）</span>
                <Input name="addressSummary" className="ops-input" />
              </label>
              <input
                type="hidden"
                name="rawStatus"
                value="manual_import_paid"
              />
              <label className="grid gap-1">
                <span className="ops-label">买家备注</span>
                <Textarea name="note" className="min-h-16 bg-secondary/70" />
              </label>
              <Button className="min-h-11" disabled={createOrder.isPending}>
                导入订单
              </Button>
            </form>
          </DialogContent>
        </Dialog>

        <section className="ops-panel min-w-0">
          <div className="ops-panel-header">
            <div>
              <h2 className="ops-title">订单列表</h2>
              <p className="ops-subtitle">
                先看下一步；展开状态可查看付款、履约和售后记录
              </p>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="搜索订单"
                value={query}
                onChange={event => updateParam("q", event.target.value)}
                className="ops-input pl-9"
                placeholder="搜索订单/商品/买家"
              />
            </div>
          </div>
          {rows.length === 0 ? (
            <EmptyPanel
              title="没有匹配订单"
              description="可通过官方授权读取或使用应急手工导入。"
            />
          ) : (
            <div className="table-scroll">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>订单</th>
                    <th>状态</th>
                    <th>行项目与分配</th>
                    <th>包裹</th>
                    <th>负责人/期限</th>
                    <th className="text-right">金额</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(order => (
                    <tr
                      key={order.id}
                      id={`order-${order.id}`}
                      className={focused?.id === order.id ? "bg-accent/25" : ""}
                    >
                      <td>
                        <p className="font-mono font-semibold text-primary">
                          {order.orderNo}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {order.platform.toUpperCase()} ·{" "}
                          {order.externalShopId}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          外部键：{order.externalOrderId}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {order.destinationCountry} ·{" "}
                          {order.postalCode ?? "无邮编"}
                        </p>
                      </td>
                      <td>
                        <p className="mb-2 text-sm font-medium">
                          {nextOrderAction(order).label}
                        </p>
                        <details>
                          <summary className="cursor-pointer text-xs text-muted-foreground">
                            查看完整状态
                          </summary>
                          <div className="mt-2 flex flex-col items-start gap-2">
                            <StatusPill value={order.paymentStatus} />
                            <StatusPill value={order.internalStatus} />
                            <StatusPill value={order.fulfillmentStatus} />
                            <StatusPill value={order.afterSalesStatus} />
                          </div>
                          <p className="mt-2 text-xs text-muted-foreground">
                            平台原始：{order.rawStatus}
                          </p>
                        </details>
                      </td>
                      <td>
                        <p className="mb-1 max-w-80 line-clamp-1 text-sm font-medium">
                          {order.lines.at(0)?.title ?? "暂无商品明细"}
                        </p>
                        <details className="max-w-80">
                          <summary className="cursor-pointer text-xs text-muted-foreground">
                            {order.lines.length} 项商品 · 合计{" "}
                            {order.lines.reduce(
                              (sum, line) => sum + line.quantity,
                              0
                            )}{" "}
                            件，查看分配
                          </summary>
                          <div className="space-y-2">
                            {order.lines.map(line => (
                              <div
                                key={line.id}
                                className="rounded-lg bg-secondary/35 p-2"
                              >
                                <p className="text-sm text-foreground">
                                  {line.title}
                                </p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  SKU：
                                  <span className="font-mono text-primary">
                                    {line.sku?.code ?? "未匹配"}
                                  </span>{" "}
                                  · 数量 {line.quantity} · 分配{" "}
                                  {line.allocatedQty} · 已发 {line.shippedQty} ·
                                  缺口{" "}
                                  <span
                                    className={
                                      line.shortageQty > 0 ? "text-red-300" : ""
                                    }
                                  >
                                    {line.shortageQty}
                                  </span>
                                </p>
                              </div>
                            ))}
                          </div>
                        </details>
                      </td>
                      <td>
                        {order.shipments.length === 0 ? (
                          <span className="text-muted-foreground">无包裹</span>
                        ) : (
                          order.shipments.map(shipment => (
                            <div key={shipment.id} className="mb-2">
                              <p className="font-mono text-xs text-foreground">
                                {shipment.packageNo}
                              </p>
                              <StatusPill
                                value={shipment.status}
                                className="mt-1"
                              />
                            </div>
                          ))
                        )}
                      </td>
                      <td>
                        <p>{order.owner?.name ?? "待分配"}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          平台：{dateTime(order.shipBy)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          内部：{dateTime(order.internalShipBy)}
                        </p>
                      </td>
                      <td className="text-right">
                        <p className="font-semibold tabular-nums">
                          {money(order.total, order.currency)}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          净收入基础：
                          {money(
                            Number(order.subtotal) +
                              Number(order.shippingPaid) -
                              Number(order.discount),
                            order.currency
                          )}
                        </p>
                      </td>
                      <td>
                        <div className="flex min-w-40 flex-col gap-2">
                          {order.internalStatus === "matching" &&
                          order.afterSalesStatus !== "open" ? (
                            <Button
                              size="sm"
                              onClick={() =>
                                setOperation({
                                  orderId: order.id,
                                  kind: "match",
                                })
                              }
                            >
                              匹配商品
                            </Button>
                          ) : (
                            <Button asChild size="sm">
                              <Link to={nextOrderAction(order).to}>
                                {nextOrderAction(order).label}
                              </Link>
                            </Button>
                          )}
                          {order.internalStatus === "shortage" && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={resolveLines.isPending}
                              onClick={() =>
                                resolveLines.mutate({
                                  orderId: order.id,
                                  lines: [],
                                  reason: "收货后重新检查库存分配",
                                })
                              }
                            >
                              重新检查库存
                            </Button>
                          )}
                          <Button asChild size="sm" variant="outline">
                            <Link to={`/after-sales?order=${order.id}`}>
                              发起 / 查看售后
                            </Link>
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setOperation({
                                orderId: order.id,
                                kind: "assign",
                              })
                            }
                          >
                            <UserRoundCheck className="mr-1 h-4 w-4" />
                            分配负责人
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              setOperation({ orderId: order.id, kind: "note" })
                            }
                          >
                            内部备注
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            disabled={
                              order.fulfillmentStatus !== "unshipped" ||
                              order.internalStatus === "fulfilled"
                            }
                            onClick={() =>
                              setOperation({
                                orderId: order.id,
                                kind: "cancel",
                              })
                            }
                          >
                            取消本地订单
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
      <Dialog
        open={operation !== null}
        onOpenChange={open => {
          if (!open) setOperation(null);
        }}
      >
        <DialogContent>
          <DialogTitle>
            {operation?.kind === "match"
              ? "匹配订单商品"
              : operation?.kind === "assign"
                ? "分配负责人"
                : operation?.kind === "cancel"
                  ? "取消本地订单"
                  : "添加内部备注"}{" "}
            · {operationOrder?.orderNo}
          </DialogTitle>
          <DialogDescription>
            {operation?.kind === "cancel"
              ? "仅取消本地处理并释放预留库存，不会向平台取消订单或执行退款。请填写原因。"
              : "操作记录会保存到这笔订单，不会发送给买家。"}
          </DialogDescription>
          <form
            key={`${operation?.orderId}-${operation?.kind}`}
            className="grid gap-3"
            onSubmit={event => {
              event.preventDefault();
              if (!operation) return;
              const form = new FormData(event.currentTarget);
              const reason = String(form.get("reason") ?? "").trim();
              if (!reason) {
                toast.error("请填写说明");
                return;
              }
              if (operation.kind === "match")
                resolveLines.mutate({
                  orderId: operation.orderId,
                  lines: (operationOrder?.lines ?? [])
                    .filter(line => !line.skuId)
                    .map(line => ({
                      lineId: line.id,
                      skuId: Number(form.get(`sku-${line.id}`)),
                    })),
                  reason,
                });
              else if (operation.kind === "assign")
                assign.mutate({
                  orderId: operation.orderId,
                  ownerId: Number(form.get("ownerId")),
                  note: reason,
                });
              else if (operation.kind === "note")
                addNote.mutate({
                  businessType: "order",
                  businessId: operation.orderId,
                  body: reason,
                });
              else cancel.mutate({ orderId: operation.orderId, reason });
            }}
          >
            {operation?.kind === "assign" && (
              <label className="grid gap-1">
                <span>负责人</span>
                <select
                  required
                  name="ownerId"
                  className="ops-input"
                  defaultValue={operationOrder?.ownerId ?? data.currentUser.id}
                >
                  {data.members
                    .filter(member => member.status === "active")
                    .map(member => (
                      <option key={member.id} value={member.id}>
                        {member.name ?? member.email}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {operation?.kind === "match" &&
              operationOrder?.lines
                .filter(line => !line.skuId)
                .map(line => (
                  <label key={line.id} className="grid gap-1">
                    <span>{line.title}</span>
                    <select
                      required
                      name={`sku-${line.id}`}
                      defaultValue=""
                      className="ops-input"
                    >
                      <option value="" disabled>
                        选择对应的库存商品
                      </option>
                      {data.skus
                        .filter(sku => sku.status === "active")
                        .map(sku => (
                          <option key={sku.id} value={sku.id}>
                            {sku.name} · {sku.spec} · {sku.code}
                          </option>
                        ))}
                    </select>
                  </label>
                ))}
            <label className="grid gap-1">
              <span>说明</span>
              <Textarea required name="reason" />
            </label>
            <Button
              disabled={
                assign.isPending ||
                addNote.isPending ||
                cancel.isPending ||
                resolveLines.isPending
              }
            >
              确认{operation?.kind === "cancel" ? "取消本地订单" : "保存"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
