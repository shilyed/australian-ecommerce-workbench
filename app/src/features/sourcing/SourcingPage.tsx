import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/workbench/PageHeader";
import { EmptyPanel, LoadingPanel } from "@/components/workbench/States";
import { StatusPill } from "@/components/workbench/StatusPill";
import { useWorkspace } from "@/hooks/useWorkspace";
import { dateTime, label, money } from "@/lib/format";
import { trpc } from "@/providers/trpc";
import { CandidateForm, OperationForm, SupplierForm } from "./SourcingForms";
import {
  candidateInput,
  candidateStatuses,
  canManageSourcing,
  complianceInput,
  conversionInput,
  filterCandidates,
  sourcingSummary,
  statusInput,
  supplierInput,
  type Candidate,
  type CandidateOperation,
  type Supplier,
} from "./sourcing-model";

function ChannelStatus({ value }: { value: Candidate["etsyStatus"] }) {
  const text = {
    approved: "业务确认",
    pending: "待确认",
    assess: "评估中",
    rejected: "不适售",
  }[value];
  return <StatusPill value={value} text={text} className="sourcing-status" />;
}

function DetailField({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 border-b py-3 last:border-0">
      <dt className="text-muted-foreground">{title}</dt>
      <dd className="min-w-0 whitespace-pre-wrap break-words">
        {children ?? "未填写"}
      </dd>
    </div>
  );
}

