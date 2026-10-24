import { type FormEvent, useMemo, useState } from "react";
import { Link2, PackagePlus, Search } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { incomingQuantity } from "@contracts/merchant-workflow";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/workbench/PageHeader";
import { FormSheet } from "@/components/workbench/FormSheet";
import {
  DecisionDialog,
  type DecisionRequest,
} from "@/components/workbench/DecisionDialog";
import { EmptyPanel, LoadingPanel } from "@/components/workbench/States";
import { StatusPill } from "@/components/workbench/StatusPill";
import { dateTime, money } from "@/lib/format";
import { useWorkspace } from "@/hooks/useWorkspace";
import { trpc } from "@/providers/trpc";

export default function CatalogPage() {
  const workspace = useWorkspace();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [decision, setDecision] = useState<DecisionRequest | null>(null);
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
  const risk = params.get("risk") ?? "all";
  const setRisk = (value: string) =>
    setParams(previous => {
      const next = new URLSearchParams(previous);
      next.set("risk", value);
      return next;
    });
  const createSku = trpc.workbench.createSku.useMutation({
    onSuccess: async () => {
      toast.success("SKU 已创建，编码全局唯一");
      setPanel("create", false);
      await workspace.refresh();
    },
    onError: error => toast.error(error.message),
  });
  const linkListing = trpc.workbench.linkListing.useMutation({
    onSuccess: async () => {
      toast.success("渠道映射已确认；历史订单 SKU 快照不受影响");
      setPanel("mapping", false);
      await workspace.refresh();
    },
    onError: error => toast.error(error.message),
  });

  const rows = useMemo(() => {
    const source = workspace.data?.inventory ?? [];
    return source
      .filter(({ sku, position }) => {
        const available =
          (position?.qualifiedQty ?? 0) - (position?.reservedQty ?? 0);
        const isLow = available <= sku.alertThreshold;
        const isShortage = (position?.shortageQty ?? 0) > 0;
        const text = `${sku.code} ${sku.name} ${sku.spec}`.toLowerCase();
        return (
          (!query || text.includes(query.toLowerCase())) &&
          (risk === "all" ||
            (risk === "low" && isLow) ||
            (risk === "shortage" && isShortage))
        );
      })
      .sort(
        (a, b) =>
          Number(b.sku.id === Number(params.get("focus"))) -
          Number(a.sku.id === Number(params.get("focus")))
      );
  }, [workspace.data?.inventory, query, risk, params]);

  if (workspace.isLoading) return <LoadingPanel />;
  if (workspace.error)
    return (
      <EmptyPanel
        title="库存加载失败"
        description={workspace.error.message}
        action={<Button onClick={() => workspace.refetch()}>重试</Button>}
      />
    );
  const data = workspace.data!;

  const submitSku = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    createSku.mutate({
      code: String(form.get("code") ?? ""),
      name: String(form.get("name") ?? ""),
      productName: String(form.get("productName") ?? ""),
      spec: String(form.get("spec") ?? ""),
      weight: String(form.get("weight") ?? "") || undefined,
      dimensions: String(form.get("dimensions") ?? "") || undefined,
      supplierSku: String(form.get("supplierSku") ?? "") || undefined,
      declarationNameEn:
        String(form.get("declarationNameEn") ?? "") || undefined,
      material: String(form.get("material") ?? "") || undefined,
      originCountry: String(form.get("originCountry") ?? "") || undefined,
      hsCode: String(form.get("hsCode") ?? "") || undefined,
      alertThreshold: Number(form.get("alertThreshold") ?? 0),
    });
  };

  return (
    <div>
      <PageHeader eyebrow="商品 / 库存与补货" title="商品与补货" />

      <div className="grid gap-4">
        <div className="flex flex-wrap items-start gap-2">
          <FormSheet
            title="新建商品 / SKU"
            open={params.get("panel") === "create"}
            onOpenChange={open => {
              if (open) createSku.reset();
              setPanel("create", open);
            }}
            pending={createSku.isPending}
            error={createSku.error?.message}
            trigger={
              <Button disabled={createSku.isPending}>
                <PackagePlus className="mr-2 h-4 w-4" />
                新建商品 / SKU
              </Button>
            }
          >
            <form onSubmit={submitSku} className="grid gap-3 p-4">
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1">
                  <span className="ops-label">SKU 编码</span>
                  <Input required name="code" className="ops-input font-mono" />
                </label>
                <label className="grid gap-1">
                  <span className="ops-label">预警值</span>
                  <Input
                    name="alertThreshold"
                    type="number"
                    min="0"
                    defaultValue="0"
                    className="ops-input"
                  />
                </label>
              </div>
              <label className="grid gap-1">
                <span className="ops-label">SKU 名称</span>
                <Input required name="name" className="ops-input" />
              </label>
              <label className="grid gap-1">
                <span className="ops-label">商品名称</span>
                <Input required name="productName" className="ops-input" />
              </label>
              <label className="grid gap-1">
                <span className="ops-label">规格</span>
                <Input required name="spec" className="ops-input" />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1">
                  <span className="ops-label">重量(g)</span>
                  <Input
                    name="weight"
                    type="number"
                    step="0.001"
                    className="ops-input"
                  />
                </label>
                <label className="grid gap-1">
                  <span className="ops-label">尺寸</span>
                  <Input
                    name="dimensions"
                    className="ops-input"
                    placeholder="长×宽×高 cm"
                  />
                </label>
              </div>
              <label className="grid gap-1">
                <span className="ops-label">供应商款号</span>
                <Input name="supplierSku" className="ops-input" />
              </label>
              <label className="grid gap-1">
                <span className="ops-label">申报英文品名</span>
                <Input name="declarationNameEn" className="ops-input" />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1">
                  <span className="ops-label">材质</span>
                  <Input name="material" className="ops-input" />
                </label>
                <label className="grid gap-1">
                  <span className="ops-label">原产地</span>
                  <Input
                    name="originCountry"
                    className="ops-input"
                    placeholder="CN"
                  />
                </label>
              </div>
              <label className="grid gap-1">
                <span className="ops-label">HS 编码</span>
                <Input name="hsCode" className="ops-input" />
              </label>
              <Button className="min-h-11" disabled={createSku.isPending}>
                创建 SKU
              </Button>
            </form>
          </FormSheet>

          <FormSheet
            title="匹配平台商品与库存商品"
            open={params.get("panel") === "mapping"}
            onOpenChange={open => {
              if (open) linkListing.reset();
              setPanel("mapping", open);
            }}
            pending={linkListing.isPending}
            error={linkListing.error?.message}
            trigger={
              <Button variant="outline" disabled={linkListing.isPending}>
                <Link2 className="mr-2 h-4 w-4" />
                匹配平台商品
              </Button>
            }
          >
            <div className="space-y-3 p-4">
              {data.listings.length === 0 && (
                <EmptyPanel title="暂无可映射的平台商品" />
              )}
              {data.listings.map(listing => (
                <article
                  key={listing.id}
                  className="rounded-xl border bg-secondary/30 p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-foreground">
                        {listing.title}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {listing.platform.toUpperCase()} ·{" "}
                        {listing.externalShopId} · {listing.externalListingId}/
                        {listing.externalVariantId}
                      </p>
                    </div>
                    <StatusPill
                      value={listing.skuId ? "confirmed" : "pending"}
                    />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    平台 SKU：{listing.platformSku ?? "未提供"} · 当前映射：
                    <span className="font-mono text-primary">
                      {listing.sku?.code ?? "未映射"}
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    售价快照 {money(listing.price, listing.currency)} · 最后同步{" "}
                    {dateTime(listing.lastSyncAt)}
                  </p>
                  <div className="mt-3 flex gap-2">
                    <select
                      id={`mapping-sku-${listing.id}`}
                      className="ops-input min-w-0 flex-1"
                      defaultValue={listing.skuId ?? ""}
                    >
                      <option value="" disabled>
                        选择 SKU
                      </option>
                      {data.skus.map(sku => (
                        <option key={sku.id} value={sku.id}>
                          {sku.code}
                        </option>
                      ))}
                    </select>
                    <Button
                      className="min-h-11"
                      variant="outline"
                      onClick={() => {
                        const select = document.getElementById(
                          `mapping-sku-${listing.id}`
                        );
                        const skuId =
                          select instanceof HTMLSelectElement
                            ? Number(select.value)
                            : 0;
                        if (!skuId) {
                          toast.error("请先选择需要映射的 SKU");
                          return;
                        }
                        setDecision({
                          title: "确认平台商品映射",
                          description: `${listing.title} · 不追溯历史订单`,
                          fields: [
                            {
                              name: "reason",
                              label: "映射 / 调整原因",
                              type: "textarea",
                            },
                          ],
                          onConfirm: form =>
                            linkListing.mutateAsync({
                              listingId: listing.id,
                              skuId,
                              reason: String(form.get("reason") ?? "").trim(),
                            }),
                        });
                      }}
                    >
                      确认映射
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          </FormSheet>
        </div>

        <section className="ops-panel min-w-0">
          <div className="ops-panel-header flex-col items-stretch gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="ops-title">库存与补货</h2>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  className="ops-input pl-9"
                  placeholder="搜索 SKU / 名称 / 规格"
                />
              </div>
              <Select value={risk} onValueChange={setRisk}>
                <SelectTrigger className="min-h-11 sm:w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部</SelectItem>
                  <SelectItem value="low">低库存</SelectItem>
                  <SelectItem value="shortage">有缺货需求</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DecisionDialog
              key={decision?.title ?? "closed"}
              request={decision}
              onClose={() => setDecision(null)}
            />
          </div>
          {rows.length === 0 ? (
            <EmptyPanel title="没有匹配 SKU" />
          ) : (
            <div className="table-scroll">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>商品</th>
                    <th>还能卖</th>
                    <th>待发已预留</th>
                    <th>订单缺口</th>
                    <th>采购在途</th>
                    <th>补货 / 明细</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ sku, position, lots, ledger }) => {
                    const available =
                      (position?.qualifiedQty ?? 0) -
                      (position?.reservedQty ?? 0);
                    const completeLots = lots.filter(
                      lot =>
                        lot.costStatus === "complete" && lot.qtyRemaining > 0
                    );
                    const stockValue = completeLots.reduce(
                      (sum, lot) =>
                        sum + lot.qtyRemaining * Number(lot.unitCostAud ?? 0),
                      0
                    );
                    const incoming = incomingQuantity(
                      data.purchaseOrders,
                      sku.id
                    );
                    const uncovered = Math.max(
                      0,
                      (position?.shortageQty ?? 0) - incoming
                    );
                    return (
                      <tr
                        key={sku.id}
                        id={`sku-${sku.id}`}
                        className={
                          sku.id === Number(params.get("focus"))
                            ? "bg-accent/25"
                            : ""
                        }
                      >
                        <td>
                          <Link
                            to={`/products/${sku.id}`}
                            className="font-mono font-semibold text-primary hover:underline"
                            title="打开商品详情 / 市场刊登"
                          >
                            {sku.code}
                          </Link>
                          <p className="mt-1 text-sm">{sku.name}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {sku.spec} · 预警 {sku.alertThreshold}
                          </p>
                          <StatusPill value={sku.status} className="mt-2" />
                        </td>
                        <td
                          className={
                            available <= sku.alertThreshold
                              ? "text-destructive"
                              : ""
                          }
                        >
                          {available}
                        </td>
                        <td>{position?.reservedQty ?? 0}</td>
                        <td>{position?.shortageQty ?? 0}</td>
                        <td>
                          {incoming}
                          <p className="mt-1 text-xs text-muted-foreground">
                            仍需补缺口 {uncovered}
                          </p>
                        </td>
                        <td>
                          <Button asChild size="sm" variant="outline">
                            <Link
                              to={`/procurement?sku=${sku.id}${uncovered > 0 ? `&quantity=${uncovered}` : ""}`}
                            >
                              创建采购
                            </Link>
                          </Button>
                          <details className="mt-3 max-w-80">
                            <summary className="cursor-pointer text-xs text-primary">
                              库存账与批次
                            </summary>
                            <p className="mt-2 text-xs text-muted-foreground">
                              实物 {position?.physicalQty ?? 0} · 合格{" "}
                              {position?.qualifiedQty ?? 0} · 不可售{" "}
                              {position?.unqualifiedQty ?? 0}
                            </p>
                            <p className="mt-2 text-xs text-muted-foreground">
                              成本完整批次估值：{money(stockValue, "AUD")}
                            </p>
                            {lots.slice(0, 3).map(lot => (
                              <p key={lot.id} className="mt-2 text-xs">
                                {lot.batchCode} · 余 {lot.qtyRemaining} ·{" "}
                                {lot.costStatus === "complete"
                                  ? money(lot.unitCostAud, "AUD")
                                  : "成本待补"}
                              </p>
                            ))}
                            {ledger.slice(0, 3).map(entry => (
                              <p
                                key={entry.id}
                                className="mt-2 text-xs text-muted-foreground"
                              >
                                {entry.type} · 合格 {entry.qualifiedDelta} /
                                预留 {entry.reservedDelta} ·{" "}
                                {dateTime(entry.createdAt)}
                              </p>
                            ))}
                          </details>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
