import { type FormEvent, useMemo, useState } from "react";
import { CircleDollarSign, PackagePlus, ReceiptText, Truck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/workbench/PageHeader";
import { EmptyPanel, LoadingPanel } from "@/components/workbench/States";
import { StatusPill } from "@/components/workbench/StatusPill";
import { dateOnly, dateTime, money } from "@/lib/format";
import { useWorkspace } from "@/hooks/useWorkspace";
import { trpc } from "@/providers/trpc";

export default function Procurement() {
  const workspace = useWorkspace();
  const [selectedPoId, setSelectedPoId] = useState<number | null>(null);
  const createPo = trpc.workbench.createPurchaseOrder.useMutation({
    onSuccess: async () => { toast.success("采购单已创建；付款或下单不会直接增加库存"); await workspace.refresh(); },
    onError: (error) => toast.error(error.message),
  });
  const addPayment = trpc.workbench.addPayment.useMutation({
    onSuccess: async (result) => { toast.success(result.duplicated ? "重复付款请求已被幂等忽略" : "付款记录已保存（不代表真实支付）"); await workspace.refresh(); },
    onError: (error) => toast.error(error.message),
  });
  const postReceipt = trpc.workbench.postReceipt.useMutation({
    onSuccess: async (result) => { toast.success(result.duplicated ? "重复收货请求只过账一次" : result.rateMissing ? "收货已过账，但缺 CNY/AUD 汇率，成本待补" : "到货质检已过账"); await workspace.refresh(); },
    onError: (error) => toast.error(error.message),
  });
  const closeRemainder = trpc.workbench.closePurchaseRemainder.useMutation({
    onSuccess: async () => { toast.success("剩余未交数量已关闭并保留原因"); await workspace.refresh(); },
    onError: (error) => toast.error(error.message),
  });

  const data = workspace.data;
  const selectedPo = useMemo(() => data?.purchaseOrders.find((po) => po.id === selectedPoId) ?? data?.purchaseOrders.at(0), [data?.purchaseOrders, selectedPoId]);

  if (workspace.isLoading) return <LoadingPanel />;
  if (workspace.error) return <EmptyPanel title="采购数据加载失败" description={workspace.error.message} action={<Button onClick={() => workspace.refetch()}>重试</Button>} />;
  if (!data) return null;

  const submitPo = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    createPo.mutate({
      internalNo: String(form.get("internalNo") ?? ""),
      supplierId: Number(form.get("supplierId")),
      externalOrderNo: String(form.get("externalOrderNo") ?? "") || undefined,
      externalOrderUrl: String(form.get("externalOrderUrl") ?? "") || undefined,
      expectedArrivalAt: String(form.get("expectedArrivalAt") ?? "") ? new Date(String(form.get("expectedArrivalAt"))) : undefined,
      notes: String(form.get("notes") ?? ""),
      flowStatus: "ordered",
      lines: [{
        skuId: Number(form.get("skuId")),
        supplierSpec: String(form.get("supplierSpec") ?? ""),
        quantity: Number(form.get("quantity")),
        unitPrice: String(form.get("unitPrice") ?? ""),
        currency: "CNY",
        discount: 0,
      }],
    });
    event.currentTarget.reset();
  };

  const submitPayment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedPo) return;
    const form = new FormData(event.currentTarget);
    addPayment.mutate({
      purchaseOrderId: selectedPo.id,
      type: String(form.get("type")) as "payment" | "supplier_refund",
      paidAt: new Date(String(form.get("paidAt"))),
      currency: "CNY",
      amount: String(form.get("amount") ?? ""),
      referenceNo: String(form.get("referenceNo") ?? "") || undefined,
      note: String(form.get("note") ?? ""),
      idempotencyKey: `payment-${selectedPo.id}-${crypto.randomUUID()}`,
    });
    event.currentTarget.reset();
  };

  const submitReceipt = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedPo) return;
    const form = new FormData(event.currentTarget);
    postReceipt.mutate({
      purchaseOrderId: selectedPo.id,
      receivedAt: new Date(String(form.get("receivedAt"))),
      note: String(form.get("note") ?? ""),
      idempotencyKey: `receipt-${selectedPo.id}-${crypto.randomUUID()}`,
      lines: [{
        purchaseOrderLineId: Number(form.get("lineId")),
        receivedQty: Number(form.get("receivedQty")),
        qualifiedQty: Number(form.get("qualifiedQty")),
        defectiveQty: Number(form.get("defectiveQty")),
        pendingQty: Number(form.get("pendingQty")),
        overReceiptReason: String(form.get("overReceiptReason") ?? "") || undefined,
      }],
    });
    event.currentTarget.reset();
  };

  return (
    <div>
      <PageHeader
        eyebrow="PROCUREMENT / PAYMENT ≠ INVENTORY"
        title="采购、付款与到货"
        description="采购流程、付款汇总和收货质检分别表达。只有质检合格品会增加可售库存；待检与残次留在不可售，重复提交按幂等键只过账一次。"
      />

      <div className="grid gap-4 xl:grid-cols-[390px_minmax(0,1fr)]">
        <div className="space-y-4">
          <section className="ops-panel">
            <div className="ops-panel-header"><h2 className="ops-title">创建采购单</h2><PackagePlus className="h-4 w-4 text-primary" /></div>
            <form onSubmit={submitPo} className="grid gap-3 p-4">
              <div className="grid grid-cols-2 gap-3"><label className="grid gap-1"><span className="ops-label">内部编号</span><Input required name="internalNo" className="ops-input" placeholder={`PO-202610-${String(data.purchaseOrders.length + 1).padStart(3, "0")}`} /></label><label className="grid gap-1"><span className="ops-label">供应商</span><select required name="supplierId" className="ops-input" defaultValue=""><option value="" disabled>选择</option>{data.suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label></div>
              <label className="grid gap-1"><span className="ops-label">1688 订单号</span><Input name="externalOrderNo" className="ops-input" /></label>
              <label className="grid gap-1"><span className="ops-label">1688 订单链接</span><Input name="externalOrderUrl" type="url" className="ops-input" /></label>
              <label className="grid gap-1"><span className="ops-label">预计到货</span><Input name="expectedArrivalAt" type="datetime-local" className="ops-input" /></label>
              <div className="rounded-xl border bg-secondary/30 p-3">
                <p className="ops-label mb-3">第一条采购明细</p>
                <div className="grid gap-3"><label className="grid gap-1"><span className="ops-label">SKU</span><select required name="skuId" className="ops-input" defaultValue=""><option value="" disabled>选择 SKU</option>{data.skus.map((sku) => <option key={sku.id} value={sku.id}>{sku.code} · {sku.name}</option>)}</select></label><label className="grid gap-1"><span className="ops-label">供应商规格</span><Input required name="supplierSpec" className="ops-input" /></label><div className="grid grid-cols-2 gap-3"><label className="grid gap-1"><span className="ops-label">数量</span><Input required name="quantity" type="number" min="1" className="ops-input" /></label><label className="grid gap-1"><span className="ops-label">单价 CNY</span><Input required name="unitPrice" type="number" min="0" step="0.0001" className="ops-input" /></label></div></div>
              </div>
              <label className="grid gap-1"><span className="ops-label">备注</span><Textarea name="notes" className="min-h-20 bg-secondary/70" /></label>
              <Button className="min-h-11" disabled={createPo.isPending}>创建采购单</Button>
            </form>
          </section>

          <section className="ops-panel">
            <div className="ops-panel-header"><h2 className="ops-title">付款 / 供应商退款</h2><CircleDollarSign className="h-4 w-4 text-emerald-300" /></div>
            <form onSubmit={submitPayment} className="grid gap-3 p-4">
              <label className="grid gap-1"><span className="ops-label">采购单</span><select value={selectedPo?.id ?? ""} onChange={(event) => setSelectedPoId(Number(event.target.value))} className="ops-input">{data.purchaseOrders.map((po) => <option key={po.id} value={po.id}>{po.internalNo}</option>)}</select></label>
              <div className="grid grid-cols-2 gap-3"><label className="grid gap-1"><span className="ops-label">类型</span><select name="type" className="ops-input" defaultValue="payment"><option value="payment">付款</option><option value="supplier_refund">采购退回款</option></select></label><label className="grid gap-1"><span className="ops-label">实际日期</span><Input required name="paidAt" type="datetime-local" className="ops-input" /></label></div>
              <div className="grid grid-cols-2 gap-3"><label className="grid gap-1"><span className="ops-label">金额 CNY</span><Input required name="amount" type="number" min="0" step="0.01" className="ops-input" /></label><label className="grid gap-1"><span className="ops-label">参考流水号</span><Input name="referenceNo" className="ops-input" /></label></div>
              <label className="grid gap-1"><span className="ops-label">说明</span><Textarea name="note" className="min-h-16 bg-secondary/70" /></label>
              <Button className="min-h-11" variant="secondary" disabled={addPayment.isPending || !selectedPo}>记录现金事实</Button>
            </form>
          </section>

          <section className="ops-panel">
            <div className="ops-panel-header"><h2 className="ops-title">分批到货与质检</h2><Truck className="h-4 w-4 text-amber-300" /></div>
            <form onSubmit={submitReceipt} className="grid gap-3 p-4">
              <label className="grid gap-1"><span className="ops-label">采购明细</span><select required name="lineId" className="ops-input">{selectedPo?.lines.map((line) => <option key={line.id} value={line.id}>{line.sku?.code} · 已收 {line.receivedQty}/{line.quantity}</option>)}</select></label>
              <label className="grid gap-1"><span className="ops-label">到货时间</span><Input required name="receivedAt" type="datetime-local" className="ops-input" /></label>
              <div className="grid grid-cols-2 gap-3"><label className="grid gap-1"><span className="ops-label">实收</span><Input required name="receivedQty" type="number" min="1" className="ops-input" /></label><label className="grid gap-1"><span className="ops-label">合格</span><Input required name="qualifiedQty" type="number" min="0" className="ops-input" /></label><label className="grid gap-1"><span className="ops-label">残次</span><Input required name="defectiveQty" type="number" min="0" className="ops-input" /></label><label className="grid gap-1"><span className="ops-label">待检</span><Input required name="pendingQty" type="number" min="0" className="ops-input" /></label></div>
              <label className="grid gap-1"><span className="ops-label">超收原因（如适用）</span><Input name="overReceiptReason" className="ops-input" /></label>
              <label className="grid gap-1"><span className="ops-label">收货说明</span><Textarea name="note" className="min-h-16 bg-secondary/70" /></label>
              <Button className="min-h-11" disabled={postReceipt.isPending || !selectedPo}>过账到货</Button>
              <p className="text-xs leading-5 text-muted-foreground">系统强制：实收 = 合格 + 残次 + 待检；仅合格品增加可售库存。</p>
            </form>
          </section>
        </div>

        <section className="space-y-4 min-w-0">
          {data.purchaseOrders.length === 0 ? <EmptyPanel title="暂无采购单" description="先创建供应商和 SKU，再录入 1688 采购。" /> : data.purchaseOrders.map((po) => {
            const ordered = po.lines.reduce((sum, line) => sum + line.quantity, 0);
            const received = po.lines.reduce((sum, line) => sum + line.receivedQty, 0);
            const paymentTotal = po.payments.reduce((sum, payment) => sum + (payment.type === "payment" ? Number(payment.amount) : -Number(payment.amount)), 0);
            const orderTotal = po.lines.reduce((sum, line) => sum + Number(line.unitPrice ?? 0) * line.quantity - Number(line.discount ?? 0), 0);
            const paymentState = paymentTotal <= 0 ? "未付款" : paymentTotal < orderTotal ? "部分付款" : paymentTotal === orderTotal ? "已付款" : "超额/差异待核对";
            return (
              <article key={po.id} className={`ops-panel ${selectedPo?.id === po.id ? "ring-1 ring-primary/60" : ""}`}>
                <div className="ops-panel-header">
                  <button type="button" className="min-h-11 text-left" onClick={() => setSelectedPoId(po.id)}>
                    <h2 className="text-base font-semibold text-foreground">{po.internalNo}</h2>
                    <p className="ops-subtitle mt-1">{po.supplier?.name} · 1688：{po.externalOrderNo ?? "未录入"}</p>
                  </button>
                  <div className="flex flex-wrap gap-2"><StatusPill value={po.flowStatus} /><StatusPill value={po.receiveStatus} /><span className="inline-flex min-h-7 items-center rounded-full border border-cyan-300/20 bg-cyan-400/10 px-2.5 text-xs text-cyan-200">{paymentState}</span></div>
                </div>
                <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_260px]">
                  <div>
                    <div className="mb-3 grid gap-2 sm:grid-cols-4">
                      <div className="rounded-xl bg-secondary/40 p-3"><p className="ops-label">订购</p><p className="mt-2 font-mono text-xl">{ordered}</p></div>
                      <div className="rounded-xl bg-secondary/40 p-3"><p className="ops-label">已收</p><p className="mt-2 font-mono text-xl text-primary">{received}</p></div>
                      <div className="rounded-xl bg-secondary/40 p-3"><p className="ops-label">未到</p><p className="mt-2 font-mono text-xl text-amber-300">{Math.max(0, ordered - received - po.lines.reduce((sum, line) => sum + line.closedQty, 0))}</p></div>
                      <div className="rounded-xl bg-secondary/40 p-3"><p className="ops-label">关闭量</p><p className="mt-2 font-mono text-xl">{po.lines.reduce((sum, line) => sum + line.closedQty, 0)}</p></div>
                    </div>
                    <div className="table-scroll rounded-xl border"><table className="ops-table min-w-[560px]"><thead><tr><th>SKU</th><th>规格</th><th>数量</th><th>单价</th><th>到货记录</th></tr></thead><tbody>{po.lines.map((line) => <tr key={line.id}><td className="font-mono text-primary">{line.sku?.code}</td><td>{line.supplierSpec}</td><td>{line.receivedQty}/{line.quantity}</td><td className="font-mono">{line.unitPrice === null ? "无权限" : money(line.unitPrice, line.currency)}</td><td>{po.receipts.flatMap((receipt) => receipt.lines.filter((receiptLine) => receiptLine.purchaseOrderLineId === line.id).map((receiptLine) => <p key={receiptLine.id} className="text-xs text-muted-foreground">{dateOnly(receipt.receivedAt)}：实收 {receiptLine.receivedQty} / 合格 {receiptLine.qualifiedQty} / 残次 {receiptLine.defectiveQty} / 待检 {receiptLine.pendingQty}</p>))}</td></tr>)}</tbody></table></div>
                  </div>
                  <aside className="space-y-3">
                    <div className="rounded-xl border bg-secondary/30 p-3"><p className="ops-label">付款汇总</p><p className="mt-2 font-mono text-lg">{data.permissions.finance ? money(paymentTotal, "CNY") : "无权限"}</p><p className="mt-2 text-xs text-muted-foreground">货款合计 {data.permissions.finance ? money(orderTotal, "CNY") : "无权限"}；退款单独展示，不删除原付款。</p></div>
                    <div className="rounded-xl border bg-secondary/30 p-3 text-xs leading-5 text-muted-foreground"><ReceiptText className="mb-2 h-4 w-4 text-primary" />下单：{dateTime(po.orderedAt)}<br />预计到货：{dateTime(po.expectedArrivalAt)}<br />{po.closeReason ? `关闭原因：${po.closeReason}` : "尚未关闭余量"}</div>
                    <Button variant="outline" className="min-h-11 w-full" onClick={() => {
                      const reason = window.prompt("关闭剩余未交数量的原因（保留原订购量与关闭量）");
                      if (reason) closeRemainder.mutate({ purchaseOrderId: po.id, reason });
                    }}>关闭剩余未交</Button>
                  </aside>
                </div>
              </article>
            );
          })}
        </section>
      </div>
    </div>
  );
}
