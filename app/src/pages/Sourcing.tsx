import { type FormEvent, useMemo, useState } from "react";
import { Plus, Search, ShieldCheck } from "lucide-react";
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

export default function Sourcing() {
  const workspace = useWorkspace();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const createSupplier = trpc.workbench.createSupplier.useMutation({
    onSuccess: async () => { toast.success("供应商已保存"); await workspace.refresh(); },
    onError: (error) => toast.error(error.message),
  });
  const createCandidate = trpc.workbench.createCandidate.useMutation({
    onSuccess: async (result) => {
      toast.success(result.duplicateWarning ? "已创建，但检测到相同来源链接" : "选品候选已创建");
      await workspace.refresh();
    },
    onError: (error) => toast.error(error.message),
  });
  const updateStatus = trpc.workbench.updateCandidateStatus.useMutation({
    onSuccess: async () => { toast.success("选品状态已更新"); await workspace.refresh(); },
    onError: (error) => toast.error(error.message),
  });
  const setCompliance = trpc.workbench.setCandidateCompliance.useMutation({
    onSuccess: async () => { toast.success("渠道适售结论已保存"); await workspace.refresh(); },
    onError: (error) => toast.error(error.message),
  });
  const convert = trpc.workbench.convertCandidate.useMutation({
    onSuccess: async () => { toast.success("已转为正式 SKU，历史候选资料保留"); await workspace.refresh(); },
    onError: (error) => toast.error(error.message),
  });

  const candidates = useMemo(() => {
    const rows = workspace.data?.candidates ?? [];
    return rows.filter((candidate) => {
      const text = `${candidate.name} ${candidate.sourceUrl} ${candidate.supplier?.name ?? ""}`.toLowerCase();
      return (!query || text.includes(query.toLowerCase())) && (status === "all" || candidate.status === status);
    });
  }, [workspace.data?.candidates, query, status]);

  if (workspace.isLoading) return <LoadingPanel />;
  if (workspace.error) return <EmptyPanel title="选品数据加载失败" description={workspace.error.message} action={<Button onClick={() => workspace.refetch()}>重试</Button>} />;
  const data = workspace.data!;

  const submitSupplier = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    createSupplier.mutate({
      name: String(form.get("name") ?? ""),
      shopUrl: String(form.get("shopUrl") ?? ""),
      contactName: String(form.get("contactName") ?? ""),
      contactInfo: String(form.get("contactInfo") ?? ""),
      notes: String(form.get("notes") ?? ""),
    });
    event.currentTarget.reset();
  };

  const submitCandidate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    createCandidate.mutate({
      name: String(form.get("name") ?? ""),
      sourceUrl: String(form.get("sourceUrl") ?? ""),
      supplierId: Number(form.get("supplierId")),
      spec: String(form.get("spec") ?? ""),
      quote: String(form.get("quote") ?? ""),
      moq: Number(form.get("moq") ?? 0) || undefined,
      leadTimeDays: Number(form.get("leadTimeDays") ?? 0) || undefined,
      referencePrice: String(form.get("referencePrice") ?? "") || undefined,
      notes: String(form.get("notes") ?? ""),
    });
    event.currentTarget.reset();
  };

  return (
    <div>
      <PageHeader
        eyebrow="SOURCING / 1688 → ETSY + EBAY"
        title="选品与供应商"
        description="候选、样品、渠道适售和采购转化分开记录。样品评分不是合规证明；采购通过不代表 Etsy/eBay 渠道通过。"
      />

      <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
        <div className="space-y-4">
          <section className="ops-panel">
            <div className="ops-panel-header"><h2 className="ops-title">新增供应商</h2><Plus className="h-4 w-4 text-primary" /></div>
            <form onSubmit={submitSupplier} className="grid gap-3 p-4">
              <label className="grid gap-1"><span className="ops-label">供应商名称</span><Input required name="name" className="ops-input" /></label>
              <label className="grid gap-1"><span className="ops-label">1688 店铺链接</span><Input name="shopUrl" type="url" className="ops-input" placeholder="https://" /></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1"><span className="ops-label">联系人</span><Input name="contactName" className="ops-input" /></label>
                <label className="grid gap-1"><span className="ops-label">联系方式</span><Input name="contactInfo" className="ops-input" /></label>
              </div>
              <label className="grid gap-1"><span className="ops-label">履约/异常记录</span><Textarea name="notes" className="min-h-24 bg-secondary/70" /></label>
              <Button className="min-h-11" disabled={createSupplier.isPending}>保存供应商</Button>
            </form>
          </section>

          <section className="ops-panel">
            <div className="ops-panel-header"><h2 className="ops-title">新增选品候选</h2><ShieldCheck className="h-4 w-4 text-amber-300" /></div>
            <form onSubmit={submitCandidate} className="grid gap-3 p-4">
              <label className="grid gap-1"><span className="ops-label">内部名称 *</span><Input required name="name" className="ops-input" /></label>
              <label className="grid gap-1"><span className="ops-label">1688 商品链接 *</span><Input required name="sourceUrl" type="url" className="ops-input" /></label>
              <label className="grid gap-1"><span className="ops-label">供应商 *</span>
                <select required name="supplierId" className="ops-input" defaultValue="">
                  <option value="" disabled>选择供应商</option>
                  {data.suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                </select>
              </label>
              <label className="grid gap-1"><span className="ops-label">候选规格 *</span><Input required name="spec" className="ops-input" /></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1"><span className="ops-label">人民币报价 *</span><Input required name="quote" type="number" step="0.01" min="0" className="ops-input" /></label>
                <label className="grid gap-1"><span className="ops-label">参考售价 AUD</span><Input name="referencePrice" type="number" step="0.01" min="0" className="ops-input" /></label>
                <label className="grid gap-1"><span className="ops-label">MOQ</span><Input name="moq" type="number" min="1" className="ops-input" /></label>
                <label className="grid gap-1"><span className="ops-label">预计交期/天</span><Input name="leadTimeDays" type="number" min="1" className="ops-input" /></label>
              </div>
              <label className="grid gap-1"><span className="ops-label">备注</span><Textarea name="notes" className="min-h-20 bg-secondary/70" /></label>
              <Button className="min-h-11" disabled={createCandidate.isPending}>创建候选</Button>
            </form>
          </section>
        </div>

        <section className="ops-panel min-w-0">
          <div className="ops-panel-header flex-col items-stretch gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div><h2 className="ops-title">候选列表</h2><p className="ops-subtitle">同链接允许不同规格/方案独立存在，但创建时已提示重复</p></div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} className="ops-input pl-9" placeholder="搜索名称/链接/供应商" /></div>
              <Select value={status} onValueChange={setStatus}><SelectTrigger className="min-h-11 sm:w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部状态</SelectItem>{["candidate","sample_evaluation","pending_decision","adopted","rejected","paused"].map((item) => <SelectItem key={item} value={item}>{label(item)}</SelectItem>)}</SelectContent></Select>
            </div>
          </div>
          {candidates.length === 0 ? <EmptyPanel title="没有匹配候选" description="调整筛选或新增 1688 候选。" /> : (
            <div className="table-scroll">
              <table className="ops-table">
                <thead><tr><th>候选</th><th>状态</th><th>Etsy</th><th>eBay</th><th>报价</th><th>操作</th></tr></thead>
                <tbody>
                  {candidates.map((candidate) => (
                    <tr key={candidate.id}>
                      <td>
                        <p className="font-medium text-foreground">{candidate.name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{candidate.spec}</p>
                        <a className="mt-2 inline-flex min-h-8 items-center text-xs text-primary hover:underline" href={candidate.sourceUrl} target="_blank" rel="noreferrer">打开 1688 来源</a>
                        <p className="mt-1 text-xs text-muted-foreground">{candidate.supplier?.name}</p>
                      </td>
                      <td><StatusPill value={candidate.status} />{candidate.sampleScore !== null && <p className="mt-2 text-xs text-muted-foreground">样品评分 {candidate.sampleScore}/100</p>}</td>
                      <td><StatusPill value={candidate.etsyStatus} /></td>
                      <td><StatusPill value={candidate.ebayStatus} /></td>
                      <td><span className="font-mono">{money(candidate.quote, candidate.currency)}</span><p className="mt-1 text-xs text-muted-foreground">MOQ {candidate.moq ?? "—"} · {candidate.leadTimeDays ?? "—"} 天</p></td>
                      <td>
                        <div className="flex min-w-48 flex-col gap-2">
                          <Button size="sm" variant="outline" className="min-h-10" onClick={() => {
                            const note = window.prompt("输入状态流转/决策说明", "样品通过，进入待决策");
                            if (note) updateStatus.mutate({ id: candidate.id, status: candidate.status === "candidate" ? "sample_evaluation" : "pending_decision", sampleScore: candidate.sampleScore ?? undefined, sampleReview: candidate.sampleReview ?? undefined, decisionNote: note });
                          }}>推进状态</Button>
                          <div className="grid grid-cols-2 gap-2">
                            {(["etsy", "ebay"] as const).map((platform) => <Button key={platform} size="sm" variant="secondary" className="min-h-10" onClick={() => {
                              const basis = window.prompt(`${platform === "etsy" ? "Etsy 创意/生产合作披露" : "eBay/澳洲产品安全"} 判断依据`);
                              if (basis) setCompliance.mutate({ id: candidate.id, platform, conclusion: "approved", basis });
                            }}>{platform === "etsy" ? "Etsy 确认" : "eBay 确认"}</Button>)}
                          </div>
                          <Button size="sm" className="min-h-10" disabled={candidate.status === "adopted" || convert.isPending} onClick={() => {
                            const code = window.prompt("输入全局唯一 SKU 编码", `AU-${String(candidate.id).padStart(4, "0")}`);
                            const note = window.prompt("转正式 SKU 的决策说明", "业务负责人确认进入试点");
                            if (code && note) convert.mutate({ candidateId: candidate.id, skuCode: code, decisionNote: note });
                          }}>{candidate.convertedSku ? `已转 ${candidate.convertedSku.code}` : "转正式 SKU"}</Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="border-t p-4 text-xs leading-6 text-muted-foreground">最近合规检查：{dateTime(candidates.find((item) => item.complianceCheckedAt)?.complianceCheckedAt)}。Etsy 普通 1688 现货不可默认按原创或手工商品上架；未确认商品会保持显著预警。</div>
        </section>
      </div>
    </div>
  );
}
