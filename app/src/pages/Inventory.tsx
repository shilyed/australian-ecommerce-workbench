import { type FormEvent, useMemo, useState } from "react";
import { Link2, PackagePlus, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/workbench/PageHeader";
import { EmptyPanel, LoadingPanel } from "@/components/workbench/States";
import { StatusPill } from "@/components/workbench/StatusPill";
import { dateTime, money, percent } from "@/lib/format";
import { useWorkspace } from "@/hooks/useWorkspace";
import { trpc } from "@/providers/trpc";

export default function Inventory() {
  const workspace = useWorkspace();
  const [query, setQuery] = useState("");
  const [risk, setRisk] = useState("all");
  const createSku = trpc.workbench.createSku.useMutation({
    onSuccess: async () => { toast.success("SKU 已创建，编码全局唯一"); await workspace.refresh(); },
    onError: (error) => toast.error(error.message),
  });
  const linkListing = trpc.workbench.linkListing.useMutation({
    onSuccess: async () => { toast.success("渠道映射已确认；历史订单 SKU 快照不受影响"); await workspace.refresh(); },
    onError: (error) => toast.error(error.message),
  });

  const rows = useMemo(() => {
    const source = workspace.data?.inventory ?? [];
    return source.filter(({ sku, position }) => {
      const available = (position?.qualifiedQty ?? 0) - (position?.reservedQty ?? 0);
      const isLow = available <= sku.alertThreshold;
      const isShortage = (position?.shortageQty ?? 0) > 0;
      const text = `${sku.code} ${sku.name} ${sku.spec}`.toLowerCase();
      return (!query || text.includes(query.toLowerCase())) && (risk === "all" || (risk === "low" && isLow) || (risk === "shortage" && isShortage));
    });
  }, [workspace.data?.inventory, query, risk]);

  if (workspace.isLoading) return <LoadingPanel />;
  if (workspace.error) return <EmptyPanel title="库存加载失败" description={workspace.error.message} action={<Button onClick={() => workspace.refetch()}>重试</Button>} />;
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
      declarationNameEn: String(form.get("declarationNameEn") ?? "") || undefined,
      material: String(form.get("material") ?? "") || undefined,
      originCountry: String(form.get("originCountry") ?? "") || undefined,
      hsCode: String(form.get("hsCode") ?? "") || undefined,
      alertThreshold: Number(form.get("alertThreshold") ?? 0),
    });
    event.currentTarget.reset();
  };

  return (
    <div>
      <PageHeader
        eyebrow="INVENTORY / LEDGER-FIRST"
        title="商品、映射与库存"
        description="实物在库=合格在库+不可售；可售=合格在库−已占用，缺货需求独立展示。任何库存变化都必须产生来源、数量、操作人、幂等键和审计记录。"
      />

      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-4">
          <section className="ops-panel">
            <div className="ops-panel-header"><h2 className="ops-title">新建 SKU</h2><PackagePlus className="h-4 w-4 text-primary" /></div>
            <form onSubmit={submitSku} className="grid gap-3 p-4">
              <div className="grid grid-cols-2 gap-3"><label className="grid gap-1"><span className="ops-label">SKU 编码</span><Input required name="code" className="ops-input font-mono" /></label><label className="grid gap-1"><span className="ops-label">预警值</span><Input name="alertThreshold" type="number" min="0" defaultValue="0" className="ops-input" /></label></div>
              <label className="grid gap-1"><span className="ops-label">SKU 名称</span><Input required name="name" className="ops-input" /></label>
              <label className="grid gap-1"><span className="ops-label">商品名称</span><Input required name="productName" className="ops-input" /></label>
              <label className="grid gap-1"><span className="ops-label">规格</span><Input required name="spec" className="ops-input" /></label>
              <div className="grid grid-cols-2 gap-3"><label className="grid gap-1"><span className="ops-label">重量(g)</span><Input name="weight" type="number" step="0.001" className="ops-input" /></label><label className="grid gap-1"><span className="ops-label">尺寸</span><Input name="dimensions" className="ops-input" placeholder="长×宽×高 cm" /></label></div>
              <label className="grid gap-1"><span className="ops-label">供应商款号</span><Input name="supplierSku" className="ops-input" /></label>
              <label className="grid gap-1"><span className="ops-label">申报英文品名</span><Input name="declarationNameEn" className="ops-input" /></label>
              <div className="grid grid-cols-2 gap-3"><label className="grid gap-1"><span className="ops-label">材质</span><Input name="material" className="ops-input" /></label><label className="grid gap-1"><span className="ops-label">原产地</span><Input name="originCountry" className="ops-input" placeholder="CN" /></label></div>
              <label className="grid gap-1"><span className="ops-label">HS 编码</span><Input name="hsCode" className="ops-input" /></label>
              <Button className="min-h-11" disabled={createSku.isPending}>创建 SKU</Button>
            </form>
          </section>

          <section className="ops-panel">
            <div className="ops-panel-header"><h2 className="ops-title">渠道刊登映射</h2><Link2 className="h-4 w-4 text-amber-300" /></div>
            <div className="space-y-3 p-4">
              {data.listings.map((listing) => (
                <article key={listing.id} className="rounded-xl border bg-secondary/30 p-3">
                  <div className="flex items-start justify-between gap-3"><div><p className="font-medium text-foreground">{listing.title}</p><p className="mt-1 text-xs text-muted-foreground">{listing.platform.toUpperCase()} · {listing.externalShopId} · {listing.externalListingId}/{listing.externalVariantId}</p></div><StatusPill value={listing.skuId ? "confirmed" : "pending"} /></div>
                  <p className="mt-2 text-xs text-muted-foreground">平台 SKU：{listing.platformSku ?? "未提供"} · 当前映射：<span className="font-mono text-primary">{listing.sku?.code ?? "未映射"}</span></p>
                  <p className="mt-1 text-xs text-muted-foreground">售价快照 {money(listing.price, listing.currency)} · 最后同步 {dateTime(listing.lastSyncAt)}</p>
                  <div className="mt-3 flex gap-2"><select id={`sku-${listing.id}`} className="ops-input min-w-0 flex-1" defaultValue={listing.skuId ?? ""}><option value="" disabled>选择 SKU</option>{data.skus.map((sku) => <option key={sku.id} value={sku.id}>{sku.code}</option>)}</select><Button className="min-h-11" variant="outline" onClick={() => {
                    const select = document.getElementById(`sku-${listing.id}`) as HTMLSelectElement | null;
                    const skuId = Number(select?.value);
                    const reason = window.prompt("首次映射/调整原因；已产生订单的历史 SKU 不追溯改变");
                    if (skuId && reason) linkListing.mutate({ listingId: listing.id, skuId, reason });
                  }}>确认映射</Button></div>
                </article>
              ))}
            </div>
          </section>
        </div>

        <section className="ops-panel min-w-0">
          <div className="ops-panel-header flex-col items-stretch gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div><h2 className="ops-title">库存列表</h2><p className="ops-subtitle">单地点 MVP 保留地点标识 MAIN；未来多仓无需改变库存归属</p></div>
            <div className="flex flex-col gap-2 sm:flex-row"><div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} className="ops-input pl-9" placeholder="搜索 SKU / 名称 / 规格" /></div><Select value={risk} onValueChange={setRisk}><SelectTrigger className="min-h-11 sm:w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部</SelectItem><SelectItem value="low">低库存</SelectItem><SelectItem value="shortage">有缺货需求</SelectItem></SelectContent></Select></div>
          </div>
          {rows.length === 0 ? <EmptyPanel title="没有匹配 SKU" description="调整筛选或创建内部 SKU。" /> : (
            <div className="table-scroll"><table className="ops-table"><thead><tr><th>SKU</th><th>实物在库</th><th>合格在库</th><th>不可售</th><th>已占用</th><th>可售</th><th>缺货需求</th><th>批次成本</th><th>最近流水</th></tr></thead><tbody>
              {rows.map(({ sku, position, lots, ledger }) => {
                const available = (position?.qualifiedQty ?? 0) - (position?.reservedQty ?? 0);
                const completeLots = lots.filter((lot) => lot.costStatus === "complete" && lot.qtyRemaining > 0);
                const stockValue = completeLots.reduce((sum, lot) => sum + lot.qtyRemaining * Number(lot.unitCostAud ?? 0), 0);
                return <tr key={sku.id} id={`sku-${sku.id}`}><td><p className="font-mono font-semibold text-primary">{sku.code}</p><p className="mt-1 max-w-64 text-sm text-foreground">{sku.name}</p><p className="mt-1 text-xs text-muted-foreground">{sku.spec} · 预警 {sku.alertThreshold}</p><StatusPill value={sku.status} className="mt-2" /></td><td className="font-mono text-lg">{position?.physicalQty ?? 0}</td><td className="font-mono text-lg">{position?.qualifiedQty ?? 0}</td><td className="font-mono text-lg text-amber-300">{position?.unqualifiedQty ?? 0}</td><td className="font-mono text-lg text-cyan-300">{position?.reservedQty ?? 0}</td><td className={`font-mono text-xl ${available <= sku.alertThreshold ? "text-red-300" : "text-emerald-300"}`}>{available}</td><td className="font-mono text-xl text-red-300">{position?.shortageQty ?? 0}</td><td>{lots.length === 0 ? <span className="text-muted-foreground">无批次</span> : <div className="space-y-2">{lots.slice(0, 3).map((lot) => <div key={lot.id} className="rounded-lg bg-secondary/35 p-2 text-xs"><p className="font-mono text-foreground">{lot.batchCode}</p><p className="mt-1 text-muted-foreground">余 {lot.qtyRemaining} · {lot.costStatus === "complete" ? money(lot.unitCostAud, "AUD") : "成本待补"}</p></div>)}<p className="mt-2 text-xs text-muted-foreground">已核实估值：{money(stockValue, "AUD")}</p></div>}</td><td><div className="max-w-72 space-y-2">{ledger.slice(0, 3).map((entry) => <p key={entry.id} className="text-xs leading-5 text-muted-foreground"><span className="text-foreground">{entry.type}</span> · 合格 {entry.qualifiedDelta} / 占用 {entry.reservedDelta}<br />{dateTime(entry.createdAt)}</p>)}</div></td></tr>;
              })}
            </tbody></table></div>
          )}
          <div className="border-t p-4 text-xs leading-6 text-muted-foreground">库存估值覆盖率只统计成本完整批次；缺成本部分单独披露，不按零隐藏。FIFO 是管理核算建议，不替代法定会计政策。利润核实覆盖率见成本报表：{percent(data.report.filter((row) => row.profitStatus === "verified").length / Math.max(1, data.report.length))}</div>
        </section>
      </div>
    </div>
  );
}
