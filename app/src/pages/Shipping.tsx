import { type FormEvent, useMemo, useState } from "react";
import { PackageCheck, RotateCcw, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/workbench/PageHeader";
import { EmptyPanel, LoadingPanel } from "@/components/workbench/States";
import { StatusPill } from "@/components/workbench/StatusPill";
import { dateTime, label, money } from "@/lib/format";
import { useWorkspace } from "@/hooks/useWorkspace";
import { trpc } from "@/providers/trpc";

export default function Shipping() {
  const workspace = useWorkspace();
  const [orderId, setOrderId] = useState<number | null>(null);
  const createShipment = trpc.workbench.createShipment.useMutation({
    onSuccess: async (result) => { toast.success(result.duplicated ? "重复包裹草稿已被幂等忽略" : `包裹草稿 ${result.packageNo} 已保存，尚未扣库存`); await workspace.refresh(); },
    onError: (error) => toast.error(error.message),
  });
  const dispatch = trpc.workbench.confirmDispatch.useMutation({
    onSuccess: async (result) => { toast.success(result.duplicated ? "该包裹已交运，重试不会重复扣库存" : "实际交运已确认，FIFO 库存已出库"); await workspace.refresh(); },
    onError: (error) => toast.error(error.message),
  });
  const platformStatus = trpc.workbench.updateShipmentPlatformStatus.useMutation({
    onSuccess: async () => { toast.success("平台核对状态已更新；失败会生成待办"); await workspace.refresh(); },
    onError: (error) => toast.error(error.message),
  });
  const createAfterSales = trpc.workbench.createAfterSales.useMutation({
    onSuccess: async (result) => { toast.success(result.duplicated ? "相同外部售后事件已关联，未重复冲减" : "售后事件已创建"); await workspace.refresh(); },
    onError: (error) => toast.error(error.message),
  });
  const updateAfterSales = trpc.workbench.updateAfterSales.useMutation({
    onSuccess: async () => { toast.success("售后状态已更新"); await workspace.refresh(); },
    onError: (error) => toast.error(error.message),
  });

  const data = workspace.data;
  const shippableOrders = useMemo(() => (data?.orders ?? []).filter((order) => order.paymentStatus === "paid" && !["matching", "shortage", "out_of_scope", "fulfilled"].includes(order.internalStatus)), [data?.orders]);
  const selectedOrder = shippableOrders.find((order) => order.id === orderId) ?? shippableOrders.at(0);

  if (workspace.isLoading) return <LoadingPanel />;
  if (workspace.error) return <EmptyPanel title="发货与售后加载失败" description={workspace.error.message} action={<Button onClick={() => workspace.refetch()}>重试</Button>} />;
  if (!data) return null;

  const submitShipment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedOrder) return;
    const form = new FormData(event.currentTarget);
    const lineId = Number(form.get("lineId"));
    createShipment.mutate({
      salesOrderId: selectedOrder.id,
      carrier: String(form.get("carrier") ?? ""),
      service: String(form.get("service") ?? ""),
      trackingNo: String(form.get("trackingNo") ?? "") || undefined,
      trackingUrl: String(form.get("trackingUrl") ?? "") || undefined,
      weight: String(form.get("weight") ?? "") || undefined,
      freightEstimate: String(form.get("freightEstimate") ?? "") || undefined,
      idempotencyKey: `shipment-${selectedOrder.id}-${crypto.randomUUID()}`,
      lines: [{ salesOrderLineId: lineId, quantity: Number(form.get("quantity")) }],
    });
    event.currentTarget.reset();
  };

  const submitAfterSales = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    createAfterSales.mutate({
      salesOrderId: Number(form.get("salesOrderId")),
      type: String(form.get("type")) as "refund_only" | "return_refund" | "reship" | "cancel_assist" | "dispute",
      reason: String(form.get("reason") ?? ""),
      responsibility: String(form.get("responsibility") ?? "") || undefined,
      amount: String(form.get("amount") ?? "0"),
      currency: "AUD",
      externalEventId: String(form.get("externalEventId") ?? "") || undefined,
    });
    event.currentTarget.reset();
  };

  return (
    <div>
      <PageHeader
        eyebrow="FULFILLMENT / FACT BEFORE WRITEBACK"
        title="发货与售后"
        description="严格区分录入运单、确认实际交运、平台已确认发货。草稿不扣库存；回传失败不撤销真实交运，也不会在重试时重复扣库存。"
      />

      <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
        <div className="space-y-4">
          <section className="ops-panel">
            <div className="ops-panel-header"><h2 className="ops-title">创建包裹草稿</h2><Send className="h-4 w-4 text-primary" /></div>
            <form onSubmit={submitShipment} className="grid gap-3 p-4">
              <label className="grid gap-1"><span className="ops-label">可履约订单</span><select value={selectedOrder?.id ?? ""} onChange={(event) => setOrderId(Number(event.target.value))} className="ops-input">{shippableOrders.map((order) => <option key={order.id} value={order.id}>{order.orderNo} · {label(order.internalStatus)}</option>)}</select></label>
              <label className="grid gap-1"><span className="ops-label">订单行</span><select required name="lineId" className="ops-input">{selectedOrder?.lines.map((line) => <option key={line.id} value={line.id}>{line.sku?.code ?? "未匹配"} · 可发 {line.allocatedQty - line.shippedQty}</option>)}</select></label>
              <div className="grid grid-cols-2 gap-3"><label className="grid gap-1"><span className="ops-label">数量</span><Input required name="quantity" type="number" min="1" defaultValue="1" className="ops-input" /></label><label className="grid gap-1"><span className="ops-label">重量(g)</span><Input name="weight" type="number" step="0.001" className="ops-input" /></label></div>
              <div className="grid grid-cols-2 gap-3"><label className="grid gap-1"><span className="ops-label">物流商</span><Input required name="carrier" className="ops-input" defaultValue="Australia Post" /></label><label className="grid gap-1"><span className="ops-label">服务</span><Input required name="service" className="ops-input" defaultValue="Parcel Post" /></label></div>
              <label className="grid gap-1"><span className="ops-label">运单号</span><Input name="trackingNo" className="ops-input" /></label>
              <label className="grid gap-1"><span className="ops-label">跟踪链接</span><Input name="trackingUrl" type="url" className="ops-input" /></label>
              <label className="grid gap-1"><span className="ops-label">预计运费 AUD</span><Input name="freightEstimate" type="number" min="0" step="0.01" className="ops-input" /></label>
              <Button className="min-h-11" disabled={!selectedOrder || createShipment.isPending}>保存草稿（不扣库存）</Button>
            </form>
          </section>

          <section className="ops-panel">
            <div className="ops-panel-header"><h2 className="ops-title">创建售后事件</h2><RotateCcw className="h-4 w-4 text-amber-300" /></div>
            <form onSubmit={submitAfterSales} className="grid gap-3 p-4">
              <label className="grid gap-1"><span className="ops-label">订单</span><select required name="salesOrderId" className="ops-input">{data.orders.map((order) => <option key={order.id} value={order.id}>{order.orderNo}</option>)}</select></label>
              <label className="grid gap-1"><span className="ops-label">类型</span><select name="type" className="ops-input"><option value="refund_only">退款不退货</option><option value="return_refund">退货退款</option><option value="reship">补发</option><option value="cancel_assist">取消协助</option><option value="dispute">平台争议</option></select></label>
              <div className="grid grid-cols-2 gap-3"><label className="grid gap-1"><span className="ops-label">金额 AUD</span><Input name="amount" type="number" min="0" step="0.01" defaultValue="0" className="ops-input" /></label><label className="grid gap-1"><span className="ops-label">平台事件 ID</span><Input name="externalEventId" className="ops-input" /></label></div>
              <label className="grid gap-1"><span className="ops-label">责任归类</span><Input name="responsibility" className="ops-input" /></label>
              <label className="grid gap-1"><span className="ops-label">原因</span><Textarea required name="reason" className="min-h-20 bg-secondary/70" /></label>
              <Button className="min-h-11" variant="secondary" disabled={createAfterSales.isPending}>创建售后</Button>
            </form>
          </section>
        </div>

        <div className="space-y-4 min-w-0">
          <section className="ops-panel">
            <div className="ops-panel-header"><div><h2 className="ops-title">包裹列表</h2><p className="ops-subtitle">一单多包裹、按行部分发货；合计不能超过可发数量</p></div></div>
            {data.shipments.length === 0 ? <EmptyPanel title="暂无包裹" description="从可履约订单创建拣货/打包草稿。" /> : <div className="table-scroll"><table className="ops-table"><thead><tr><th>包裹</th><th>订单</th><th>运单</th><th>费用</th><th>状态</th><th>操作</th></tr></thead><tbody>{data.shipments.map((shipment) => <tr key={shipment.id}><td><p className="font-mono font-semibold text-primary">{shipment.packageNo}</p><p className="mt-1 text-xs text-muted-foreground">创建 {dateTime(shipment.createdAt)}</p></td><td>{shipment.order?.orderNo}<p className="mt-1 text-xs text-muted-foreground">{shipment.lines.map((line) => `行 ${line.salesOrderLineId} × ${line.quantity}`).join("，")}</p></td><td>{shipment.carrier} · {shipment.service}<p className="mt-1 font-mono text-xs text-muted-foreground">{shipment.trackingNo ?? "未录入"}</p>{shipment.trackingUrl && <a className="mt-1 inline-flex min-h-8 items-center text-xs text-primary hover:underline" href={shipment.trackingUrl} target="_blank" rel="noreferrer">打开跟踪链接</a>}</td><td className="font-mono">{money(shipment.freightActual ?? shipment.freightEstimate, shipment.currency)}</td><td><StatusPill value={shipment.status} /><p className="mt-2 max-w-56 text-xs leading-5 text-muted-foreground">{shipment.platformMessage ?? (shipment.status === "draft" ? "仅保存草稿，未扣实物库存" : "待平台核对")}</p><p className="mt-1 text-xs text-muted-foreground">交运：{dateTime(shipment.dispatchedAt)}</p></td><td><div className="flex min-w-44 flex-col gap-2"><Button size="sm" className="min-h-10" disabled={shipment.status !== "draft" || dispatch.isPending} onClick={() => dispatch.mutate({ shipmentId: shipment.id, dispatchedAt: new Date(), reason: "人工确认实际交运" })}><PackageCheck className="mr-1 h-4 w-4" />确认交运</Button>{shipment.status !== "draft" && <><Button size="sm" variant="secondary" className="min-h-10" onClick={() => {
                    const message = window.prompt("平台核对说明", "已在平台手工核对发货");
                    if (message) platformStatus.mutate({ shipmentId: shipment.id, status: "platform_confirmed", message });
                  }}>平台已更新</Button><Button size="sm" variant="outline" className="min-h-10 text-amber-300" onClick={() => {
                    const message = window.prompt("失败原因（不撤销交运、不重复扣库存）", "平台接口超时，需人工处理");
                    if (message) platformStatus.mutate({ shipmentId: shipment.id, status: "platform_failed", message });
                  }}>回传失败</Button></>}</div></td></tr>)}</tbody></table></div>}
          </section>

          <section className="ops-panel">
            <div className="ops-panel-header"><div><h2 className="ops-title">售后事件</h2><p className="ops-subtitle">退款执行状态和退货实物状态分别管理；结案不等于已退款</p></div></div>
            {data.afterSales.length === 0 ? <EmptyPanel title="暂无售后事件" description="平台争议、退款、退货和补发会在此形成独立事件。" /> : <div className="table-scroll"><table className="ops-table"><thead><tr><th>事件</th><th>订单</th><th>退款</th><th>退货</th><th>金额</th><th>处理</th></tr></thead><tbody>{data.afterSales.map((item) => <tr key={item.id}><td><p className="font-medium text-foreground">{label(item.type)}</p><StatusPill value={item.status} className="mt-2" /><p className="mt-2 max-w-72 text-xs leading-5 text-muted-foreground">{item.reason}</p></td><td className="font-mono text-primary">{item.order?.orderNo}</td><td><StatusPill value={item.refundStatus} /></td><td><StatusPill value={item.returnStatus} /></td><td className="font-mono">{money(item.amount, item.currency)}</td><td><div className="grid min-w-48 gap-2"><Button size="sm" variant="outline" className="min-h-10" onClick={() => updateAfterSales.mutate({ id: item.id, status: "processing", refundStatus: item.refundStatus, returnStatus: item.returnStatus, resolution: "开始处理" })}>开始处理</Button><Button size="sm" variant="secondary" className="min-h-10" onClick={() => {
                    const skuId = item.type === "return_refund" ? Number(window.prompt(`若退货质检合格需入库，输入 SKU ID；否则填 0`, "0")) : 0;
                    const qty = skuId ? Number(window.prompt("重新入库数量", "1")) : undefined;
                    updateAfterSales.mutate({ id: item.id, status: "closed", refundStatus: item.refundStatus === "none" ? "none" : "confirmed", returnStatus: item.returnStatus === "none" ? "none" : skuId ? "qualified" : "defective", resolution: "退款/退货事实已人工核对", restockSkuId: skuId || undefined, restockQty: qty });
                  }}>核对并结案</Button></div></td></tr>)}</tbody></table></div>}
          </section>
        </div>
      </div>
    </div>
  );
}
