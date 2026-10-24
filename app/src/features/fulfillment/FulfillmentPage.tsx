import { type FormEvent, useMemo, useState } from "react";
import { PackageCheck, RotateCcw, Send } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import {
  matchesOrderQueue,
  shipmentRemainder,
} from "@contracts/merchant-workflow";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/workbench/PageHeader";
import { FormSheet } from "@/components/workbench/FormSheet";
import { EmptyPanel, LoadingPanel } from "@/components/workbench/States";
import { StatusPill } from "@/components/workbench/StatusPill";
import { dateTime, label, money } from "@/lib/format";
import { useWorkspace } from "@/hooks/useWorkspace";
import { trpc } from "@/providers/trpc";

export default function FulfillmentPage({
  mode,
}: {
  mode: "shipping" | "after-sales";
}) {
  const workspace = useWorkspace();
  const [params, setParams] = useSearchParams();
  const orderId = params.has("order") ? Number(params.get("order")) : null;
  const [shipmentKey, setShipmentKey] = useState(() => crypto.randomUUID());
  const [resolutionId, setResolutionId] = useState<number | null>(null);
  const [shipmentAction, setShipmentAction] = useState<{
    id: number;
    kind: "dispatch" | "platform_confirmed" | "platform_failed";
  } | null>(null);
  const setOrderId = (id: number) =>
    setParams(
      previous => {
        const next = new URLSearchParams(previous);
        next.set("order", String(id));
        return next;
      },
      { replace: true }
    );
  const setPanel = (panel: string, open: boolean) =>
    setParams(
      previous => {
        const next = new URLSearchParams(previous);
        if (open) next.set("panel", panel);
        else if (next.get("panel") === panel) {
          next.delete("panel");
          if (panel === "create-shipment") next.delete("order");
        }
        return next;
      },
      { replace: true }
    );
  const createShipment = trpc.workbench.createShipment.useMutation({
    onSuccess: async result => {
      toast.success(
        result.duplicated
          ? "这个包裹已保存，无需重复操作"
          : `包裹 ${result.packageNo} 已保存，交给物流后请确认交运`
      );
      setShipmentKey(crypto.randomUUID());
      setPanel("create-shipment", false);
      await workspace.refresh();
    },
    onError: error => toast.error(error.message),
  });
  const dispatch = trpc.workbench.confirmDispatch.useMutation({
    onSuccess: async result => {
      toast.success(
        result.duplicated
          ? "该包裹已确认交运，无需重复操作"
          : "交运已确认，库存已更新；请继续核对平台发货状态"
      );
      setShipmentAction(null);
      await workspace.refresh();
    },
    onError: error => toast.error(error.message),
  });
  const platformStatus =
    trpc.workbench.updateShipmentPlatformStatus.useMutation({
      onSuccess: async () => {
        toast.success("平台人工核对记录已保存");
        setShipmentAction(null);
        await workspace.refresh();
      },
      onError: error => toast.error(error.message),
    });
  const createAfterSales = trpc.workbench.createAfterSales.useMutation({
    onSuccess: async result => {
      toast.success(
        result.duplicated
          ? "相同外部售后事件已关联，未重复冲减"
          : "售后事件已创建"
      );
      setPanel("create-after-sales", false);
      await workspace.refresh();
    },
    onError: error => toast.error(error.message),
  });
  const updateAfterSales = trpc.workbench.updateAfterSales.useMutation({
    onSuccess: async () => {
      toast.success("售后状态已更新");
      setResolutionId(null);
      await workspace.refresh();
    },
    onError: error => toast.error(error.message),
  });

  const data = workspace.data;
  const shippableOrders = useMemo(
    () =>
      (data?.orders ?? []).filter(order => matchesOrderQueue(order, "to_ship")),
    [data?.orders]
  );
  const selectedOrder =
    orderId === null
      ? shippableOrders.at(0)
      : shippableOrders.find(order => order.id === orderId);
  const packageRows = (data?.shipments ?? []).filter(
    shipment => orderId === null || shipment.salesOrderId === orderId
  );
  const caseRows = (data?.afterSales ?? [])
    .filter(item => orderId === null || item.salesOrderId === orderId)
    .sort(
      (a, b) =>
        Number(b.id === Number(params.get("focus"))) -
        Number(a.id === Number(params.get("focus")))
    );
  const resolutionCase = data?.afterSales.find(
    item => item.id === resolutionId
  );
  const actionPackage = data?.shipments.find(
    shipment => shipment.id === shipmentAction?.id
  );

  if (workspace.isLoading) return <LoadingPanel />;
  if (workspace.error)
    return (
      <EmptyPanel
        title="发货与售后加载失败"
        description={workspace.error.message}
        action={<Button onClick={() => workspace.refetch()}>重试</Button>}
      />
    );
  if (!data) return null;
  const creationPanel =
    mode === "shipping" ? "create-shipment" : "create-after-sales";
  const inlineCreation =
    orderId !== null && params.get("panel") !== creationPanel;

  const submitShipment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedOrder) return;
    const form = new FormData(event.currentTarget);
    const lines = selectedOrder.lines
      .map(line => ({
        salesOrderLineId: line.id,
        quantity: Number(form.get(`quantity-${line.id}`) ?? 0),
      }))
      .filter(line => line.quantity > 0);
    if (!lines.length) {
      toast.error("请至少选择一件可发商品");
      return;
    }
    createShipment.mutate({
      salesOrderId: selectedOrder.id,
      carrier: String(form.get("carrier") ?? ""),
      service: String(form.get("service") ?? ""),
      trackingNo: String(form.get("trackingNo") ?? "") || undefined,
      trackingUrl: String(form.get("trackingUrl") ?? "") || undefined,
      weight: String(form.get("weight") ?? "") || undefined,
      freightEstimate: String(form.get("freightEstimate") ?? "") || undefined,
      idempotencyKey: `shipment-${selectedOrder.id}-${shipmentKey}`,
      lines,
    });
  };

  const submitAfterSales = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    createAfterSales.mutate({
      salesOrderId: Number(form.get("salesOrderId")),
      type: String(form.get("type")) as
        | "refund_only"
        | "return_refund"
        | "reship"
        | "cancel_assist"
        | "dispute",
      reason: String(form.get("reason") ?? ""),
      responsibility: String(form.get("responsibility") ?? "") || undefined,
      amount: String(form.get("amount") ?? "0"),
      currency: "AUD",
      externalEventId: String(form.get("externalEventId") ?? "") || undefined,
    });
  };

  return (
    <div>
      <PageHeader
        eyebrow={mode === "shipping" ? "履约 / 包裹交运" : "服务 / 售后处理"}
        title={mode === "shipping" ? "打包发货" : "售后处理"}
        description={
          mode === "shipping"
            ? "核对商品、填写物流，实际交给物流后再确认交运。平台是否更新会单独显示。"
            : "退款、退货验收和结案分别核对。这里记录处理事实，不会直接向平台执行退款。"
        }
        actions={
          orderId !== null ? (
            <Button asChild variant="outline">
              <Link to={mode === "shipping" ? "/shipping" : "/after-sales"}>
                查看全部{mode === "shipping" ? "包裹" : "售后"}
              </Link>
            </Button>
          ) : undefined
        }
      />

      <div
        className={
          inlineCreation
            ? "grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]"
            : "space-y-6"
        }
      >
        <div className="flex flex-wrap items-start gap-2">
          {mode === "shipping" && (
            <FormSheet
              title="核对商品并创建包裹"
              description="保存包裹不会确认交运，实际交给物流后需单独核对。"
              open={params.get("panel") === "create-shipment"}
              onOpenChange={open => {
                if (open) createShipment.reset();
                setPanel("create-shipment", open);
              }}
              inline={inlineCreation}
              pending={createShipment.isPending}
              error={createShipment.error?.message}
              trigger={
                <Button
                  disabled={!shippableOrders.length || createShipment.isPending}
                >
                  <Send className="mr-2 h-4 w-4" />
                  新建包裹
                </Button>
              }
            >
              <form
                key={`${selectedOrder?.id}-${shipmentKey}-${selectedOrder?.lines.map(line => shipmentRemainder(selectedOrder, line)).join("-")}`}
                onSubmit={submitShipment}
                className="grid gap-3 p-4"
              >
                {orderId !== null && !selectedOrder && (
                  <p role="status" className="text-sm text-muted-foreground">
                    这笔订单当前不能新建包裹。已有包裹可在右侧继续交运；缺货或付款问题请回订单处理。
                  </p>
                )}
                <label className="grid gap-1">
                  <span className="ops-label">可履约订单</span>
                  <select
                    value={selectedOrder?.id ?? ""}
                    onChange={event => setOrderId(Number(event.target.value))}
                    className="ops-input"
                  >
                    {shippableOrders.map(order => (
                      <option key={order.id} value={order.id}>
                        {order.orderNo} · {label(order.internalStatus)}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="text-xs text-muted-foreground">
                  默认发出全部剩余商品；分包时可调整数量，填 0
                  表示本包不发。已在草稿包裹中的数量不会重复列入。
                </p>
                {selectedOrder?.lines.map(line => {
                  const remaining = shipmentRemainder(selectedOrder, line);
                  return (
                    <label
                      key={line.id}
                      className="grid gap-1 rounded-lg border p-3"
                    >
                      <span className="text-sm">
                        {line.title} · {line.sku?.code}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        本次最多可放入 {remaining} 件
                      </span>
                      <Input
                        name={`quantity-${line.id}`}
                        aria-label={`${line.title} 本包数量`}
                        type="number"
                        min="0"
                        max={remaining}
                        step="1"
                        defaultValue={remaining}
                        required
                      />
                    </label>
                  );
                })}
                <label className="grid gap-1">
                  <span className="ops-label">重量(g)</span>
                  <Input
                    name="weight"
                    type="number"
                    step="0.001"
                    className="ops-input"
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="grid gap-1">
                    <span className="ops-label">物流商</span>
                    <Input
                      required
                      name="carrier"
                      className="ops-input"
                      defaultValue="Australia Post"
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="ops-label">服务</span>
                    <Input
                      required
                      name="service"
                      className="ops-input"
                      defaultValue="Parcel Post"
                    />
                  </label>
                </div>
                <label className="grid gap-1">
                  <span className="ops-label">运单号</span>
                  <Input name="trackingNo" className="ops-input" />
                </label>
                <label className="grid gap-1">
                  <span className="ops-label">跟踪链接</span>
                  <Input name="trackingUrl" type="url" className="ops-input" />
                </label>
                <label className="grid gap-1">
                  <span className="ops-label">预计运费 AUD</span>
                  <Input
                    name="freightEstimate"
                    type="number"
                    min="0"
                    step="0.01"
                    className="ops-input"
                  />
                </label>
                <Button
                  className="min-h-11"
                  disabled={
                    !selectedOrder ||
                    !selectedOrder.lines.some(
                      line => shipmentRemainder(selectedOrder, line) > 0
                    ) ||
                    createShipment.isPending
                  }
                >
                  保存包裹，待交给物流
                </Button>
              </form>
            </FormSheet>
          )}

          {mode === "after-sales" && (
            <FormSheet
              title="创建售后事件"
              description="记录退款、退货或补发事实，不会自动向平台退款。"
              open={params.get("panel") === "create-after-sales"}
              onOpenChange={open => {
                if (open) createAfterSales.reset();
                setPanel("create-after-sales", open);
              }}
              inline={inlineCreation}
              pending={createAfterSales.isPending}
              error={createAfterSales.error?.message}
              trigger={
                <Button
                  disabled={!data.orders.length || createAfterSales.isPending}
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  新增售后事件
                </Button>
              }
            >
              <form onSubmit={submitAfterSales} className="grid gap-3 p-4">
                <label className="grid gap-1">
                  <span className="ops-label">订单</span>
                  <select
                    key={orderId}
                    required
                    name="salesOrderId"
                    defaultValue={orderId ?? ""}
                    className="ops-input"
                  >
                    <option value="" disabled>
                      选择订单
                    </option>
                    {data.orders.map(order => (
                      <option key={order.id} value={order.id}>
                        {order.orderNo}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1">
                  <span className="ops-label">类型</span>
                  <select name="type" className="ops-input">
                    <option value="refund_only">退款不退货</option>
                    <option value="return_refund">退货退款</option>
                    <option value="reship">补发</option>
                    <option value="cancel_assist">取消协助</option>
                    <option value="dispute">平台争议</option>
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="grid gap-1">
                    <span className="ops-label">金额 AUD</span>
                    <Input
                      name="amount"
                      type="number"
                      min="0"
                      step="0.01"
                      defaultValue="0"
                      className="ops-input"
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="ops-label">平台事件 ID</span>
                    <Input name="externalEventId" className="ops-input" />
                  </label>
                </div>
                <label className="grid gap-1">
                  <span className="ops-label">责任归类</span>
                  <Input name="responsibility" className="ops-input" />
                </label>
                <label className="grid gap-1">
                  <span className="ops-label">原因</span>
                  <Textarea
                    required
                    name="reason"
                    className="min-h-20 bg-secondary/70"
                  />
                </label>
                <Button
                  className="min-h-11"
                  variant="secondary"
                  disabled={createAfterSales.isPending}
                >
                  创建售后
                </Button>
              </form>
            </FormSheet>
          )}
        </div>

        <div className="space-y-4 min-w-0">
          {mode === "shipping" && (
            <section className="ops-panel">
              <div className="ops-panel-header">
                <div>
                  <h2 className="ops-title">包裹列表</h2>
                  <p className="ops-subtitle">
                    一单多包裹、按行部分发货；合计不能超过可发数量
                  </p>
                </div>
              </div>
              {packageRows.length === 0 ? (
                <EmptyPanel
                  title="暂无包裹"
                  description="从可发货订单核对商品并创建包裹。"
                  action={
                    <Button asChild variant="outline">
                      <Link to="/orders?queue=to_ship">查看待发货订单</Link>
                    </Button>
                  }
                />
              ) : (
                <div className="table-scroll">
                  <table className="ops-table">
                    <thead>
                      <tr>
                        <th>包裹</th>
                        <th>订单</th>
                        <th>运单</th>
                        <th>费用</th>
                        <th>状态</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {packageRows.map(shipment => (
                        <tr key={shipment.id}>
                          <td>
                            <p className="font-mono font-semibold text-primary">
                              {shipment.packageNo}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              创建 {dateTime(shipment.createdAt)}
                            </p>
                          </td>
                          <td>
                            <Link
                              className="text-primary hover:underline"
                              to={`/orders?queue=all&focus=${shipment.salesOrderId}`}
                            >
                              {shipment.order?.orderNo}
                            </Link>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {shipment.lines
                                .map(
                                  line =>
                                    `${data.orders.find(order => order.id === shipment.salesOrderId)?.lines.find(item => item.id === line.salesOrderLineId)?.title ?? "商品"} × ${line.quantity}`
                                )
                                .join("，")}
                            </p>
                          </td>
                          <td>
                            {shipment.carrier} · {shipment.service}
                            <p className="mt-1 font-mono text-xs text-muted-foreground">
                              {shipment.trackingNo ?? "未录入"}
                            </p>
                            {shipment.trackingUrl && (
                              <a
                                className="mt-1 inline-flex min-h-8 items-center text-xs text-primary hover:underline"
                                href={shipment.trackingUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                打开跟踪链接
                              </a>
                            )}
                          </td>
                          <td className="tabular-nums">
                            {money(
                              shipment.freightActual ??
                                shipment.freightEstimate,
                              shipment.currency
                            )}
                          </td>
                          <td>
                            <StatusPill value={shipment.status} />
                            <p className="mt-2 max-w-56 text-xs leading-5 text-muted-foreground">
                              {shipment.platformMessage ??
                                (shipment.status === "draft"
                                  ? "尚未确认交给物流"
                                  : "交运已记录，平台状态待人工核对")}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              交运：{dateTime(shipment.dispatchedAt)}
                            </p>
                          </td>
                          <td>
                            <div className="flex min-w-44 flex-col gap-2">
                              <Button
                                size="sm"
                                className="min-h-10"
                                disabled={
                                  shipment.status !== "draft" ||
                                  dispatch.isPending
                                }
                                onClick={() =>
                                  setShipmentAction({
                                    id: shipment.id,
                                    kind: "dispatch",
                                  })
                                }
                              >
                                <PackageCheck className="mr-1 h-4 w-4" />
                                确认已交给物流
                              </Button>
                              {shipment.status !== "draft" && (
                                <>
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() =>
                                      setShipmentAction({
                                        id: shipment.id,
                                        kind: "platform_confirmed",
                                      })
                                    }
                                  >
                                    记录平台已更新
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() =>
                                      setShipmentAction({
                                        id: shipment.id,
                                        kind: "platform_failed",
                                      })
                                    }
                                  >
                                    记录平台更新失败
                                  </Button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {mode === "after-sales" && (
            <section className="ops-panel">
              <div className="ops-panel-header">
                <div>
                  <h2 className="ops-title">售后事件</h2>
                  <p className="ops-subtitle">
                    退款执行状态和退货实物状态分别管理；结案不等于已退款
                  </p>
                </div>
              </div>
              {caseRows.length === 0 ? (
                <EmptyPanel
                  title="暂无售后事件"
                  description="可从订单发起售后，退款与退货状态分别记录。"
                />
              ) : (
                <div className="table-scroll">
                  <table className="ops-table">
                    <thead>
                      <tr>
                        <th>事件</th>
                        <th>订单</th>
                        <th>退款</th>
                        <th>退货</th>
                        <th>金额</th>
                        <th>处理</th>
                      </tr>
                    </thead>
                    <tbody>
                      {caseRows.map(item => (
                        <tr
                          key={item.id}
                          className={
                            item.id === Number(params.get("focus"))
                              ? "bg-accent/25"
                              : ""
                          }
                        >
                          <td>
                            <p className="font-medium">{label(item.type)}</p>
                            <StatusPill value={item.status} className="mt-2" />
                            <p className="mt-2 max-w-72 text-xs text-muted-foreground">
                              {item.reason}
                            </p>
                          </td>
                          <td>
                            <Link
                              className="font-mono text-primary"
                              to={`/orders?queue=all&focus=${item.salesOrderId}`}
                            >
                              {item.order?.orderNo}
                            </Link>
                          </td>
                          <td>
                            <StatusPill value={item.refundStatus} />
                          </td>
                          <td>
                            <StatusPill value={item.returnStatus} />
                          </td>
                          <td>{money(item.amount, item.currency)}</td>
                          <td>
                            <Button
                              variant="outline"
                              disabled={updateAfterSales.isPending}
                              onClick={() => setResolutionId(item.id)}
                            >
                              核对处理进展
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </div>
        <Dialog
          open={shipmentAction !== null}
          onOpenChange={open => {
            if (!open) setShipmentAction(null);
          }}
        >
          <DialogContent>
            <DialogTitle>
              {shipmentAction?.kind === "dispatch"
                ? "确认实际交运"
                : "记录平台核对结果"}{" "}
              · {actionPackage?.packageNo}
            </DialogTitle>
            <DialogDescription>
              {shipmentAction?.kind === "dispatch"
                ? "仅当包裹已经交给物流时确认。确认后将扣减库存；不会自动证明平台已更新。"
                : "请先在平台核对实际结果。此处只保存人工核对记录，不会调用平台发货接口。"}
            </DialogDescription>
            <form
              className="grid gap-3"
              onSubmit={event => {
                event.preventDefault();
                if (!shipmentAction) return;
                const reason = String(
                  new FormData(event.currentTarget).get("reason") ?? ""
                ).trim();
                if (!reason) {
                  toast.error("请填写核对说明");
                  return;
                }
                if (shipmentAction.kind === "dispatch")
                  dispatch.mutate({
                    shipmentId: shipmentAction.id,
                    dispatchedAt: new Date(),
                    reason,
                  });
                else
                  platformStatus.mutate({
                    shipmentId: shipmentAction.id,
                    status: shipmentAction.kind,
                    message: reason,
                  });
              }}
            >
              <label className="grid gap-1">
                <span>核对说明</span>
                <Textarea name="reason" required />
              </label>
              <Button disabled={dispatch.isPending || platformStatus.isPending}>
                确认记录
              </Button>
            </form>
          </DialogContent>
        </Dialog>
        <Dialog
          open={resolutionId !== null}
          onOpenChange={open => {
            if (!open) setResolutionId(null);
          }}
        >
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogTitle>
              核对售后 · {resolutionCase?.order?.orderNo}
            </DialogTitle>
            <DialogDescription>
              只记录已确认的事实。结案不会自动标记退款成功或退货合格；勾选入库会增加库存。
            </DialogDescription>
            {resolutionCase && (
              <form
                key={resolutionCase.id}
                className="grid gap-3"
                onSubmit={event => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  const restock = form.get("restock") === "on";
                  const returnStatus = String(
                    form.get("returnStatus")
                  ) as typeof resolutionCase.returnStatus;
                  if (restock && returnStatus !== "qualified") {
                    toast.error("退货质检合格后才可以重新入库");
                    return;
                  }
                  updateAfterSales.mutate({
                    id: resolutionCase.id,
                    status: String(
                      form.get("status")
                    ) as typeof resolutionCase.status,
                    refundStatus: String(
                      form.get("refundStatus")
                    ) as typeof resolutionCase.refundStatus,
                    returnStatus,
                    resolution: String(form.get("resolution") ?? ""),
                    restockSkuId: restock
                      ? Number(form.get("restockSkuId"))
                      : undefined,
                    restockQty: restock
                      ? Number(form.get("restockQty"))
                      : undefined,
                  });
                }}
              >
                <label className="grid gap-1">
                  <span>处理进度</span>
                  <select
                    name="status"
                    defaultValue={resolutionCase.status}
                    className="ops-input"
                  >
                    {[
                      "pending",
                      "processing",
                      "waiting_external",
                      "closed",
                    ].map(value => (
                      <option key={value} value={value}>
                        {label(value)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1">
                  <span>平台退款事实</span>
                  <select
                    name="refundStatus"
                    defaultValue={resolutionCase.refundStatus}
                    className="ops-input"
                  >
                    {["none", "pending", "confirmed", "failed"].map(value => (
                      <option key={value} value={value}>
                        {label(value)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1">
                  <span>退货与质检事实</span>
                  <select
                    name="returnStatus"
                    defaultValue={resolutionCase.returnStatus}
                    className="ops-input"
                  >
                    {[
                      "none",
                      "awaiting",
                      "received",
                      "pending_inspection",
                      "qualified",
                      "defective",
                    ].map(value => (
                      <option key={value} value={value}>
                        {label(value)}
                      </option>
                    ))}
                  </select>
                </label>
                {resolutionCase.type === "return_refund" && (
                  <fieldset className="grid gap-2 rounded-lg border p-3">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" name="restock" />
                      本次将已质检合格退货重新入库（只执行一次）
                    </label>
                    <label className="grid gap-1">
                      <span>退回商品</span>
                      <select
                        name="restockSkuId"
                        className="ops-input"
                        defaultValue=""
                      >
                        {data.orders
                          .find(
                            order => order.id === resolutionCase.salesOrderId
                          )
                          ?.lines.filter(line => line.skuId !== null)
                          .map(line => (
                            <option key={line.id} value={line.skuId ?? ""}>
                              {line.title} · {line.sku?.code}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label className="grid gap-1">
                      <span>入库数量</span>
                      <Input
                        name="restockQty"
                        type="number"
                        min="1"
                        step="1"
                        defaultValue="1"
                      />
                    </label>
                  </fieldset>
                )}
                <label className="grid gap-1">
                  <span>核对依据 / 处理说明</span>
                  <Textarea required name="resolution" />
                </label>
                <Button disabled={updateAfterSales.isPending}>
                  保存核对结果
                </Button>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
