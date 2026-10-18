import { type FormEvent, useMemo, useState } from "react";
import { FilePlus2, Search, UserRoundCheck } from "lucide-react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/workbench/PageHeader";
import { EmptyPanel, LoadingPanel } from "@/components/workbench/States";
import { StatusPill } from "@/components/workbench/StatusPill";
import { dateTime, label, money } from "@/lib/format";
import { useWorkspace } from "@/hooks/useWorkspace";
import { trpc } from "@/providers/trpc";

export default function Orders() {
  const workspace = useWorkspace();
  const [params] = useSearchParams();
  const focusId = Number(params.get("focus") ?? 0);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const createOrder = trpc.workbench.createOrder.useMutation({
    onSuccess: async (result) => { toast.success(result.duplicated ? "相同平台业务键已存在，未重复创建/占用" : "订单已导入并按付款状态尝试分配"); await workspace.refresh(); },
    onError: (error) => toast.error(error.message),
  });
  const assign = trpc.workbench.assignOrder.useMutation({
    onSuccess: async () => { toast.success("负责人与内部期限已更新"); await workspace.refresh(); },
    onError: (error) => toast.error(error.message),
  });
  const cancel = trpc.workbench.cancelOrder.useMutation({
    onSuccess: async () => { toast.success("未发货占用已释放，不伪造入库"); await workspace.refresh(); },
    onError: (error) => toast.error(error.message),
  });
  const addNote = trpc.workbench.addNote.useMutation({
    onSuccess: async () => { toast.success("内部备注已保存，默认不会发送给买家"); await workspace.refresh(); },
    onError: (error) => toast.error(error.message),
  });

  const rows = useMemo(() => {
    const source = workspace.data?.orders ?? [];
    return source.filter((order) => {
      const text = `${order.orderNo} ${order.externalOrderId} ${order.buyerName ?? ""} ${order.lines.map((line) => line.title).join(" ")}`.toLowerCase();
      return (!query || text.includes(query.toLowerCase())) && (status === "all" || order.internalStatus === status || order.paymentStatus === status);
    });
  }, [workspace.data?.orders, query, status]);

  if (workspace.isLoading) return <LoadingPanel />;
  if (workspace.error) return <EmptyPanel title="订单加载失败" description={workspace.error.message} action={<Button onClick={() => workspace.refetch()}>重试</Button>} />;
  const data = workspace.data!;
  const focused = rows.find((order) => order.id === focusId) ?? rows.at(0);

  const submitOrder = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const listing = data.listings.find((item) => item.id === Number(form.get("listingId")));
    const subtotal = Number(form.get("subtotal"));
    const shipping = Number(form.get("shippingPaid") ?? 0);
    const tax = Number(form.get("taxCollected") ?? 0);
    createOrder.mutate({
      platform: String(form.get("platform")) as "etsy" | "ebay",
      externalShopId: String(form.get("externalShopId") ?? ""),
      externalOrderId: String(form.get("externalOrderId") ?? ""),
      orderNo: String(form.get("orderNo") ?? ""),
      buyerName: String(form.get("buyerName") ?? "") || undefined,
      destinationCountry: String(form.get("destinationCountry") ?? "AU"),
      postalCode: String(form.get("postalCode") ?? "") || undefined,
      addressSummary: String(form.get("addressSummary") ?? "") || undefined,
      rawStatus: String(form.get("rawStatus") ?? "paid"),
      paymentStatus: String(form.get("paymentStatus")) as "unpaid" | "paid" | "partial_refund" | "refunded" | "unknown",
      orderedAt: new Date(String(form.get("orderedAt"))),
      shipBy: String(form.get("shipBy")) ? new Date(String(form.get("shipBy"))) : undefined,
      currency: "AUD",
      subtotal,
      shippingPaid: shipping,
      taxCollected: tax,
      discount: 0,
      total: subtotal + shipping + tax,
      note: String(form.get("note") ?? ""),
      lines: [{
        listingId: listing?.id,
        skuId: listing?.skuId ?? undefined,
        externalSku: listing?.platformSku ?? undefined,
        title: listing?.title ?? String(form.get("manualTitle") ?? "未映射平台商品"),
        quantity: Number(form.get("quantity")),
        unitPrice: subtotal / Math.max(1, Number(form.get("quantity"))),
        discount: 0,
      }],
    });
    event.currentTarget.reset();
  };

  return (
    <div>
      <PageHeader
        eyebrow="ORDER CENTER / ORTHOGONAL STATUS"
        title="订单中心"
        description="平台原始事实、内部处理、付款、履约、售后和同步状态正交保存。外部订单 ID 与平台/店铺共同构成唯一业务键，重复 API 拉取和 CSV 导入不会重复占用。"
      />

      <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
        <section className="ops-panel h-fit">
          <div className="ops-panel-header"><div><h2 className="ops-title">应急导入 / 手工录入</h2><p className="ops-subtitle">API 未就绪时透明过渡，不伪装成官方同步</p></div><FilePlus2 className="h-4 w-4 text-primary" /></div>
          <form onSubmit={submitOrder} className="grid gap-3 p-4">
            <div className="grid grid-cols-2 gap-3"><label className="grid gap-1"><span className="ops-label">平台</span><select name="platform" className="ops-input"><option value="etsy">Etsy</option><option value="ebay">eBay</option></select></label><label className="grid gap-1"><span className="ops-label">外部店铺 ID</span><Input required name="externalShopId" className="ops-input" defaultValue="ETSY-AU-001" /></label></div>
            <div className="grid grid-cols-2 gap-3"><label className="grid gap-1"><span className="ops-label">外部订单 ID</span><Input required name="externalOrderId" className="ops-input font-mono" /></label><label className="grid gap-1"><span className="ops-label">订单号</span><Input required name="orderNo" className="ops-input font-mono" /></label></div>
            <label className="grid gap-1"><span className="ops-label">刊登/变体</span><select name="listingId" className="ops-input"><option value="">无法识别（进入待匹配）</option>{data.listings.map((listing) => <option key={listing.id} value={listing.id}>{listing.platform.toUpperCase()} · {listing.title} · {listing.sku?.code ?? "未映射"}</option>)}</select></label>
            <label className="grid gap-1"><span className="ops-label">未映射商品标题</span><Input name="manualTitle" className="ops-input" /></label>
            <div className="grid grid-cols-2 gap-3"><label className="grid gap-1"><span className="ops-label">数量</span><Input required name="quantity" type="number" min="1" defaultValue="1" className="ops-input" /></label><label className="grid gap-1"><span className="ops-label">付款状态</span><select name="paymentStatus" className="ops-input"><option value="paid">已付款</option><option value="unpaid">未付款</option><option value="unknown">待确认</option></select></label></div>
            <div className="grid grid-cols-3 gap-3"><label className="grid gap-1"><span className="ops-label">商品金额</span><Input required name="subtotal" type="number" step="0.01" min="0" className="ops-input" /></label><label className="grid gap-1"><span className="ops-label">买家运费</span><Input name="shippingPaid" type="number" step="0.01" min="0" defaultValue="0" className="ops-input" /></label><label className="grid gap-1"><span className="ops-label">代收税</span><Input name="taxCollected" type="number" step="0.01" min="0" defaultValue="0" className="ops-input" /></label></div>
            <div className="grid grid-cols-2 gap-3"><label className="grid gap-1"><span className="ops-label">下单时间</span><Input required name="orderedAt" type="datetime-local" className="ops-input" /></label><label className="grid gap-1"><span className="ops-label">发货期限</span><Input name="shipBy" type="datetime-local" className="ops-input" /></label></div>
            <div className="grid grid-cols-2 gap-3"><label className="grid gap-1"><span className="ops-label">国家</span><Input required name="destinationCountry" defaultValue="AU" className="ops-input" /></label><label className="grid gap-1"><span className="ops-label">邮编</span><Input name="postalCode" className="ops-input" /></label></div>
            <label className="grid gap-1"><span className="ops-label">买家姓名</span><Input name="buyerName" className="ops-input" /></label>
            <label className="grid gap-1"><span className="ops-label">地址摘要（脱敏）</span><Input name="addressSummary" className="ops-input" /></label>
            <input type="hidden" name="rawStatus" value="manual_import_paid" />
            <label className="grid gap-1"><span className="ops-label">买家备注</span><Textarea name="note" className="min-h-16 bg-secondary/70" /></label>
            <Button className="min-h-11" disabled={createOrder.isPending}>导入订单</Button>
          </form>
        </section>

        <section className="ops-panel min-w-0">
          <div className="ops-panel-header flex-col items-stretch gap-3 lg:flex-row lg:items-center lg:justify-between"><div><h2 className="ops-title">订单列表</h2><p className="ops-subtitle">默认排除无权限操作；筛选保留在本次会话状态中</p></div><div className="flex flex-col gap-2 sm:flex-row"><div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} className="ops-input pl-9" placeholder="搜索订单/商品/买家" /></div><Select value={status} onValueChange={setStatus}><SelectTrigger className="min-h-11 sm:w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部状态</SelectItem>{["pending","matching","shortage","picking","awaiting_dispatch","fulfilled","out_of_scope","unpaid","paid"].map((item) => <SelectItem key={item} value={item}>{label(item)}</SelectItem>)}</SelectContent></Select></div></div>
          {rows.length === 0 ? <EmptyPanel title="没有匹配订单" description="可通过官方授权读取或使用应急手工导入。" /> : (
            <div className="table-scroll"><table className="ops-table"><thead><tr><th>订单</th><th>状态</th><th>行项目与分配</th><th>包裹</th><th>负责人/期限</th><th className="text-right">金额</th><th>操作</th></tr></thead><tbody>
              {rows.map((order) => <tr key={order.id} id={`order-${order.id}`} className={focused?.id === order.id ? "bg-accent/25" : ""}>
                <td><p className="font-mono font-semibold text-primary">{order.orderNo}</p><p className="mt-1 text-xs text-muted-foreground">{order.platform.toUpperCase()} · {order.externalShopId}</p><p className="mt-1 text-xs text-muted-foreground">外部键：{order.externalOrderId}</p><p className="mt-1 text-xs text-muted-foreground">{order.destinationCountry} · {order.postalCode ?? "无邮编"}</p></td>
                <td><div className="flex flex-col items-start gap-2"><StatusPill value={order.paymentStatus} /><StatusPill value={order.internalStatus} /><StatusPill value={order.fulfillmentStatus} /><StatusPill value={order.afterSalesStatus} /></div><p className="mt-2 text-xs text-muted-foreground">原始：{order.rawStatus}</p></td>
                <td><div className="max-w-80 space-y-2">{order.lines.map((line) => <div key={line.id} className="rounded-lg bg-secondary/35 p-2"><p className="text-sm text-foreground">{line.title}</p><p className="mt-1 text-xs text-muted-foreground">SKU：<span className="font-mono text-primary">{line.sku?.code ?? "未匹配"}</span> · 数量 {line.quantity} · 分配 {line.allocatedQty} · 已发 {line.shippedQty} · 缺口 <span className={line.shortageQty > 0 ? "text-red-300" : ""}>{line.shortageQty}</span></p></div>)}</div></td>
                <td>{order.shipments.length === 0 ? <span className="text-muted-foreground">无包裹</span> : order.shipments.map((shipment) => <div key={shipment.id} className="mb-2"><p className="font-mono text-xs text-foreground">{shipment.packageNo}</p><StatusPill value={shipment.status} className="mt-1" /></div>)}</td>
                <td><p>{order.owner?.name ?? "待分配"}</p><p className="mt-1 text-xs text-muted-foreground">平台：{dateTime(order.shipBy)}</p><p className="text-xs text-muted-foreground">内部：{dateTime(order.internalShipBy)}</p></td>
                <td className="text-right"><p className="font-mono">{money(order.total, order.currency)}</p><p className="mt-1 text-xs text-muted-foreground">净收入基础：{money(Number(order.subtotal) + Number(order.shippingPaid) - Number(order.discount), order.currency)}</p></td>
                <td><div className="flex min-w-40 flex-col gap-2"><Button size="sm" variant="outline" className="min-h-10" onClick={() => {
                  const owner = window.prompt(`输入负责人 ID：${data.members.map((member) => `${member.id}=${member.name ?? member.email}`).join("，")}`, String(order.ownerId ?? data.currentUser.id));
                  if (owner) assign.mutate({ orderId: order.id, ownerId: Number(owner), note: "负责人调整" });
                }}><UserRoundCheck className="mr-1 h-4 w-4" />分配</Button><Button size="sm" variant="secondary" className="min-h-10" onClick={() => {
                  const body = window.prompt("输入内部备注（不会发送给买家；不要粘贴完整地址/密钥）");
                  if (body) addNote.mutate({ businessType: "order", businessId: order.id, body });
                }}>内部备注</Button><Button size="sm" variant="ghost" className="min-h-10 text-red-300" disabled={order.fulfillmentStatus !== "unshipped"} onClick={() => {
                  const reason = window.prompt("取消原因；仅释放未发出占用");
                  if (reason) cancel.mutate({ orderId: order.id, reason });
                }}>取消/释放</Button></div></td>
              </tr>)}
            </tbody></table></div>
          )}
        </section>
      </div>
    </div>
  );
}
