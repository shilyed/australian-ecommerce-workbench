import { type FormEvent, useMemo } from "react";
import { BarChart3, CheckCheck, Coins, FileSpreadsheet } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/workbench/PageHeader";
import { EmptyPanel, LoadingPanel } from "@/components/workbench/States";
import { StatusPill } from "@/components/workbench/StatusPill";
import { dateOnly, dateTime, money, percent } from "@/lib/format";
import { useWorkspace } from "@/hooks/useWorkspace";
import { trpc } from "@/providers/trpc";

export default function Finance() {
  const workspace = useWorkspace();
  const addRate = trpc.workbench.addExchangeRate.useMutation({
    onSuccess: async () => { toast.success("汇率快照已保存；历史成本不会静默重算"); await workspace.refresh(); },
    onError: (error) => toast.error(error.message),
  });
  const addCost = trpc.workbench.addCostEntry.useMutation({
    onSuccess: async (result) => { toast.success(result.incomplete ? "费用已保存，但缺汇率，利润标记待补充" : "费用已保存并换算为 AUD"); await workspace.refresh(); },
    onError: (error) => toast.error(error.message),
  });
  const verify = trpc.workbench.verifyOrderProfit.useMutation({
    onSuccess: async () => { toast.success("利润核实状态已更新并写入审计"); await workspace.refresh(); },
    onError: (error) => toast.error(error.message),
  });
  const reconcile = trpc.workbench.reconcileSettlement.useMutation({
    onSuccess: async (result) => { toast.success(result.status === "reconciled" ? "到账已核对" : "存在差异，已放入待核对口径"); await workspace.refresh(); },
    onError: (error) => toast.error(error.message),
  });

  const data = workspace.data;
  const totals = useMemo(() => {
    const report = data?.report ?? [];
    return {
      net: report.reduce((sum, row) => sum + row.netSales, 0),
      contribution: report.reduce((sum, row) => sum + row.contribution, 0),
      verified: report.filter((row) => row.profitStatus === "verified").length,
      total: report.length,
    };
  }, [data?.report]);

  if (workspace.isLoading) return <LoadingPanel />;
  if (workspace.error) return <EmptyPanel title="财务数据加载失败" description={workspace.error.message} action={<Button onClick={() => workspace.refetch()}>重试</Button>} />;
  if (!data) return null;
  if (!data.permissions.finance) {
    return <EmptyPanel title="当前角色无财务权限" description="履约角色默认不能查看采购成本、利润和结算。服务端已按权限拦截，前端隐藏不是唯一措施。" />;
  }

  const submitRate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    addRate.mutate({ baseCurrency: "CNY", rate: String(form.get("rate") ?? ""), rateDate: new Date(String(form.get("rateDate"))), source: String(form.get("source") ?? ""), isDefault: true });
    event.currentTarget.reset();
  };
  const submitCost = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const currency = String(form.get("currency")) as "AUD" | "CNY" | "USD";
    addCost.mutate({
      businessType: "order",
      businessId: Number(form.get("orderId")),
      category: String(form.get("category") ?? ""),
      amount: String(form.get("amount") ?? ""),
      currency,
      exchangeRateId: currency === "AUD" ? undefined : Number(form.get("exchangeRateId")) || undefined,
      entryKind: String(form.get("entryKind")) as "estimate" | "actual" | "reversal",
      replacesId: Number(form.get("replacesId")) || undefined,
      note: String(form.get("note") ?? ""),
    });
    event.currentTarget.reset();
  };

  const chartData = data.report.map((row) => ({ name: row.orderNo, net: row.netSales, contribution: row.contribution }));

  return (
    <div>
      <PageHeader
        eyebrow="CONTRIBUTION / NOT NET PROFIT"
        title="成本、汇率、利润及到账"
        description="展示订单贡献利润而非企业净利润。金额保存原币、方向明确的汇率快照和 AUD 报表金额；缺汇率或费用时明示不完整，不用 1:1 或零成本补齐。"
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="ops-panel p-4"><p className="ops-label">净销售收入</p><p className="metric-value mt-3">{money(totals.net)}</p><p className="mt-2 text-xs text-muted-foreground">不含平台代收代缴税</p></div>
        <div className="ops-panel p-4"><p className="ops-label">贡献利润合计</p><p className="metric-value mt-3 text-emerald-300">{money(totals.contribution)}</p><p className="mt-2 text-xs text-muted-foreground">不冒充纳税利润</p></div>
        <div className="ops-panel p-4"><p className="ops-label">金额覆盖率</p><p className="metric-value mt-3">{percent(totals.total ? totals.verified / totals.total : 0)}</p><p className="mt-2 text-xs text-muted-foreground">已核实订单 {totals.verified}/{totals.total}</p></div>
        <div className="ops-panel p-4"><p className="ops-label">CNY 当前快照</p><p className="metric-value mt-3">{data.exchangeRates.at(0) ? Number(data.exchangeRates.at(0)!.rate).toFixed(6) : "待补"}</p><p className="mt-2 text-xs text-muted-foreground">统一方向：1 CNY = 多少 AUD</p></div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
        <section className="ops-panel min-w-0">
          <div className="ops-panel-header"><div><h2 className="ops-title">销售与贡献利润</h2><p className="ops-subtitle">按原订单期间归属最新修订；调整日期另存，不锁定会计期间</p></div><BarChart3 className="h-4 w-4 text-primary" /></div>
          <div className="h-72 p-4"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}><defs><linearGradient id="net" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#22d3ee" stopOpacity={0.45} /><stop offset="100%" stopColor="#22d3ee" stopOpacity={0.02} /></linearGradient><linearGradient id="profit" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#34d399" stopOpacity={0.45} /><stop offset="100%" stopColor="#34d399" stopOpacity={0.02} /></linearGradient></defs><CartesianGrid stroke="#1a2540" vertical={false} /><XAxis dataKey="name" stroke="#7d8ea3" tickLine={false} axisLine={false} /><YAxis stroke="#7d8ea3" tickLine={false} axisLine={false} /><Tooltip contentStyle={{ background: "#0c1220", border: "1px solid #1a2540", borderRadius: 12, color: "#edf4f8" }} formatter={(value) => money(Number(value))} /><Area type="monotone" dataKey="net" name="净销售收入" stroke="#22d3ee" fill="url(#net)" strokeWidth={2} /><Area type="monotone" dataKey="contribution" name="贡献利润" stroke="#34d399" fill="url(#profit)" strokeWidth={2} /></AreaChart></ResponsiveContainer></div>
          <div className="table-scroll border-t"><table className="ops-table"><thead><tr><th>订单</th><th>净销售收入</th><th>已售成本</th><th>订单费用</th><th>贡献利润</th><th>利润率</th><th>完整度</th><th>操作</th></tr></thead><tbody>{data.report.map((row) => <tr key={row.orderId}><td><p className="font-mono text-primary">{row.orderNo}</p><p className="mt-1 text-xs text-muted-foreground">{row.platform.toUpperCase()} · {dateOnly(row.orderedAt)}</p></td><td className="font-mono">{money(row.netSales)}</td><td className="font-mono">{money(row.goodsCost)}</td><td className="font-mono">{money(row.expense)}</td><td className={`font-mono text-lg ${row.contribution < 0 ? "text-red-300" : "text-emerald-300"}`}>{money(row.contribution)}</td><td>{percent(row.margin)}</td><td><StatusPill value={row.profitStatus} />{row.revisionReason && <p className="mt-2 max-w-52 text-xs text-muted-foreground">{row.revisionReason}</p>}</td><td><Button size="sm" variant="outline" className="min-h-10" onClick={() => {
            const reason = window.prompt("核实/撤销核实原因", "收入、成本、费用已核对");
            if (reason) verify.mutate({ orderId: row.orderId, verified: row.profitStatus !== "verified", reason });
          }}>{row.profitStatus === "verified" ? "撤销核实" : "标记已核实"}</Button></td></tr>)}</tbody></table></div>
        </section>

        <div className="space-y-4">
          <section className="ops-panel"><div className="ops-panel-header"><h2 className="ops-title">新增汇率快照</h2><Coins className="h-4 w-4 text-emerald-300" /></div><form onSubmit={submitRate} className="grid gap-3 p-4"><label className="grid gap-1"><span className="ops-label">1 CNY = AUD</span><Input required name="rate" type="number" step="0.000001" min="0.000001" className="ops-input font-mono" placeholder="0.200000" /></label><label className="grid gap-1"><span className="ops-label">汇率日期</span><Input required name="rateDate" type="datetime-local" className="ops-input" /></label><label className="grid gap-1"><span className="ops-label">来源</span><Input required name="source" className="ops-input" placeholder="例如：银行结汇单/评审快照" /></label><Button className="min-h-11">保存快照</Button><p className="text-xs leading-5 text-muted-foreground">示例：1 CNY = 0.20 AUD。修改默认汇率不会重算历史批次。</p></form></section>

          <section className="ops-panel"><div className="ops-panel-header"><h2 className="ops-title">订单费用 / 估算替换</h2><FileSpreadsheet className="h-4 w-4 text-amber-300" /></div><form onSubmit={submitCost} className="grid gap-3 p-4"><label className="grid gap-1"><span className="ops-label">订单</span><select required name="orderId" className="ops-input">{data.orders.map((order) => <option key={order.id} value={order.id}>{order.orderNo}</option>)}</select></label><div className="grid grid-cols-2 gap-3"><label className="grid gap-1"><span className="ops-label">分类</span><select name="category" className="ops-input"><option value="platform_fee">平台及支付费用</option><option value="fulfillment_freight">实际发货运费</option><option value="packaging">包装</option><option value="advertising">可归因广告</option><option value="after_sales_cost">售后成本</option></select></label><label className="grid gap-1"><span className="ops-label">金额</span><Input required name="amount" type="number" step="0.01" min="0" className="ops-input" /></label></div><div className="grid grid-cols-2 gap-3"><label className="grid gap-1"><span className="ops-label">币种</span><select name="currency" className="ops-input"><option value="AUD">AUD</option><option value="CNY">CNY</option><option value="USD">USD</option></select></label><label className="grid gap-1"><span className="ops-label">汇率快照</span><select name="exchangeRateId" className="ops-input"><option value="">缺汇率/待补</option>{data.exchangeRates.map((rate) => <option key={rate.id} value={rate.id}>{rate.baseCurrency} {Number(rate.rate).toFixed(6)} · {dateOnly(rate.rateDate)}</option>)}</select></label></div><div className="grid grid-cols-2 gap-3"><label className="grid gap-1"><span className="ops-label">性质</span><select name="entryKind" className="ops-input"><option value="actual">实际</option><option value="estimate">估算</option><option value="reversal">冲正</option></select></label><label className="grid gap-1"><span className="ops-label">替换费用 ID</span><Input name="replacesId" type="number" min="1" className="ops-input" /></label></div><label className="grid gap-1"><span className="ops-label">说明</span><Textarea name="note" className="min-h-16 bg-secondary/70" /></label><Button className="min-h-11" variant="secondary">保存费用</Button><p className="text-xs leading-5 text-muted-foreground">实际值替换估算值时保留替换历史；同一源费用不得重复入账。</p></form></section>
        </div>
      </div>

      <section className="ops-panel mt-4"><div className="ops-panel-header"><div><h2 className="ops-title">平台到账核对</h2><p className="ops-subtitle">平台净放款、银行实际到账和订单利润是三种不同口径；不能按到账日重复计销售收入</p></div><CheckCheck className="h-4 w-4 text-primary" /></div>{data.settlements.length === 0 ? <EmptyPanel title="暂无结算批次" description="P0-A 可通过平台账单导入或手工核对；自动读取结算为 P1。" /> : <div className="table-scroll"><table className="ops-table"><thead><tr><th>批次</th><th>期间</th><th>平台净放款</th><th>实际到账</th><th>状态</th><th>操作</th></tr></thead><tbody>{data.settlements.map((settlement) => <tr key={settlement.id}><td><p className="font-mono text-primary">{settlement.referenceNo}</p><p className="mt-1 text-xs text-muted-foreground">{settlement.platform.toUpperCase()} · {settlement.externalShopId}</p></td><td>{dateOnly(settlement.periodStart)} — {dateOnly(settlement.periodEnd)}</td><td className="font-mono">{money(settlement.netPlatformPayout, settlement.currency)}</td><td className="font-mono">{settlement.actualReceived ? money(settlement.actualReceived, settlement.currency) : "未录入"}</td><td><StatusPill value={settlement.status} />{settlement.note && <p className="mt-2 max-w-64 text-xs text-muted-foreground">{settlement.note}</p>}</td><td><Button size="sm" variant="outline" className="min-h-10" onClick={() => {
          const amount = window.prompt("银行实际到账金额", String(settlement.netPlatformPayout));
          const note = window.prompt("核对说明", "银行到账与平台净放款一致");
          if (amount && note) reconcile.mutate({ id: settlement.id, actualReceived: amount, note });
        }}>录入到账</Button></td></tr>)}</tbody></table></div>}</section>

      <section className="ops-panel mt-4"><div className="ops-panel-header"><h2 className="ops-title">费用明细与汇率依据</h2></div><div className="grid gap-4 p-4 lg:grid-cols-2"><div className="rounded-xl border bg-secondary/25 p-3"><p className="ops-label mb-3">最近费用</p>{data.costs.slice(0, 8).map((cost) => <p key={cost.id} className="border-b border-border/60 py-2 text-xs leading-5 text-muted-foreground">#{cost.id} {cost.category} · {money(cost.amount, cost.currency)} → {cost.audAmount ? money(cost.audAmount) : "待补汇率/利润不完整"} · {dateTime(cost.createdAt)}</p>)}</div><div className="rounded-xl border bg-secondary/25 p-3"><p className="ops-label mb-3">历史汇率快照</p>{data.exchangeRates.map((rate) => <p key={rate.id} className="border-b border-border/60 py-2 text-xs leading-5 text-muted-foreground">1 {rate.baseCurrency} = <span className="font-mono text-foreground">{Number(rate.rate).toFixed(6)} AUD</span> · {dateOnly(rate.rateDate)} · {rate.source}</p>)}</div></div></section>
    </div>
  );
}
