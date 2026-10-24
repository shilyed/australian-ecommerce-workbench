import { type FormEvent, useMemo, useState } from "react";
import {
  CircleDollarSign,
  PackagePlus,
  ReceiptText,
  Truck,
} from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { incomingQuantity } from "@contracts/merchant-workflow";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/workbench/PageHeader";
import { FormSheet } from "@/components/workbench/FormSheet";
import {
  DecisionDialog,
  type DecisionRequest,
} from "@/components/workbench/DecisionDialog";
import { EmptyPanel, LoadingPanel } from "@/components/workbench/States";
import { StatusPill } from "@/components/workbench/StatusPill";
import { dateOnly, dateTime, money } from "@/lib/format";
import { useWorkspace } from "@/hooks/useWorkspace";
import { trpc } from "@/providers/trpc";

export default function PurchasingPage() {
  const workspace = useWorkspace();
  const [params, setParams] = useSearchParams();
  const setPanel = (panel: string, open: boolean) =>
    setParams(
      previous => {
        const next = new URLSearchParams(previous);
        if (open) next.set("panel", panel);
        else if (next.get("panel") === panel) next.delete("panel");
        return next;
      },
      { replace: true }
    );
  const [selectedPoId, setSelectedPoId] = useState<number | null>(null);
  const [receiptLineId, setReceiptLineId] = useState<number | null>(null);
  const [decision, setDecision] = useState<DecisionRequest | null>(null);
  const createPo = trpc.workbench.createPurchaseOrder.useMutation({
    onSuccess: async () => {
      toast.success("采购单已创建，收货质检合格后会增加可售库存");
      setParams(
        previous => {
          const next = new URLSearchParams(previous);
          for (const key of ["panel", "sku", "quantity"]) next.delete(key);
          return next;
        },
        { replace: true }
      );
      await workspace.refresh();
    },
    onError: error => toast.error(error.message),
  });
  const addPayment = trpc.workbench.addPayment.useMutation({
    onSuccess: async result => {
      toast.success(
        result.duplicated
          ? "重复付款请求已被幂等忽略"
          : "付款记录已保存（不代表真实支付）"
      );
      setPanel("payment", false);
      await workspace.refresh();
    },
    onError: error => toast.error(error.message),
  });
  const postReceipt = trpc.workbench.postReceipt.useMutation({
    onSuccess: async result => {
      toast.success(
        result.duplicated
          ? "重复收货请求只过账一次"
          : result.rateMissing
            ? "收货已过账，但缺 CNY/AUD 汇率，成本待补"
            : "到货质检已过账"
      );
      setPanel("receipt", false);
      await workspace.refresh();
    },
    onError: error => toast.error(error.message),
  });
  const closeRemainder = trpc.workbench.closePurchaseRemainder.useMutation({
    onSuccess: async () => {
      toast.success("剩余未交数量已关闭并保留原因");
      await workspace.refresh();
    },
    onError: error => toast.error(error.message),
  });

  const data = workspace.data;
  const selectedPo = useMemo(() => {
    const source = (data?.purchaseOrders ?? []).filter(
      po =>
        params.get("view") !== "receiving" ||
        (po.flowStatus === "ordered" &&
          po.lines.some(
            line => line.quantity > line.receivedQty + line.closedQty
          ))
    );
    return (
      source.find(
        po => po.id === (selectedPoId ?? Number(params.get("focus")))
      ) ?? source.at(0)
    );
  }, [data?.purchaseOrders, selectedPoId, params]);
  const receiptLine =
    selectedPo?.lines.find(line => line.id === receiptLineId) ??
    selectedPo?.lines.find(
      line => line.quantity > line.receivedQty + line.closedQty
    );
  const unreceivedQty = receiptLine
    ? Math.max(
        0,
        receiptLine.quantity - receiptLine.receivedQty - receiptLine.closedQty
      )
    : 0;

  if (workspace.isLoading) return <LoadingPanel />;
  if (workspace.error)
    return (
      <EmptyPanel
        title="采购数据加载失败"
        description={workspace.error.message}
        action={<Button onClick={() => workspace.refetch()}>重试</Button>}
      />
    );
  if (!data) return null;
  const restockSku = data.skus.find(
    sku => sku.id === Number(params.get("sku"))
  );
  const incoming = restockSku
    ? incomingQuantity(data.purchaseOrders, restockSku.id)
    : 0;
  const visiblePurchases = data.purchaseOrders.filter(
    po =>
      params.get("view") !== "receiving" ||
      (po.flowStatus === "ordered" &&
        po.lines.some(
          line => line.quantity > line.receivedQty + line.closedQty
        ))
  );

  const submitPo = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    createPo.mutate({
      internalNo: String(form.get("internalNo") ?? ""),
      supplierId: Number(form.get("supplierId")),
      externalOrderNo: String(form.get("externalOrderNo") ?? "") || undefined,
      externalOrderUrl: String(form.get("externalOrderUrl") ?? "") || undefined,
      expectedArrivalAt: String(form.get("expectedArrivalAt") ?? "")
        ? new Date(String(form.get("expectedArrivalAt")))
        : undefined,
      notes: String(form.get("notes") ?? ""),
      flowStatus: "ordered",
      lines: [
        {
          skuId: Number(form.get("skuId")),
          supplierSpec: String(form.get("supplierSpec") ?? ""),
          quantity: Number(form.get("quantity")),
          unitPrice: String(form.get("unitPrice") ?? ""),
          currency: "CNY",
          discount: 0,
        },
      ],
    });
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
      lines: [
        {
          purchaseOrderLineId: Number(form.get("lineId")),
          receivedQty: Number(form.get("receivedQty")),
          qualifiedQty: Number(form.get("qualifiedQty")),
          defectiveQty: Number(form.get("defectiveQty")),
          pendingQty: Number(form.get("pendingQty")),
          overReceiptReason:
            String(form.get("overReceiptReason") ?? "") || undefined,
        },
      ],
    });
  };

  return (
    <div>
      <PageHeader
        eyebrow="供应链 / 采购与收货"
        title="采购与收货"
        description="缺货商品可直接带入采购。记录付款不会增加库存，到货后核对数量并完成质检。"
        actions={
          <Button asChild variant="outline">
            <Link to="/inventory?risk=shortage">查看缺货商品</Link>
          </Button>
        }
      />
      {restockSku && (
        <section className="ops-panel mb-4 p-4">
          <p className="font-semibold">
            为 {restockSku.name} · {restockSku.code} 补货
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            已带入商品与未被在途覆盖的缺口数量，请确认采购量、供应商和单价。当前在途{" "}
            {incoming} 件，避免重复采购。
          </p>
        </section>
      )}
      {params.get("view") === "receiving" && (
        <p className="mb-4 text-sm text-muted-foreground">
          当前仅展示待收货采购单。
          <Link className="ml-2 text-primary" to="/procurement">
            查看全部采购
          </Link>
        </p>
      )}

      <div
        className={
          restockSku
            ? "grid gap-4 xl:grid-cols-[390px_minmax(0,1fr)]"
            : "space-y-6"
        }
      >
        <div className="flex flex-wrap items-start gap-2">
          <FormSheet
            title="创建采购单"
            description="付款与库存分开记录，只有收货质检合格后才增加可售库存。"
            open={params.get("panel") === "create"}
            onOpenChange={open => {
              if (open) createPo.reset();
              setPanel("create", open);
            }}
            inline={restockSku !== undefined}
            pending={createPo.isPending}
            error={createPo.error?.message}
            trigger={
              <Button disabled={createPo.isPending}>
                <PackagePlus className="mr-2 h-4 w-4" />
                创建采购单
              </Button>
            }
          >
            <form
              key={restockSku?.id ?? "new"}
              onSubmit={submitPo}
              className="grid gap-3 p-4"
            >
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1">
                  <span className="ops-label">内部编号</span>
                  <Input
                    required
                    name="internalNo"
                    className="ops-input"
                    placeholder={`PO-202610-${String(data.purchaseOrders.length + 1).padStart(3, "0")}`}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="ops-label">供应商</span>
                  <select
                    required
                    name="supplierId"
                    className="ops-input"
                    defaultValue=""
                  >
                    <option value="" disabled>
                      选择
                    </option>
                    {data.suppliers.map(supplier => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplier.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="grid gap-1">
                <span className="ops-label">1688 订单号</span>
                <Input name="externalOrderNo" className="ops-input" />
              </label>
              <label className="grid gap-1">
                <span className="ops-label">1688 订单链接</span>
                <Input
                  name="externalOrderUrl"
                  type="url"
                  className="ops-input"
                />
              </label>
              <label className="grid gap-1">
                <span className="ops-label">预计到货</span>
                <Input
                  name="expectedArrivalAt"
                  type="datetime-local"
                  className="ops-input"
                />
              </label>
              <div className="rounded-xl border bg-secondary/30 p-3">
                <p className="ops-label mb-3">第一条采购明细</p>
                <div className="grid gap-3">
                  <label className="grid gap-1">
                    <span className="ops-label">SKU</span>
                    <select
                      required
                      name="skuId"
                      className="ops-input"
                      defaultValue={restockSku?.id ?? ""}
                    >
                      <option value="" disabled>
                        选择 SKU
                      </option>
                      {data.skus.map(sku => (
                        <option key={sku.id} value={sku.id}>
                          {sku.code} · {sku.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1">
                    <span className="ops-label">供应商规格</span>
                    <Input
                      required
                      name="supplierSpec"
                      defaultValue={restockSku?.spec}
                      className="ops-input"
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="grid gap-1">
                      <span className="ops-label">数量</span>
                      <Input
                        required
                        name="quantity"
                        type="number"
                        min="1"
                        defaultValue={
                          Number(params.get("quantity")) > 0
                            ? Number(params.get("quantity"))
                            : undefined
                        }
                        className="ops-input"
                      />
                    </label>
                    <label className="grid gap-1">
                      <span className="ops-label">单价 CNY</span>
                      <Input
                        required
                        name="unitPrice"
                        type="number"
                        min="0"
                        step="0.0001"
                        className="ops-input"
                      />
                    </label>
                  </div>
                </div>
              </div>
              <label className="grid gap-1">
                <span className="ops-label">备注</span>
                <Textarea name="notes" className="min-h-20 bg-secondary/70" />
              </label>
              <Button className="min-h-11" disabled={createPo.isPending}>
                创建采购单
              </Button>
            </form>
          </FormSheet>

          <FormSheet
            title="付款 / 供应商退款"
            description="记录现金事实，不代表真实支付，也不会增加库存。"
            open={params.get("panel") === "payment"}
            onOpenChange={open => {
              if (open) addPayment.reset();
              setPanel("payment", open);
            }}
            pending={addPayment.isPending}
            error={addPayment.error?.message}
            trigger={
              <Button
                variant="outline"
                disabled={!selectedPo || addPayment.isPending}
              >
                <CircleDollarSign className="mr-2 h-4 w-4" />
                记录付款 / 退款
              </Button>
            }
          >
            <form onSubmit={submitPayment} className="grid gap-3 p-4">
              <label className="grid gap-1">
                <span className="ops-label">采购单</span>
                <select
                  value={selectedPo?.id ?? ""}
                  onChange={event =>
                    setSelectedPoId(Number(event.target.value))
                  }
                  className="ops-input"
                >
                  {data.purchaseOrders.map(po => (
                    <option key={po.id} value={po.id}>
                      {po.internalNo}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1">
                  <span className="ops-label">类型</span>
                  <select
                    name="type"
                    className="ops-input"
                    defaultValue="payment"
                  >
                    <option value="payment">付款</option>
                    <option value="supplier_refund">采购退回款</option>
                  </select>
                </label>
                <label className="grid gap-1">
                  <span className="ops-label">实际日期</span>
                  <Input
                    required
                    name="paidAt"
                    type="datetime-local"
                    className="ops-input"
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1">
                  <span className="ops-label">金额 CNY</span>
                  <Input
                    required
                    name="amount"
                    type="number"
                    min="0"
                    step="0.01"
                    className="ops-input"
                  />
                </label>
                <label className="grid gap-1">
                  <span className="ops-label">参考流水号</span>
                  <Input name="referenceNo" className="ops-input" />
                </label>
              </div>
              <label className="grid gap-1">
                <span className="ops-label">说明</span>
                <Textarea name="note" className="min-h-16 bg-secondary/70" />
              </label>
              <Button
                className="min-h-11"
                variant="secondary"
                disabled={addPayment.isPending || !selectedPo}
              >
                记录现金事实
              </Button>
            </form>
          </FormSheet>

          <FormSheet
            title="分批到货与质检"
            description="按实际到货与质检结果过账，只有合格品增加可售库存。"
            open={params.get("panel") === "receipt"}
            onOpenChange={open => {
              if (open) postReceipt.reset();
              setPanel("receipt", open);
            }}
            pending={postReceipt.isPending}
            error={postReceipt.error?.message}
            trigger={
              <Button
                variant="outline"
                disabled={!selectedPo || postReceipt.isPending}
              >
                <Truck className="mr-2 h-4 w-4" />
                到货与质检
              </Button>
            }
          >
            <form
              key={`${selectedPo?.id}-${receiptLine?.id}-${unreceivedQty}`}
              onSubmit={submitReceipt}
              className="grid gap-3 p-4"
            >
              <p className="text-sm font-medium">
                正在收货：{selectedPo?.internalNo ?? "请先选择采购单"}
              </p>
              <label className="grid gap-1">
                <span className="ops-label">采购明细</span>
                <select
                  required
                  name="lineId"
                  value={receiptLine?.id ?? ""}
                  onChange={event =>
                    setReceiptLineId(Number(event.target.value))
                  }
                  className="ops-input"
                >
                  {selectedPo?.lines.map(line => (
                    <option key={line.id} value={line.id}>
                      {line.sku?.code} · 已收 {line.receivedQty}/{line.quantity}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1">
                <span className="ops-label">到货时间</span>
                <Input
                  required
                  name="receivedAt"
                  type="datetime-local"
                  className="ops-input"
                />
              </label>
              <p className="text-xs text-muted-foreground">
                该明细未收 {unreceivedQty}{" "}
                件。实收已预填未收数量，请按实际到货与质检结果修改。
              </p>
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1">
                  <span className="ops-label">实收</span>
                  <Input
                    required
                    name="receivedQty"
                    type="number"
                    min="1"
                    defaultValue={unreceivedQty || undefined}
                    className="ops-input"
                  />
                </label>
                <label className="grid gap-1">
                  <span className="ops-label">合格</span>
                  <Input
                    required
                    name="qualifiedQty"
                    type="number"
                    min="0"
                    defaultValue="0"
                    className="ops-input"
                  />
                </label>
                <label className="grid gap-1">
                  <span className="ops-label">残次</span>
                  <Input
                    required
                    name="defectiveQty"
                    type="number"
                    min="0"
                    defaultValue="0"
                    className="ops-input"
                  />
                </label>
                <label className="grid gap-1">
                  <span className="ops-label">待检</span>
                  <Input
                    required
                    name="pendingQty"
                    type="number"
                    min="0"
                    defaultValue={unreceivedQty}
                    className="ops-input"
                  />
                </label>
              </div>
              <label className="grid gap-1">
                <span className="ops-label">超收原因（如适用）</span>
                <Input name="overReceiptReason" className="ops-input" />
              </label>
              <label className="grid gap-1">
                <span className="ops-label">收货说明</span>
                <Textarea name="note" className="min-h-16 bg-secondary/70" />
              </label>
              <Button
                className="min-h-11"
                disabled={postReceipt.isPending || !selectedPo}
              >
                确认收货与质检
              </Button>
              <p className="text-xs leading-5 text-muted-foreground">
                系统强制：实收 = 合格 + 残次 + 待检；仅合格品增加可售库存。
              </p>
            </form>
          </FormSheet>
        </div>

        <section className="space-y-4 min-w-0">
          {visiblePurchases.length === 0 ? (
            <EmptyPanel
              title="暂无符合条件的采购单"
              description="先创建供应商和商品，再创建采购；已有采购可切换到全部查看。"
            />
          ) : (
            visiblePurchases.map(po => {
              const ordered = po.lines.reduce(
                (sum, line) => sum + line.quantity,
                0
              );
              const received = po.lines.reduce(
                (sum, line) => sum + line.receivedQty,
                0
              );
              const paymentTotal = po.payments.reduce(
                (sum, payment) =>
                  sum +
                  (payment.type === "payment"
                    ? Number(payment.amount)
                    : -Number(payment.amount)),
                0
              );
              const orderTotal = po.lines.reduce(
                (sum, line) =>
                  sum +
                  Number(line.unitPrice ?? 0) * line.quantity -
                  Number(line.discount ?? 0),
                0
              );
              const paymentState =
                paymentTotal <= 0
                  ? "未付款"
                  : paymentTotal < orderTotal
                    ? "部分付款"
                    : paymentTotal === orderTotal
                      ? "已付款"
                      : "超额/差异待核对";
              return (
                <article
                  key={po.id}
                  className={`ops-panel ${selectedPo?.id === po.id ? "ring-1 ring-primary/60" : ""}`}
                >
                  <div className="ops-panel-header">
                    <button
                      type="button"
                      className="min-h-11 text-left"
                      onClick={() => setSelectedPoId(po.id)}
                    >
                      <h2 className="text-base font-semibold text-foreground">
                        {po.internalNo}
                      </h2>
                      <p className="ops-subtitle mt-1">
                        {po.supplier?.name} · 1688：
                        {po.externalOrderNo ?? "未录入"}
                      </p>
                    </button>
                    <div className="flex flex-wrap gap-2">
                      <StatusPill value={po.flowStatus} />
                      <StatusPill value={po.receiveStatus} />
                      <span className="inline-flex min-h-7 items-center rounded-full border border-cyan-300/20 bg-cyan-400/10 px-2.5 text-xs text-cyan-200">
                        {paymentState}
                      </span>
                    </div>
                  </div>
                  <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_260px]">
                    <div>
                      <div className="mb-3 grid gap-2 sm:grid-cols-4">
                        <div className="rounded-xl bg-secondary/40 p-3">
                          <p className="ops-label">订购</p>
                          <p className="mt-2 text-xl font-semibold tabular-nums">
                            {ordered}
                          </p>
                        </div>
                        <div className="rounded-xl bg-secondary/40 p-3">
                          <p className="ops-label">已收</p>
                          <p className="mt-2 text-xl font-semibold tabular-nums text-primary">
                            {received}
                          </p>
                        </div>
                        <div className="rounded-xl bg-secondary/40 p-3">
                          <p className="ops-label">未到</p>
                          <p className="mt-2 text-xl font-semibold tabular-nums text-amber-300">
                            {Math.max(
                              0,
                              ordered -
                                received -
                                po.lines.reduce(
                                  (sum, line) => sum + line.closedQty,
                                  0
                                )
                            )}
                          </p>
                        </div>
                        <div className="rounded-xl bg-secondary/40 p-3">
                          <p className="ops-label">关闭量</p>
                          <p className="mt-2 text-xl font-semibold tabular-nums">
                            {po.lines.reduce(
                              (sum, line) => sum + line.closedQty,
                              0
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="table-scroll rounded-xl border">
                        <table className="ops-table min-w-[560px]">
                          <thead>
                            <tr>
                              <th>SKU</th>
                              <th>规格</th>
                              <th>数量</th>
                              <th>单价</th>
                              <th>到货记录</th>
                            </tr>
                          </thead>
                          <tbody>
                            {po.lines.map(line => (
                              <tr key={line.id}>
                                <td className="font-mono text-primary">
                                  {line.sku?.code}
                                </td>
                                <td>{line.supplierSpec}</td>
                                <td>
                                  {line.receivedQty}/{line.quantity}
                                </td>
                                <td className="tabular-nums">
                                  {line.unitPrice === null
                                    ? "无权限"
                                    : money(line.unitPrice, line.currency)}
                                </td>
                                <td>
                                  {po.receipts.flatMap(receipt =>
                                    receipt.lines
                                      .filter(
                                        receiptLine =>
                                          receiptLine.purchaseOrderLineId ===
                                          line.id
                                      )
                                      .map(receiptLine => (
                                        <p
                                          key={receiptLine.id}
                                          className="text-xs text-muted-foreground"
                                        >
                                          {dateOnly(receipt.receivedAt)}：实收{" "}
                                          {receiptLine.receivedQty} / 合格{" "}
                                          {receiptLine.qualifiedQty} / 残次{" "}
                                          {receiptLine.defectiveQty} / 待检{" "}
                                          {receiptLine.pendingQty}
                                        </p>
                                      ))
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    <aside className="space-y-3">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedPoId(po.id);
                            addPayment.reset();
                            setPanel("payment", true);
                          }}
                        >
                          记录付款
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedPoId(po.id);
                            postReceipt.reset();
                            setPanel("receipt", true);
                          }}
                        >
                          收货质检
                        </Button>
                      </div>
                      <div className="rounded-xl border bg-secondary/30 p-3">
                        <p className="ops-label">付款汇总</p>
                        <p className="mt-2 text-lg font-semibold tabular-nums">
                          {data.permissions.finance
                            ? money(paymentTotal, "CNY")
                            : "无权限"}
                        </p>
                        <p className="mt-2 text-xs text-muted-foreground">
                          货款合计{" "}
                          {data.permissions.finance
                            ? money(orderTotal, "CNY")
                            : "无权限"}
                          ；退款单独展示，不删除原付款。
                        </p>
                      </div>
                      <div className="rounded-xl border bg-secondary/30 p-3 text-xs leading-5 text-muted-foreground">
                        <ReceiptText className="mb-2 h-4 w-4 text-primary" />
                        下单：{dateTime(po.orderedAt)}
                        <br />
                        预计到货：{dateTime(po.expectedArrivalAt)}
                        <br />
                        {po.closeReason
                          ? `关闭原因：${po.closeReason}`
                          : "尚未关闭余量"}
                      </div>
                      <Button
                        variant="outline"
                        className="min-h-11 w-full"
                        onClick={() => {
                          setDecision({
                            title: "关闭剩余未交数量",
                            description: `${po.internalNo}：保留原订购量与关闭量，填写原因后确认。`,
                            fields: [
                              {
                                name: "reason",
                                label: "关闭原因",
                                type: "textarea",
                              },
                            ],
                            onConfirm: form =>
                              closeRemainder.mutateAsync({
                                purchaseOrderId: po.id,
                                reason: String(form.get("reason") ?? "").trim(),
                              }),
                          });
                        }}
                      >
                        关闭剩余未交
                      </Button>
                    </aside>
                  </div>
                </article>
              );
            })
          )}
        </section>
      </div>
      <DecisionDialog
        key={decision?.title ?? "closed"}
        request={decision}
        onClose={() => setDecision(null)}
      />
    </div>
  );
}
