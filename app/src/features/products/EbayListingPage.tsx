import type { inferRouterOutputs } from "@trpc/server";
import { ArrowLeft, ExternalLink, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import type { AppRouter } from "../../../api/router";
import type {
  MarketplaceOptions,
  OptionsSection,
  PolicyOption,
} from "../../../api/marketplaces/types";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/workbench/PageHeader";
import { EmptyPanel, LoadingPanel } from "@/components/workbench/States";
import { StatusPill } from "@/components/workbench/StatusPill";
import { useAuth } from "@/hooks/useAuth";
import { dateTime } from "@/lib/format";
import { trpc } from "@/providers/trpc";
import {
  draftFromForm,
  EBAY_CONDITION_OPTIONS,
  formFromDraft,
  missingRequiredAspects,
  readinessIssues,
  type EbayForm,
} from "./ebay-form";

type ListingDetail = inferRouterOutputs<AppRouter>["marketplace"]["get"];

function PolicyField({
  label,
  value,
  section,
  onChange,
  emptyMessage,
}: {
  label: string;
  value: string;
  section: OptionsSection<PolicyOption> | undefined;
  onChange: (value: string) => void;
  emptyMessage: string;
}) {
  const items = section?.items ?? [];
  return (
    <label className="grid gap-1">
      <span className="ops-label">{label}</span>
      <select className="ops-input" value={value} onChange={event => onChange(event.target.value)}>
        <option value="">请选择{label}</option>
        {value && !items.some(item => item.id === value) ? (
          <option value={value}>已保存：{value}（当前列表未返回）</option>
        ) : null}
        {items.map(item => (
          <option key={item.id} value={item.id}>
            {item.name}
            {item.description ? ` · ${item.description}` : ""}
          </option>
        ))}
      </select>
      {section?.error ? <span className="text-xs text-red-500">{section.error}</span> : null}
      {section && !section.error && items.length === 0 ? (
        <span className="text-xs text-muted-foreground">{emptyMessage}</span>
      ) : null}
    </label>
  );
}

function policyName(section: OptionsSection<PolicyOption> | undefined, id: string) {
  return section?.items.find(item => item.id === id)?.name ?? id;
}

function PublishSummary({
  form,
  options,
  shopName,
  marketplaceId,
}: {
  form: EbayForm;
  options: MarketplaceOptions | undefined;
  shopName: string;
  marketplaceId: string;
}) {
  const draft = draftFromForm(form);
  const fields = [
    ["店铺 / 市场", `${shopName} · ${marketplaceId}`],
    ["eBay SKU", form.ebaySku],
    ["标题", form.title],
    ["售价 / 数量", `AUD ${Number(form.priceAud).toFixed(2)} / ${form.quantity} 件`],
    [
      "成色",
      EBAY_CONDITION_OPTIONS.find(item => item.value === form.condition)?.label ?? form.condition,
    ],
    ["类目 ID", form.categoryId],
    [
      "包裹",
      `${form.packageWeightG} g · ${form.packageLengthCm} × ${form.packageWidthCm} × ${form.packageHeightCm} cm`,
    ],
    ["运费政策", policyName(options?.fulfillmentPolicies, form.fulfillmentPolicyId)],
    ["付款政策", policyName(options?.paymentPolicies, form.paymentPolicyId)],
    ["退货政策", policyName(options?.returnPolicies, form.returnPolicyId)],
    ["发货地点", policyName(options?.locations, form.merchantLocationKey)],
  ];
  return (
    <div className="grid gap-3 text-sm">
      <dl>
        {fields.map(([name, value]) => (
          <div key={name} className="grid grid-cols-[7rem_1fr] gap-2 border-b py-2">
            <dt className="text-muted-foreground">{name}</dt>
            <dd className="min-w-0 break-words">{value}</dd>
          </div>
        ))}
      </dl>
      <div>
        <p className="font-medium">描述</p>
        <p className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words text-muted-foreground">
          {form.description}
        </p>
      </div>
      <div>
        <p className="font-medium">类目属性</p>
        {Object.entries(draft.aspects ?? {}).map(([name, values]) => (
          <p key={name} className="mt-1 break-words">
            {name}：{values.join("；")}
          </p>
        ))}
      </div>
      <div>
        <p className="font-medium">图片（{draft.imageUrls?.length ?? 0} 张）</p>
        {draft.imageUrls?.map((url, index) => (
          <a
            key={`${index}-${url}`}
            href={url}
            target="_blank"
            rel="noreferrer"
            className="mt-1 block break-all text-primary underline"
          >
            {index + 1}. {url}
          </a>
        ))}
      </div>
    </div>
  );
}

function EbayListingEditor({
  detail,
  refreshError,
}: {
  detail: ListingDetail;
  refreshError: string | undefined;
}) {
  const { listing, sku, store, canWriteToPlatform, marketplaceId } = detail;
  const { user } = useAuth();
  const canEdit =
    user?.status === "active" && (user.role === "admin" || user.businessRole === "operations");
  const isAdmin = user?.status === "active" && user.role === "admin";
  const utils = trpc.useUtils();
  const [form, setForm] = useState(() => formFromDraft(listing.localPayload));
  const [categoryText, setCategoryText] = useState("");
  const [categoryQuery, setCategoryQuery] = useState("");
  const [optionsCategoryId, setOptionsCategoryId] = useState(form.categoryId.trim());
  const [dialog, setDialog] = useState<"publish" | "unpublish" | null>(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setOptionsCategoryId(form.categoryId.trim()), 400);
    return () => clearTimeout(timer);
  }, [form.categoryId]);

  const options = trpc.marketplace.getOptions.useQuery(
    {
      storeConnectionId: listing.storeConnectionId,
      categoryId: optionsCategoryId || undefined,
      categoryQuery: categoryQuery || undefined,
    },
    { enabled: canEdit, retry: false, staleTime: 60_000, refetchOnWindowFocus: false }
  );

  const refresh = async () => {
    await Promise.all([
      utils.marketplace.get.invalidate({ listingId: listing.id }),
      utils.marketplace.list.invalidate({ skuId: sku.id }),
    ]);
  };
  const save = trpc.marketplace.saveDraft.useMutation({
    onSuccess: result => {
      setForm(formFromDraft(result.localPayload));
      toast.success("草稿已保存在工作台，未改动 eBay");
    },
    onError: error => toast.error(error.message),
    onSettled: refresh,
  });
  const push = trpc.marketplace.push.useMutation({
    onSuccess: result =>
      toast.success(
        result.status === "published" ? "已更新 eBay 当前在售商品" : "已更新到 eBay，尚未发布"
      ),
    onError: error => toast.error(error.message),
    onSettled: refresh,
  });
  const publish = trpc.marketplace.publish.useMutation({
    onSuccess: () => {
      setDialog(null);
      toast.success("商品已发布到 eBay");
    },
    onError: error => toast.error(error.message),
    onSettled: refresh,
  });
  const unpublish = trpc.marketplace.unpublish.useMutation({
    onSuccess: () => {
      setDialog(null);
      setReason("");
      toast.success("商品已从 eBay 下架，原因已记录");
    },
    onError: error => toast.error(error.message),
    onSettled: refresh,
  });

  const setField = <K extends keyof EbayForm>(key: K, value: EbayForm[K]) =>
    setForm(current => ({ ...current, [key]: value }));
  const draft = draftFromForm(form);
  const requiredAspects = (options.data?.aspects.items ?? []).filter(aspect => aspect.required);
  const missingAspects = missingRequiredAspects(
    draft,
    requiredAspects.map(aspect => aspect.name)
  );
  const issues = [
    ...readinessIssues(draft),
    ...missingAspects.map(name => `类目必填属性：${name}`),
  ];
  const unsaved = JSON.stringify(form) !== JSON.stringify(formFromDraft(listing.localPayload));
  const busy = save.isPending || push.isPending || publish.isPending || unpublish.isPending;
  const categoryChecked =
    optionsCategoryId === draft.categoryId &&
    Boolean(options.data) &&
    !options.isFetching &&
    !options.error &&
    !options.data?.aspects.error;
  const canPush =
    isAdmin &&
    canWriteToPlatform &&
    !busy &&
    !unsaved &&
    !refreshError &&
    issues.length === 0 &&
    categoryChecked;
  const canPublish =
    canPush &&
    listing.status === "ready" &&
    Boolean(listing.externalOfferId) &&
    !listing.hasUnpushedChanges;
  const canUnpublish =
    isAdmin && canWriteToPlatform && !busy && !refreshError && listing.status === "published";
  const missingScopes = options.data?.missingScopes ?? [];
  const editDisabled = !canEdit || busy || dialog !== null;

  const searchCategories = () => {
    const query = categoryText.trim();
    if (!query) {
      toast.error("请先填写类目搜索关键词");
      return;
    }
    if (query === categoryQuery) void options.refetch();
    else setCategoryQuery(query);
  };

  return (
    <div>
      <Link
        to={`/products/${sku.id}`}
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> 返回主商品
      </Link>
      <PageHeader
        eyebrow={`eBay 市场详情 · ${sku.code}`}
        title={sku.productName || sku.name}
        description="保存草稿只保存在工作台；更新到 eBay 使用已保存的草稿。新刊登需要核对后单独发布；已在售商品更新后会直接改动线上内容。"
        actions={
          listing.listingUrl ? (
            <Button asChild variant="outline">
              <a href={listing.listingUrl} target="_blank" rel="noreferrer">
                在 eBay 查看 <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          ) : undefined
        }
      />

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <form
          id="ebay-listing-form"
          onSubmit={event => {
            event.preventDefault();
            if (canEdit && !busy && dialog === null)
              save.mutate({ listingId: listing.id, payload: draftFromForm(form) });
          }}
        >
          <fieldset disabled={editDisabled} className="grid min-w-0 gap-5">
            <section className="ops-panel">
              <div className="ops-panel-header">
                <h2 className="ops-title">刊登资料</h2>
              </div>
              <div className="grid gap-4 p-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="grid gap-1">
                    <span className="ops-label">eBay SKU</span>
                    <Input
                      name="ebaySku"
                      maxLength={50}
                      className="ops-input font-mono"
                      value={form.ebaySku}
                      onChange={event => setField("ebaySku", event.target.value)}
                    />
                    <span className="text-xs text-muted-foreground">
                      字母、数字、点、下划线和短横线，最多 50 位
                    </span>
                  </label>
                  <label className="grid gap-1">
                    <span className="ops-label">成色</span>
                    <select
                      name="condition"
                      className="ops-input"
                      value={form.condition}
                      onChange={event => {
                        const selected = EBAY_CONDITION_OPTIONS.find(
                          item => item.value === event.target.value
                        );
                        if (selected) setField("condition", selected.value);
                      }}
                    >
                      {EBAY_CONDITION_OPTIONS.map(item => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="grid gap-1">
                  <span className="flex justify-between gap-2">
                    <span className="ops-label">标题</span>
                    <span
                      className={
                        form.title.length > 80
                          ? "text-xs text-red-500"
                          : "text-xs text-muted-foreground"
                      }
                      aria-live="polite"
                    >
                      {form.title.length} / 80 字符
                    </span>
                  </span>
                  <Input
                    name="title"
                    maxLength={80}
                    className="ops-input"
                    value={form.title}
                    onChange={event => setField("title", event.target.value)}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="ops-label">描述（支持 HTML 文本）</span>
                  <Textarea
                    name="description"
                    maxLength={500_000}
                    rows={7}
                    className="bg-secondary/70"
                    value={form.description}
                    onChange={event => setField("description", event.target.value)}
                  />
                </label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="grid gap-1">
                    <span className="ops-label">售价（AUD）</span>
                    <Input
                      name="priceAud"
                      type="number"
                      min="0"
                      max="1000000"
                      step="0.01"
                      className="ops-input"
                      value={form.priceAud}
                      onChange={event => setField("priceAud", event.target.value)}
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="ops-label">可售数量</span>
                    <Input
                      name="quantity"
                      type="number"
                      min="0"
                      max="999999"
                      step="1"
                      className="ops-input"
                      value={form.quantity}
                      onChange={event => setField("quantity", event.target.value)}
                    />
                  </label>
                </div>
                <label className="grid gap-1">
                  <span className="ops-label">图片 URL（每行一个）</span>
                  <Textarea
                    name="imageUrls"
                    rows={5}
                    className="bg-secondary/70 font-mono text-xs"
                    placeholder="https://..."
                    value={form.imageUrls}
                    onChange={event => setField("imageUrls", event.target.value)}
                  />
                  <span className="text-xs text-muted-foreground">
                    推送时需要 1–12 张公开可访问的 https 图片，不会自动上传本地图片。
                  </span>
                </label>
              </div>
            </section>

            <section className="ops-panel">
              <div className="ops-panel-header">
                <h2 className="ops-title">类目与属性</h2>
              </div>
              <div className="grid gap-4 p-4">
                <label className="grid gap-1">
                  <span className="ops-label">搜索 eBay 类目</span>
                  <span className="flex gap-2">
                    <Input
                      maxLength={120}
                      className="ops-input min-w-0"
                      placeholder="建议使用英文商品关键词"
                      value={categoryText}
                      onChange={event => setCategoryText(event.target.value)}
                      onKeyDown={event => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          searchCategories();
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={options.isFetching}
                      onClick={searchCategories}
                    >
                      <Search className="h-4 w-4" /> 搜索
                    </Button>
                  </span>
                </label>
                {options.data?.categories.error ? (
                  <p role="alert" className="text-sm text-red-500">
                    {options.data.categories.error}
                  </p>
                ) : null}
                {categoryQuery &&
                options.data &&
                !options.isFetching &&
                !options.data.categories.error &&
                options.data.categories.items.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    未找到匹配类目，请更换关键词或填写叶子类目 ID。
                  </p>
                ) : null}
                {options.data?.categories.items.length ? (
                  <ul className="grid max-h-56 gap-1 overflow-auto rounded-xl border p-2">
                    {options.data.categories.items.map(category => (
                      <li key={category.id}>
                        <button
                          type="button"
                          className="w-full rounded-lg p-2 text-left text-sm hover:bg-secondary disabled:opacity-50"
                          onClick={() => {
                            setField("categoryId", category.id);
                            setOptionsCategoryId(category.id);
                          }}
                        >
                          {category.path || category.name}{" "}
                          <span className="font-mono text-xs text-muted-foreground">
                            （{category.id}）
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <label className="grid gap-1">
                  <span className="ops-label">eBay 叶子类目 ID</span>
                  <Input
                    name="categoryId"
                    maxLength={32}
                    inputMode="numeric"
                    className="ops-input font-mono"
                    value={form.categoryId}
                    onChange={event => setField("categoryId", event.target.value)}
                  />
                </label>
                {options.isFetching ? (
                  <p role="status" className="text-xs text-muted-foreground">
                    正在读取类目、属性、政策和发货地点…
                  </p>
                ) : null}
                {options.data?.aspects.error ? (
                  <p role="alert" className="text-sm text-red-500">
                    {options.data.aspects.error}
                  </p>
                ) : null}
                {requiredAspects.length > 0 ? (
                  <div className="rounded-xl border p-3">
                    <p className="text-sm font-medium">类目必填属性</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {requiredAspects.map(aspect => (
                        <Button
                          key={aspect.name}
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            if (
                              !form.aspects.some(
                                row => row.name.trim().toLowerCase() === aspect.name.toLowerCase()
                              )
                            ) {
                              setField("aspects", [
                                ...form.aspects,
                                { name: aspect.name, values: "" },
                              ]);
                            }
                          }}
                        >
                          {aspect.name} *（点击添加）
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <datalist id="ebay-aspect-names">
                  {options.data?.aspects.items.map(aspect => (
                    <option key={aspect.name} value={aspect.name}>
                      {aspect.required ? "必填" : "可选"}
                    </option>
                  ))}
                </datalist>
                <div className="grid gap-3">
                  {form.aspects.map((row, index) => {
                    const aspect = options.data?.aspects.items.find(
                      item => item.name.toLowerCase() === row.name.trim().toLowerCase()
                    );
                    return (
                      <div
                        key={index}
                        className="grid items-start gap-2 rounded-xl border p-3 sm:grid-cols-[1fr_1.4fr_auto]"
                      >
                        <label className="grid gap-1">
                          <span className="ops-label">
                            属性名{aspect?.required ? " *（必填）" : ""}
                          </span>
                          <Input
                            maxLength={65}
                            list="ebay-aspect-names"
                            className="ops-input"
                            value={row.name}
                            onChange={event =>
                              setField(
                                "aspects",
                                form.aspects.map((item, rowIndex) =>
                                  rowIndex === index ? { ...item, name: event.target.value } : item
                                )
                              )
                            }
                          />
                        </label>
                        <label className="grid gap-1">
                          <span className="ops-label">属性值（多个值用分号分隔）</span>
                          <Input
                            list={`ebay-aspect-values-${index}`}
                            className="ops-input"
                            value={row.values}
                            onChange={event =>
                              setField(
                                "aspects",
                                form.aspects.map((item, rowIndex) =>
                                  rowIndex === index
                                    ? { ...item, values: event.target.value }
                                    : item
                                )
                              )
                            }
                          />
                          <datalist id={`ebay-aspect-values-${index}`}>
                            {aspect?.values.map(value => (
                              <option key={value} value={value} />
                            ))}
                          </datalist>
                          {aspect?.mode === "SELECTION_ONLY" ? (
                            <span className="text-xs text-muted-foreground">
                              请使用 eBay 建议值{aspect.multiple ? "，支持多值" : "，仅支持一个值"}
                            </span>
                          ) : null}
                        </label>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="sm:mt-5"
                          aria-label={`删除属性 ${row.name || index + 1}`}
                          onClick={() =>
                            setField(
                              "aspects",
                              form.aspects.filter((_, rowIndex) => rowIndex !== index)
                            )
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    );
                  })}
                  <Button
                    type="button"
                    variant="outline"
                    className="justify-self-start"
                    onClick={() => setField("aspects", [...form.aspects, { name: "", values: "" }])}
                  >
                    <Plus className="h-4 w-4" /> 添加属性
                  </Button>
                </div>
              </div>
            </section>

            <section className="ops-panel">
              <div className="ops-panel-header">
                <h2 className="ops-title">包裹与发货政策</h2>
              </div>
              <div className="grid gap-4 p-4 sm:grid-cols-2">
                {(
                  [
                    ["packageWeightG", "包裹重量（g）"],
                    ["packageLengthCm", "包裹长度（cm）"],
                    ["packageWidthCm", "包裹宽度（cm）"],
                    ["packageHeightCm", "包裹高度（cm）"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="grid gap-1">
                    <span className="ops-label">{label}</span>
                    <Input
                      name={key}
                      type="number"
                      min="0"
                      step="any"
                      className="ops-input"
                      value={form[key]}
                      onChange={event => setField(key, event.target.value)}
                    />
                  </label>
                ))}
                <PolicyField
                  label="运费政策"
                  value={form.fulfillmentPolicyId}
                  section={options.data?.fulfillmentPolicies}
                  onChange={value => setField("fulfillmentPolicyId", value)}
                  emptyMessage="请先在 eBay 开启 Business Policies 并创建运费政策。"
                />
                <PolicyField
                  label="付款政策"
                  value={form.paymentPolicyId}
                  section={options.data?.paymentPolicies}
                  onChange={value => setField("paymentPolicyId", value)}
                  emptyMessage="请先在 eBay 创建付款政策。"
                />
                <PolicyField
                  label="退货政策"
                  value={form.returnPolicyId}
                  section={options.data?.returnPolicies}
                  onChange={value => setField("returnPolicyId", value)}
                  emptyMessage="请先在 eBay 创建退货政策。"
                />
                <PolicyField
                  label="发货地点"
                  value={form.merchantLocationKey}
                  section={options.data?.locations}
                  onChange={value => setField("merchantLocationKey", value)}
                  emptyMessage="请先在 eBay 创建发货地点（Inventory Location）。"
                />
              </div>
            </section>
          </fieldset>
        </form>

        <aside className="grid gap-4 xl:sticky xl:top-4">
          <section className="ops-panel">
            <div className="ops-panel-header">
              <h2 className="ops-title">刊登状态</h2>
              <StatusPill value={listing.status} />
            </div>
            <div className="grid gap-3 p-4 text-sm">
              <p>
                店铺：{store?.shopName ?? "店铺已不可用"} · {marketplaceId}
              </p>
              <p className="break-all text-muted-foreground">
                Offer ID：{listing.externalOfferId ?? "尚未生成"}
                <br />
                Listing ID：{listing.externalListingId ?? "尚未发布"}
              </p>
              <p className="text-xs text-muted-foreground">
                最近推送：{listing.lastPushedAt ? dateTime(listing.lastPushedAt) : "从未推送"}
              </p>
              {unsaved ? (
                <p
                  role="status"
                  className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3"
                >
                  表单有未保存修改，请先保存草稿，再更新到 eBay。
                </p>
              ) : null}
              {listing.hasUnpushedChanges ? (
                <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3">
                  本地草稿有尚未推送到 eBay 的修改，发布前必须先更新。
                </p>
              ) : null}
              {listing.status === "publishing" ? (
                <p role="status">
                  正在发布，请等待并刷新状态。若超过 5 分钟仍未结束，可尝试“更新到 eBay”恢复。
                </p>
              ) : null}
              {listing.lastError ? (
                <p
                  role="alert"
                  className="whitespace-pre-wrap break-words rounded-lg border border-red-400/30 bg-red-500/10 p-3"
                >
                  {listing.lastError}
                </p>
              ) : null}
              {refreshError ? (
                <p role="alert" className="text-red-500">
                  读取最新状态失败：{refreshError}。请刷新后再操作平台。
                </p>
              ) : null}
              {!canWriteToPlatform || missingScopes.length > 0 ? (
                <div
                  role="alert"
                  className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3"
                >
                  <p>
                    eBay 授权缺少权限，请到
                    <Link to="/settings" className="underline">
                      “设置 → 店铺连接”
                    </Link>
                    重新授权 eBay。
                  </p>
                  <p className="mt-1 break-all text-xs">
                    {missingScopes.length > 0
                      ? missingScopes.join("；")
                      : "sell.inventory（刊登写入权限）"}
                  </p>
                </div>
              ) : null}
              {options.error ? (
                <p role="alert" className="text-red-500">
                  eBay 选项读取失败：{options.error.message}。请检查授权后重新读取。
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void refresh()}
                >
                  刷新状态
                </Button>
                {canEdit ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy || options.isFetching}
                    onClick={() => void options.refetch()}
                  >
                    重新读取 eBay 选项
                  </Button>
                ) : null}
              </div>
            </div>
          </section>
          <section className="ops-panel">
            <div className="ops-panel-header">
              <h2 className="ops-title">推送前检查</h2>
            </div>
            <div className="p-4 text-sm">
              {issues.length > 0 ? (
                <>
                  <p>还需补全或修正：</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {issues.map(issue => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <p>基础资料已完整，最终以 eBay 校验结果为准。</p>
              )}
              {canEdit && form.categoryId && !categoryChecked ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  需要成功读取当前类目的必填属性后才能更新或发布。
                </p>
              ) : null}
            </div>
          </section>
          <section className="ops-panel">
            <div className="grid gap-2 p-4">
              <Button type="submit" form="ebay-listing-form" disabled={!canEdit || busy}>
                {save.isPending ? "保存中…" : "保存草稿"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={!canPush}
                onClick={() => push.mutate({ listingId: listing.id })}
              >
                {push.isPending ? "更新中…" : "更新到 eBay"}
              </Button>
              <Button type="button" disabled={!canPublish} onClick={() => setDialog("publish")}>
                {publish.isPending ? "发布中…" : "核对并发布"}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={!canUnpublish}
                onClick={() => setDialog("unpublish")}
              >
                {unpublish.isPending ? "下架中…" : "下架"}
              </Button>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {canEdit
                  ? "管理员和运营可编辑、保存草稿；仅管理员可更新到 eBay、发布和下架。"
                  : "当前角色仅可查看，不能编辑或操作 eBay 刊登。"}
              </p>
            </div>
          </section>
        </aside>
      </div>

      <AlertDialog
        open={dialog !== null}
        onOpenChange={open => {
          if (!open && !busy) setDialog(null);
        }}
      >
        <AlertDialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {dialog === "publish" ? "核对 eBay 刊登并确认发布" : "确认从 eBay 下架"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {dialog === "publish"
                ? "以下内容已保存并推送到 eBay。请核对售价、数量、类目、图片及政策；确认后商品将公开上架，可能产生 eBay 费用。"
                : "此操作会结束当前 eBay 在售刊登，不会删除本地草稿。必须填写下架原因，原因会写入审计记录。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {dialog === "publish" ? (
            <PublishSummary
              form={form}
              options={options.data}
              shopName={store?.shopName ?? "店铺已不可用"}
              marketplaceId={marketplaceId}
            />
          ) : (
            <div className="grid gap-3">
              <p className="text-sm">
                店铺：{store?.shopName} · Listing ID：{listing.externalListingId ?? "未返回"}
              </p>
              <label className="grid gap-1">
                <span className="ops-label">下架原因（2–500 字）</span>
                <Textarea
                  autoFocus
                  minLength={2}
                  maxLength={500}
                  disabled={busy}
                  value={reason}
                  onChange={event => setReason(event.target.value)}
                  placeholder="例如：库存不足，暂停销售"
                />
              </label>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={
                dialog === "publish" ? !canPublish : !canUnpublish || reason.trim().length < 2
              }
              onClick={event => {
                event.preventDefault();
                if (dialog === "publish" && canPublish)
                  publish.mutate({ listingId: listing.id, confirm: true });
                if (dialog === "unpublish" && canUnpublish && reason.trim().length >= 2)
                  unpublish.mutate({ listingId: listing.id, confirm: true, reason: reason.trim() });
              }}
            >
              {busy ? "处理中…" : dialog === "publish" ? "确认发布到 eBay" : "确认下架"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function EbayListingPage() {
  const skuId = Number(useParams().skuId);
  const validSkuId = Number.isSafeInteger(skuId) && skuId > 0;
  const listings = trpc.marketplace.list.useQuery({ skuId }, { enabled: validSkuId, retry: false });
  const listing = listings.data?.listings.find(item => item.platform === "ebay");
  const detail = trpc.marketplace.get.useQuery(
    { listingId: listing?.id ?? 0 },
    {
      enabled: Boolean(listing),
      retry: false,
      refetchInterval: query => (query.state.data?.listing.status === "publishing" ? 3_000 : false),
    }
  );

  if (!validSkuId)
    return (
      <EmptyPanel
        title="商品编号无效"
        description="请从库存页选择商品后进入 eBay 详情。"
        action={
          <Button asChild>
            <Link to="/inventory">返回库存</Link>
          </Button>
        }
      />
    );
  if (listings.isLoading || (listing && detail.isLoading)) return <LoadingPanel />;
  if (!listings.data)
    return (
      <EmptyPanel
        title="商品加载失败"
        description={listings.error?.message ?? "商品不存在"}
        action={<Button onClick={() => void listings.refetch()}>重试</Button>}
      />
    );
  if (!listing)
    return (
      <EmptyPanel
        title="尚未创建 eBay 详情"
        description="请先在主商品页创建 eBay 草稿。"
        action={
          <Button asChild>
            <Link to={`/products/${skuId}`}>返回主商品</Link>
          </Button>
        }
      />
    );
  if (!detail.data)
    return (
      <EmptyPanel
        title="eBay 详情加载失败"
        description={detail.error?.message ?? "刊登不存在"}
        action={<Button onClick={() => void detail.refetch()}>重试</Button>}
      />
    );
  return (
    <EbayListingEditor
      key={listing.id}
      detail={detail.data}
      refreshError={detail.error?.message ?? listings.error?.message}
    />
  );
}