function CandidateDetails({
  candidate,
  canEdit,
  onOperate,
}: {
  candidate: Candidate;
  canEdit: boolean;
  onOperate: (operation: CandidateOperation) => void;
}) {
  const converted =
    candidate.convertedSkuId !== null || candidate.status === "adopted";
  return (
    <>
      <div className="min-h-0 flex-1 space-y-7 overflow-y-auto p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <StatusPill value={candidate.status} className="sourcing-status" />
          <a
            href={candidate.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="sourcing-source-link"
          >
            查看 1688 货源 <ArrowUpRight className="h-4 w-4" aria-hidden />
          </a>
        </div>
        <section aria-label="货源信息">
          <h3 className="text-base font-semibold">货源信息</h3>
          <dl className="mt-2 text-sm">
            <DetailField title="候选规格">{candidate.spec}</DetailField>
            <DetailField title="供应商">
              {candidate.supplier?.name ?? "供应商资料不可用"}
            </DetailField>
            <DetailField title="采购报价">
              <span className="font-semibold tabular-nums">
                {money(candidate.quote, candidate.currency)}
              </span>
            </DetailField>
            <DetailField title="参考售价">
              {candidate.referencePrice === null
                ? "未填写"
                : money(candidate.referencePrice, "AUD")}
            </DetailField>
            <DetailField title="最小起订量">
              {candidate.moq ?? "未填写"}
            </DetailField>
            <DetailField title="预计交期">
              {candidate.leadTimeDays === null
                ? "未填写"
                : `${candidate.leadTimeDays} 天`}
            </DetailField>
          </dl>
        </section>
        <section aria-label="样品与决策">
          <h3 className="text-base font-semibold">样品与决策</h3>
          <dl className="mt-2 text-sm">
            <DetailField title="样品评分">
              {candidate.sampleScore === null
                ? "暂无评分"
                : `${candidate.sampleScore} / 100`}
            </DetailField>
            <DetailField title="评估 / 备注">
              {candidate.sampleReview || "暂无记录"}
            </DetailField>
            <DetailField title="决策说明">
              {candidate.decisionNote || "暂无记录"}
            </DetailField>
          </dl>
        </section>
        <section aria-label="渠道适售判断">
          <h3 className="text-base font-semibold">渠道适售判断</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            业务确认不等于平台审核通过；样品评分不是合规证明。
          </p>
          <div className="mt-3 divide-y border-y">
            {(["etsy", "ebay"] as const).map(platform => (
              <div
                key={platform}
                className="flex flex-wrap items-center gap-3 py-4"
              >
                <span className="w-10 text-sm font-semibold">
                  {platform === "etsy" ? "Etsy" : "eBay"}
                </span>
                <ChannelStatus
                  value={
                    platform === "etsy"
                      ? candidate.etsyStatus
                      : candidate.ebayStatus
                  }
                />
                <Button
                  type="button"
                  variant="outline"
                  className="nike-button ml-auto"
                  disabled={!canEdit}
                  onClick={() =>
                    onOperate({ kind: "compliance", candidate, platform })
                  }
                >
                  记录判断
                </Button>
              </div>
            ))}
          </div>
          <dl className="mt-3 text-sm">
            <DetailField title="已记录依据">
              {candidate.complianceBasis || "暂无记录"}
            </DetailField>
            <DetailField title="最近核对">
              {dateTime(candidate.complianceCheckedAt)}
            </DetailField>
          </dl>
        </section>
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t p-4 sm:p-6">
        <Button
          type="button"
          variant="outline"
          className="nike-button"
          disabled={!canEdit}
          onClick={() => onOperate({ kind: "status", candidate })}
        >
          推进状态
        </Button>
        {candidate.convertedSkuId !== null ? (
          <Button asChild className="nike-button">
            <Link to={`/products/${candidate.convertedSkuId}`}>
              查看{" "}
              {candidate.convertedSku?.code ??
                `SKU #${candidate.convertedSkuId}`}
              <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
            </Link>
          </Button>
        ) : (
          <Button
            type="button"
            className="nike-button"
            disabled={!canEdit || converted}
            onClick={() => onOperate({ kind: "convert", candidate })}
          >
            {converted ? "已采用" : "转正式 SKU"}
          </Button>
        )}
      </div>
    </>
  );
}

export default function SourcingPage() {
  const workspace = useWorkspace();
  const [params, setParams] = useSearchParams();
  const [operation, setOperation] = useState<CandidateOperation | null>(null);
  const [dirty, setDirty] = useState(false);
  const [discardTarget, setDiscardTarget] = useState<
    "panel" | "operation" | null
  >(null);
  const panelOpener = useRef<HTMLElement | null>(null);
  const operationOpener = useRef<HTMLElement | null>(null);
  const titleRef = useRef<HTMLDivElement | null>(null);
  const view = params.get("view") === "suppliers" ? "suppliers" : "candidates";
  const query = params.get("q") ?? "";
  const requestedStatus = params.get("status") ?? "all";
  const status =
    candidateStatuses.find(item => item === requestedStatus) ?? "all";
  const supplierId = Number(params.get("supplier") ?? 0);
  const convertedOnly = params.get("converted") === "1";
  const focusId = Number(params.get("focus") ?? 0);
  const panel = params.get("panel");
  const creatingCandidate = panel === "create-candidate";
  const creatingSupplier = panel === "create-supplier";

  const updateParams = (change: (next: URLSearchParams) => void) =>
    setParams(
      previous => {
        const next = new URLSearchParams(previous);
        change(next);
        return next;
      },
      { replace: true }
    );
  const updateFilter = (key: string, value: string) =>
    updateParams(next => {
      if (value) next.set(key, value);
      else next.delete(key);
    });
  const closePanel = () =>
    updateParams(next => {
      next.delete("panel");
      next.delete("focus");
    });
  const finishCreation = async (message: string) => {
    toast.success(message);
    setDirty(false);
    closePanel();
    await workspace.refresh();
  };
  const finishOperation = async (message: string) => {
    toast.success(message);
    setDirty(false);
    setOperation(null);
    await workspace.refresh();
  };
  const createSupplier = trpc.workbench.createSupplier.useMutation({
    onSuccess: () => finishCreation("供应商已保存"),
    onError: error => toast.error(error.message),
  });
  const createCandidate = trpc.workbench.createCandidate.useMutation({
    onSuccess: result =>
      finishCreation(
        result.duplicateWarning
          ? "已创建，但检测到相同来源链接"
          : "选品候选已创建"
      ),
    onError: error => toast.error(error.message),
  });
  const updateStatus = trpc.workbench.updateCandidateStatus.useMutation({
    onSuccess: () => finishOperation("选品状态已更新"),
    onError: error => toast.error(error.message),
  });
  const setCompliance = trpc.workbench.setCandidateCompliance.useMutation({
    onSuccess: () => finishOperation("渠道适售结论已保存"),
    onError: error => toast.error(error.message),
  });
  const convert = trpc.workbench.convertCandidate.useMutation({
    onSuccess: () => finishOperation("已转为正式 SKU，历史候选资料保留"),
    onError: error => toast.error(error.message),
  });
  const creationPending = createCandidate.isPending || createSupplier.isPending;
  const operationPending =
    updateStatus.isPending || setCompliance.isPending || convert.isPending;

  useEffect(() => {
    if (!dirty) return;
    const preventLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventLeave);
    return () => window.removeEventListener("beforeunload", preventLeave);
  }, [dirty]);

  const candidates = useMemo(
    () =>
      filterCandidates(workspace.data?.candidates ?? [], {
        query,
        status,
        supplierId,
        convertedOnly,
      }),
    [workspace.data?.candidates, query, status, supplierId, convertedOnly]
  );
  const suppliers = useMemo(() => {
    const search = query.trim().toLowerCase();
    return (workspace.data?.suppliers ?? []).filter(supplier =>
      `${supplier.name} ${supplier.shopUrl ?? ""} ${supplier.contactName ?? ""} ${supplier.contactInfo ?? ""}`
        .toLowerCase()
        .includes(search)
    );
  }, [workspace.data?.suppliers, query]);

  if (workspace.isLoading) return <LoadingPanel />;
  if (!workspace.data)
    return (
      <div className="sourcing-empty">
        <EmptyPanel
          title="选品数据加载失败"
          description={workspace.error?.message ?? "未收到选品数据"}
          action={
            <Button className="nike-button" onClick={() => workspace.refetch()}>
              重试
            </Button>
          }
        />
      </div>
    );

  const data = workspace.data;
  const canEdit = canManageSourcing(data.currentUser);
  const summary = sourcingSummary(data.candidates);
  const focusedCandidate = data.candidates.find(
    candidate => candidate.id === focusId
  );
  const focusedSupplier = data.suppliers.find(
    supplier => supplier.id === focusId
  );
  const panelOpen = creatingCandidate || creatingSupplier || focusId > 0;
  const activeSupplier = data.suppliers.find(
    supplier => supplier.id === supplierId
  );
  const hasFilters = Boolean(
    query || status !== "all" || supplierId || convertedOnly
  );
  const clearFilters = () =>
    updateParams(next => {
      for (const key of ["q", "status", "supplier", "converted"])
        next.delete(key);
    });
  const requestClose = (target: "panel" | "operation") => {
    if (target === "panel" ? creationPending : operationPending) {
      toast.info("正在保存，请稍候再关闭");
      return;
    }
    if (dirty) setDiscardTarget(target);
    else if (target === "panel") closePanel();
    else setOperation(null);
  };
  const openCreation = (kind: "create-candidate" | "create-supplier") => {
    panelOpener.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    createSupplier.reset();
    createCandidate.reset();
    setDirty(false);
    updateParams(next => {
      next.set("panel", kind);
      next.delete("focus");
    });
  };
  const openDetails = (id: number) => {
    panelOpener.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    updateParams(next => {
      next.set("focus", String(id));
      next.delete("panel");
    });
  };
  const openOperation = (next: CandidateOperation) => {
    operationOpener.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    updateStatus.reset();
    setCompliance.reset();
    convert.reset();
    setDirty(false);
    setOperation(next);
  };
  const changeView = (nextView: string) =>
    updateParams(next => {
      if (nextView === "suppliers") next.set("view", "suppliers");
      else next.delete("view");
      for (const key of [
        "q",
        "status",
        "supplier",
        "converted",
        "focus",
        "panel",
      ])
        next.delete(key);
    });
  const showSupplierCandidates = (supplier: Supplier) =>
    updateParams(next => {
      for (const key of ["view", "focus", "panel", "q", "status", "converted"])
        next.delete(key);
      next.set("supplier", String(supplier.id));
    });
  const operationError =
    operation?.kind === "status"
      ? updateStatus.error?.message
      : operation?.kind === "compliance"
        ? setCompliance.error?.message
        : convert.error?.message;
  const submitOperation = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!operation || !canEdit || operationPending) {
      toast.error(
        !canEdit ? "当前角色无权执行该操作" : "当前操作不可提交，请稍候重试"
      );
      return;
    }
    const form = new FormData(event.currentTarget);
    if (operation.kind === "status")
      updateStatus.mutate(statusInput(operation.candidate, form));
    else if (operation.kind === "compliance")
      setCompliance.mutate(
        complianceInput(operation.candidate, operation.platform, form)
      );
    else convert.mutate(conversionInput(operation.candidate, form));
  };

  return (
    <div className="sourcing-page mx-auto max-w-[1600px]">
      <div
        ref={titleRef}
        tabIndex={-1}
        className="sourcing-page-heading outline-none"
      >
        <PageHeader
          eyebrow="工作台 / 商品准备"
          title="选品与供应商"
          description="比较货源，跟进样品与渠道判断。让每一次采用，都有据可查。"
          actions={
            <>
              <Button
                variant="ghost"
                size="icon"
                className="nike-icon-button"
                aria-label="刷新选品数据"
                onClick={() => workspace.refetch()}
                disabled={workspace.isFetching}
              >
                <RefreshCw
                  className={`h-4 w-4 ${workspace.isFetching ? "animate-spin" : ""}`}
                  aria-hidden
                />
              </Button>
              <Button
                variant="outline"
                className="nike-button"
                disabled={
                  !canEdit ||
                  creationPending ||
                  operationPending ||
                  (view === "suppliers" && data.suppliers.length === 0)
                }
                onClick={() =>
                  openCreation(
                    view === "suppliers"
                      ? "create-candidate"
                      : "create-supplier"
                  )
                }
              >
                {view === "suppliers" ? "新增候选" : "新增供应商"}
              </Button>
              <Button
                className="nike-button"
                disabled={
                  !canEdit ||
                  creationPending ||
                  operationPending ||
                  (view === "candidates" && data.suppliers.length === 0)
                }
                onClick={() =>
                  openCreation(
                    view === "suppliers"
                      ? "create-supplier"
                      : "create-candidate"
                  )
                }
              >
                <Plus className="mr-2 h-4 w-4" aria-hidden />
                {view === "suppliers" ? "新增供应商" : "新增候选"}
              </Button>
            </>
          }
        />
      </div>

      {workspace.error && (
        <p role="alert" className="sourcing-error mb-4">
          数据刷新失败：{workspace.error.message}。当前显示上次成功读取的数据。
        </p>
      )}
      {!canEdit && (
        <p className="mb-4 text-sm text-muted-foreground">
          当前角色仅可浏览，新增、渠道判断及转 SKU 操作需由管理员或运营处理。
        </p>
      )}

      <dl className="sourcing-summary" aria-label="选品概览">
        {[
          {
            title: "全部候选",
            value: summary.total,
            detail: "集中管理货源与规格",
            filter: "all",
          },
          {
            title: "样品评估",
            value: summary.evaluating,
            detail: "正在核对样品表现",
            filter: "sample_evaluation",
          },
          {
            title: "待决策",
            value: summary.deciding,
            detail: "等待下一步业务决定",
            filter: "pending_decision",
          },
          {
            title: "已转 SKU",
            value: summary.converted,
            detail: "候选记录继续保留",
            filter: "converted",
          },
        ].map(item => (
          <div key={item.title}>
            <dt>{item.title}</dt>
            <dd>
              <button
                className="sourcing-summary-value hover:underline"
                aria-label={`筛选${item.title}`}
                onClick={() =>
                  updateParams(next => {
                    for (const key of [
                      "view",
                      "q",
                      "status",
                      "supplier",
                      "converted",
                    ])
                      next.delete(key);
                    if (item.filter === "converted") next.set("converted", "1");
                    else if (item.filter !== "all")
                      next.set("status", item.filter);
                  })
                }
              >
                {item.value.toString().padStart(2, "0")}
              </button>
              <span className="block text-xs leading-5 text-muted-foreground">
                {item.detail}
              </span>
            </dd>
          </div>
        ))}
      </dl>

      <Tabs
        value={view}
        onValueChange={changeView}
        className="sourcing-content"
      >
        <TabsList className="sourcing-tabs" aria-label="选品工作区">
          <TabsTrigger value="candidates">
            候选清单 <span>{data.candidates.length}</span>
          </TabsTrigger>
          <TabsTrigger value="suppliers">
            供应商 <span>{data.suppliers.length}</span>
          </TabsTrigger>
        </TabsList>
        <div className="sourcing-toolbar">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              aria-label={view === "candidates" ? "搜索候选" : "搜索供应商"}
              value={query}
              onChange={event => updateFilter("q", event.target.value)}
              className="sourcing-search"
              placeholder={
                view === "candidates"
                  ? "搜索商品、规格、货源链接或供应商"
                  : "搜索供应商名称、店铺或联系人"
              }
            />
          </div>
          {view === "candidates" && (
            <Select
              value={status}
              onValueChange={value =>
                updateFilter("status", value === "all" ? "" : value)
              }
            >
              <SelectTrigger
                className="sourcing-status-filter"
                aria-label="候选状态"
              >
                <SlidersHorizontal
                  className="mr-2 h-4 w-4 shrink-0"
                  aria-hidden
                />
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="nike-workspace">
                <SelectItem value="all">全部状态</SelectItem>
                {candidateStatuses.map(item => (
                  <SelectItem key={item} value={item}>
                    {label(item)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 pb-3 text-xs text-muted-foreground">
          <p role="status" aria-live="polite">
            {view === "candidates"
              ? `显示 ${candidates.length} / ${data.candidates.length} 个候选`
              : `显示 ${suppliers.length} / ${data.suppliers.length} 家供应商`}
            {view === "candidates" && supplierId > 0
              ? ` · ${activeSupplier?.name ?? `供应商 #${supplierId}`}`
              : ""}
            {view === "candidates" && convertedOnly ? " · 已转 SKU" : ""}
          </p>
          {hasFilters ? (
            <Button
              variant="ghost"
              size="sm"
              className="nike-button"
              onClick={clearFilters}
            >
              清除筛选 <X className="ml-1 h-3 w-3" aria-hidden />
            </Button>
          ) : (
            <span>按最近更新排序</span>
          )}
        </div>

        <TabsContent value="candidates" className="mt-0 outline-none">
          <div className="sourcing-notice mb-5">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div>
              <p>
                渠道判断需单独核对。Etsy 普通 1688
                现货不可默认按原创或手工商品上架。
              </p>
              <p className="mt-1 text-muted-foreground">
                样品评分不是合规证明 · 最近核对 {dateTime(summary.lastChecked)}
              </p>
            </div>
          </div>
          {candidates.length === 0 ? (
            <div className="sourcing-empty">
              <EmptyPanel
                title={
                  data.candidates.length === 0
                    ? "从第一个选品候选开始"
                    : "没有找到匹配候选"
                }
                description={
                  data.suppliers.length === 0
                    ? "先登记供应商，再保存货源、规格与采购报价。"
                    : "保留不同规格的货源方案，再逐步跟进样品和渠道判断。"
                }
                action={
                  hasFilters ? (
                    <Button
                      variant="outline"
                      className="nike-button"
                      onClick={clearFilters}
                    >
                      清除筛选
                    </Button>
                  ) : canEdit ? (
                    <Button
                      className="nike-button"
                      onClick={() =>
                        openCreation(
                          data.suppliers.length
                            ? "create-candidate"
                            : "create-supplier"
                        )
                      }
                    >
                      {data.suppliers.length ? "新增候选" : "新增供应商"}
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <>
              <div className="sourcing-list-heading" aria-hidden>
                <span>候选商品 / 货源</span>
                <span>选品状态</span>
                <span>渠道判断</span>
                <span className="text-right">采购报价</span>
                <span />
              </div>
              <ul className="sourcing-list" aria-label="候选清单">
                {candidates.map(candidate => (
                  <li key={candidate.id} className="sourcing-row">
                    <div className="sourcing-product">
                      <span className="sourcing-index" aria-hidden>
                        {String(candidate.id).padStart(2, "0")}
                      </span>
                      <div className="min-w-0">
                        <button
                          className="sourcing-product-title"
                          onClick={() => openDetails(candidate.id)}
                        >
                          {candidate.name}
                        </button>
                        <div className="sourcing-product-meta">
                          <p className="min-w-0 line-clamp-1 text-xs leading-5 text-muted-foreground">
                            {candidate.supplier?.name ?? "供应商资料不可用"}
                          </p>
                          <a
                            href={candidate.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="sourcing-source-link shrink-0"
                          >
                            1688 货源{" "}
                            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                          </a>
                        </div>
                      </div>
                    </div>
                    <div className="sourcing-stage">
                      <span className="sourcing-cell-label">选品状态</span>
                      <StatusPill
                        value={candidate.status}
                        className="sourcing-status"
                      />
                      {candidate.sampleScore !== null && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          样品 {candidate.sampleScore} / 100
                        </p>
                      )}
                      {candidate.convertedSku && (
                        <p className="mt-2 font-mono text-xs">
                          {candidate.convertedSku.code}
                        </p>
                      )}
                    </div>
                    <div className="sourcing-channels">
                      <span className="sourcing-cell-label">渠道判断</span>
                      <div>
                        <span>Etsy</span>
                        <ChannelStatus value={candidate.etsyStatus} />
                      </div>
                      <div>
                        <span>eBay</span>
                        <ChannelStatus value={candidate.ebayStatus} />
                      </div>
                    </div>
                    <div className="sourcing-quote">
                      <span className="sourcing-cell-label">采购报价</span>
                      <p className="font-semibold tabular-nums">
                        {money(candidate.quote, candidate.currency)}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        MOQ {candidate.moq ?? "待核实"}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      className="sourcing-row-action nike-button"
                      aria-label={`查看候选：${candidate.name}`}
                      onClick={() => openDetails(candidate.id)}
                    >
                      详情 <ChevronRight className="ml-1 h-4 w-4" aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="py-5 text-xs leading-5 text-muted-foreground">
            每个候选独立保留规格与决策记录。渠道未确认的商品仍需核对，不会因转为
            SKU 自动上架。
          </p>
        </TabsContent>

        <TabsContent value="suppliers" className="mt-0 outline-none">
          {suppliers.length === 0 ? (
            <div className="sourcing-empty">
              <EmptyPanel
                title={
                  data.suppliers.length
                    ? "没有找到匹配供应商"
                    : "建立你的供应商清单"
                }
                description="集中记录店铺、联系人与履约情况，让货源信息有处可查。"
                action={
                  query ? (
                    <Button
                      className="nike-button"
                      variant="outline"
                      onClick={clearFilters}
                    >
                      清除筛选
                    </Button>
                  ) : canEdit ? (
                    <Button
                      className="nike-button"
                      onClick={() => openCreation("create-supplier")}
                    >
                      新增供应商
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <ul className="sourcing-list" aria-label="供应商清单">
              {suppliers.map(supplier => {
                const count = data.candidates.filter(
                  candidate => candidate.supplierId === supplier.id
                ).length;
                return (
                  <li
                    key={supplier.id}
                    className="sourcing-row sourcing-supplier-row"
                  >
                    <div className="sourcing-product">
                      <span className="sourcing-index" aria-hidden>
                        {String(supplier.id).padStart(2, "0")}
                      </span>
                      <div className="min-w-0">
                        <button
                          className="sourcing-product-title"
                          onClick={() => openDetails(supplier.id)}
                        >
                          {supplier.name}
                        </button>
                        <p className="mt-2 text-xs text-muted-foreground">
                          {supplier.contactName
                            ? `联系人 · ${supplier.contactName}`
                            : "联系人尚未填写"}
                        </p>
                        {supplier.shopUrl && (
                          <a
                            href={supplier.shopUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="sourcing-source-link mt-1"
                          >
                            1688 店铺{" "}
                            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                          </a>
                        )}
                      </div>
                    </div>
                    <div className="text-sm">
                      <span className="mr-2 text-xl font-semibold tabular-nums">
                        {count}
                      </span>
                      <span className="text-muted-foreground">个关联候选</span>
                    </div>
                    <Button
                      variant="ghost"
                      className="sourcing-row-action nike-button"
                      aria-label={`查看供应商：${supplier.name}`}
                      onClick={() => openDetails(supplier.id)}
                    >
                      详情 <ChevronRight className="ml-1 h-4 w-4" aria-hidden />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </TabsContent>
      </Tabs>

      <Sheet
        open={panelOpen}
        onOpenChange={open => {
          if (!open) requestClose("panel");
        }}
      >
        <SheetContent
          className="nike-workspace sourcing-sheet"
          showCloseButton={false}
          onCloseAutoFocus={event => {
            event.preventDefault();
            (panelOpener.current?.isConnected
              ? panelOpener.current
              : titleRef.current
            )?.focus();
          }}
        >
          <SheetHeader className="relative border-b p-6 pr-16">
            <p className="mb-1 text-xs text-muted-foreground">
              {creatingCandidate || creatingSupplier
                ? "新建记录"
                : view === "candidates"
                  ? `选品记录 #${focusId}`
                  : `供应商 #${focusId}`}
            </p>
            <SheetTitle className="text-xl leading-7">
              {creatingCandidate
                ? "新增选品候选"
                : creatingSupplier
                  ? "新增供应商"
                  : view === "candidates"
                    ? (focusedCandidate?.name ?? "候选不可用")
                    : (focusedSupplier?.name ?? "供应商不可用")}
            </SheetTitle>
            <SheetDescription>
              {creatingCandidate || creatingSupplier
                ? "必填项已标记 *，其余信息可后续核对。"
                : "查看完整信息，并继续处理下一步。"}
            </SheetDescription>
            <Button
              variant="ghost"
              size="icon"
              className="nike-icon-button absolute right-4 top-4"
              aria-label="关闭详情抽屉"
              disabled={creationPending}
              onClick={() => requestClose("panel")}
            >
              <X className="h-5 w-5" aria-hidden />
            </Button>
          </SheetHeader>
          {creatingCandidate ? (
            <CandidateForm
              suppliers={data.suppliers}
              disabled={!canEdit}
              pending={createCandidate.isPending}
              error={createCandidate.error?.message}
              onChange={() => setDirty(true)}
              onCancel={() => requestClose("panel")}
              onSubmit={event => {
                event.preventDefault();
                if (!canEdit || creationPending) {
                  toast.error("当前操作不可提交，请检查权限或稍候重试");
                  return;
                }
                createCandidate.mutate(
                  candidateInput(new FormData(event.currentTarget))
                );
              }}
            />
          ) : creatingSupplier ? (
            <SupplierForm
              pending={createSupplier.isPending}
              disabled={!canEdit}
              error={createSupplier.error?.message}
              onChange={() => setDirty(true)}
              onCancel={() => requestClose("panel")}
              onSubmit={event => {
                event.preventDefault();
                if (!canEdit || creationPending) {
                  toast.error("当前操作不可提交，请检查权限或稍候重试");
                  return;
                }
                createSupplier.mutate(
                  supplierInput(new FormData(event.currentTarget))
                );
              }}
            />
          ) : view === "candidates" && focusedCandidate ? (
            <CandidateDetails
              candidate={focusedCandidate}
              canEdit={canEdit}
              onOperate={openOperation}
            />
          ) : view === "suppliers" && focusedSupplier ? (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto p-6">
                <dl className="text-sm">
                  <DetailField title="店铺链接">
                    {focusedSupplier.shopUrl ? (
                      <a
                        href={focusedSupplier.shopUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="sourcing-source-link break-all"
                      >
                        {focusedSupplier.shopUrl}
                        <ArrowUpRight
                          className="h-4 w-4 shrink-0"
                          aria-hidden
                        />
                      </a>
                    ) : (
                      "未填写"
                    )}
                  </DetailField>
                  <DetailField title="联系人">
                    {focusedSupplier.contactName || "未填写"}
                  </DetailField>
                  <DetailField title="联系方式">
                    {focusedSupplier.contactInfo || "未填写"}
                  </DetailField>
                  <DetailField title="履约 / 异常记录">
                    {focusedSupplier.notes || "暂无记录"}
                  </DetailField>
                  <DetailField title="最近更新">
                    {dateTime(focusedSupplier.updatedAt)}
                  </DetailField>
                </dl>
              </div>
              <div className="border-t p-6">
                <Button
                  className="nike-button w-full"
                  onClick={() => showSupplierCandidates(focusedSupplier)}
                >
                  查看关联候选{" "}
                  <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
                </Button>
              </div>
            </>
          ) : (
            <div className="sourcing-empty p-6">
              <EmptyPanel
                title="这条记录当前不可用"
                description="它可能已被更新或移除。关闭抽屉后刷新列表，或选择其他记录。"
              />
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Dialog
        open={operation !== null}
        onOpenChange={open => {
          if (!open) requestClose("operation");
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="nike-workspace sourcing-operation"
          onCloseAutoFocus={event => {
            if (operationOpener.current?.isConnected) {
              event.preventDefault();
              operationOpener.current.focus();
            }
          }}
        >
          <DialogHeader className="relative border-b p-6 pr-16">
            <DialogTitle>
              {operation?.kind === "status"
                ? "推进选品状态"
                : operation?.kind === "compliance"
                  ? `${operation.platform === "etsy" ? "Etsy" : "eBay"} 渠道判断`
                  : "转为正式 SKU"}
            </DialogTitle>
            <DialogDescription>
              填写依据后确认保存，操作将保留审计记录。
            </DialogDescription>
            <Button
              variant="ghost"
              size="icon"
              className="nike-icon-button absolute right-4 top-4"
              aria-label="关闭操作"
              disabled={operationPending}
              onClick={() => requestClose("operation")}
            >
              <X className="h-5 w-5" aria-hidden />
            </Button>
          </DialogHeader>
          {operation && (
            <OperationForm
              operation={operation}
              pending={operationPending}
              error={operationError}
              onChange={() => setDirty(true)}
              onCancel={() => requestClose("operation")}
              onSubmit={submitOperation}
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={discardTarget !== null}
        onOpenChange={open => {
          if (!open) setDiscardTarget(null);
        }}
      >
        <AlertDialogContent className="nike-workspace">
          <AlertDialogHeader>
            <AlertDialogTitle>放弃尚未保存的内容？</AlertDialogTitle>
            <AlertDialogDescription>
              关闭后，本次填写的内容不会保存；已有记录不受影响。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="nike-button">
              继续编辑
            </AlertDialogCancel>
            <AlertDialogAction
              className="nike-button"
              onClick={() => {
                setDirty(false);
                if (discardTarget === "panel") closePanel();
                else setOperation(null);
                setDiscardTarget(null);
              }}
            >
              <Check className="mr-2 h-4 w-4" aria-hidden />
              确认放弃
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {creationPending || operationPending ? (
        <span className="sr-only" role="status">
          <LoaderCircle aria-hidden />
          正在保存，请稍候
        </span>
      ) : null}
    </div>
  );
}
