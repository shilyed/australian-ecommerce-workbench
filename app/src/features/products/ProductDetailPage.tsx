import { ArrowLeft, ExternalLink, Store } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/workbench/PageHeader";
import { EmptyPanel, LoadingPanel } from "@/components/workbench/States";
import { StatusPill } from "@/components/workbench/StatusPill";
import { useAuth } from "@/hooks/useAuth";
import { dateTime } from "@/lib/format";
import { trpc } from "@/providers/trpc";

function Field({
  name,
  value,
}: {
  name: string;
  value: string | number | null | undefined;
}) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-3 border-b border-border/50 py-2 text-sm last:border-0">
      <span className="text-muted-foreground">{name}</span>
      <span className="min-w-0 break-words">
        {value === null || value === undefined || value === "" ? "—" : value}
      </span>
    </div>
  );
}

export default function ProductDetailPage() {
  const skuId = Number(useParams().skuId);
  const navigate = useNavigate();
  const { user } = useAuth();
  const canEdit = user?.role === "admin" || user?.businessRole === "operations";
  const query = trpc.marketplace.list.useQuery(
    { skuId },
    { enabled: Number.isInteger(skuId) && skuId > 0 }
  );
  const createEbay = trpc.marketplace.createEbay.useMutation({
    onSuccess: () => {
      toast.success("已用主商品资料生成 eBay 草稿（未推送到 eBay）");
      navigate(`/products/${skuId}/marketplaces/ebay`);
    },
    onError: error => toast.error(error.message),
  });

  if (query.isLoading) return <LoadingPanel />;
  if (query.error || !query.data)
    return (
      <EmptyPanel
        title="主商品加载失败"
        description={query.error?.message ?? "商品不存在"}
        action={<Button onClick={() => query.refetch()}>重试</Button>}
      />
    );

  const { sku, listings, stores, legacyListings, marketplaceId } = query.data;
  const ebayStores = stores.filter(store => store.platform === "ebay");
  const ebayListing = listings.find(listing => listing.platform === "ebay");
  const ebayStore =
    ebayStores.find(store => store.id === ebayListing?.storeConnectionId) ??
    ebayStores[0];

  return (
    <div>
      <Link
        to="/inventory"
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> 返回库存
      </Link>
      <PageHeader
        eyebrow={`主商品 · ${sku.code}`}
        title={sku.productName || sku.name}
        description="左侧是主商品资料（所有市场共用）。右侧每个市场有独立详情：在详情页编辑后只保存在工作台，需要人工点击“更新到平台”和“发布”才会改动线上。"
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <section className="ops-panel">
          <div className="ops-panel-header">
            <div>
              <h2 className="ops-title">主商品资料</h2>
              <p className="ops-subtitle">
                在库存页维护；创建市场详情时会自动带入
              </p>
            </div>
            <StatusPill value={sku.status} />
          </div>
          <div className="p-4">
            <Field name="内部 SKU" value={sku.code} />
            <Field name="商品名称" value={sku.productName} />
            <Field name="规格名称" value={sku.name} />
            <Field name="规格" value={sku.spec} />
            <Field name="英文名称" value={sku.declarationNameEn} />
            <Field name="材质" value={sku.material} />
            <Field name="原产地" value={sku.originCountry} />
            <Field name="HS 编码" value={sku.hsCode} />
            <Field
              name="重量"
              value={
                sku.weight ? `${sku.weight} ${sku.weightUnit ?? "g"}` : null
              }
            />
            <Field name="尺寸" value={sku.dimensions} />
            <Field name="货源平台" value={sku.sourcePlatform} />
            <Field name="供应商货号" value={sku.supplierSku} />
            <Field name="更新时间" value={dateTime(sku.updatedAt)} />
          </div>
        </section>

        <section className="ops-panel">
          <div className="ops-panel-header">
            <div>
              <h2 className="ops-title">市场详情</h2>
              <p className="ops-subtitle">Information in marketplaces</p>
            </div>
          </div>
          <div className="grid gap-3 p-4">
            <article className="bg-secondary/35 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="flex items-center gap-2 font-semibold">
                    <Store className="h-4 w-4 text-primary" /> eBay ·{" "}
                    {marketplaceId}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    店铺：{ebayStore?.shopName ?? "未连接"}
                    {ebayStore
                      ? ` · 授权 ${ebayStore.authorizationStatus === "authorized" ? "正常" : ebayStore.authorizationStatus}`
                      : ""}
                  </p>
                </div>
                {ebayListing ? (
                  <StatusPill value={ebayListing.status} />
                ) : (
                  <StatusPill value="not_created" />
                )}
              </div>

              {ebayListing ? (
                <div className="mt-3 grid gap-1 text-sm">
                  <Field name="eBay SKU" value={ebayListing.platformSku} />
                  <Field name="Offer ID" value={ebayListing.externalOfferId} />
                  <Field
                    name="Listing ID"
                    value={ebayListing.externalListingId}
                  />
                  <Field
                    name="最近推送"
                    value={
                      ebayListing.lastPushedAt
                        ? dateTime(ebayListing.lastPushedAt)
                        : "从未推送"
                    }
                  />
                  {ebayListing.hasUnpushedChanges ? (
                    <p className="mt-2 rounded-lg border border-amber-300/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-300">
                      本地详情有尚未更新到 eBay 的修改
                    </p>
                  ) : null}
                  {ebayListing.lastError ? (
                    <p className="mt-2 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                      {ebayListing.lastError}
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">
                  还没有 eBay
                  详情。创建后会用主商品资料预填标题、SKU、材质、原产地和包裹信息。
                </p>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                {ebayListing ? (
                  <Button asChild>
                    <Link to={`/products/${skuId}/marketplaces/ebay`}>
                      打开 eBay 详情
                    </Link>
                  </Button>
                ) : (
                  <Button
                    disabled={!ebayStore || !canEdit || createEbay.isPending}
                    onClick={() =>
                      ebayStore &&
                      createEbay.mutate({
                        skuId,
                        storeConnectionId: ebayStore.id,
                      })
                    }
                  >
                    {createEbay.isPending ? "创建中…" : "创建 eBay 详情"}
                  </Button>
                )}
                {ebayListing?.listingUrl ? (
                  <Button asChild variant="outline">
                    <a
                      href={ebayListing.listingUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      在 eBay 查看 <ExternalLink className="ml-1 h-4 w-4" />
                    </a>
                  </Button>
                ) : null}
              </div>
              {!ebayStore ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  请先到“设置 → 店铺连接”授权 eBay 店铺。
                </p>
              ) : null}
            </article>

            {[
              { name: "Etsy", note: "尚未开店，接入后在这里创建 Etsy 详情" },
              { name: "Amazon", note: "尚未接入" },
            ].map(market => (
              <article key={market.name} className="border-t px-4 py-5">
                <div className="flex items-center justify-between">
                  <p className="flex items-center gap-2 font-semibold">
                    <Store className="h-4 w-4" /> {market.name}
                  </p>
                  <StatusPill value="not_connected" />
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {market.note}
                </p>
              </article>
            ))}

            {legacyListings.length > 0 ? (
              <div className="rounded-2xl border p-4">
                <p className="text-sm font-medium">
                  已映射的平台刊登（同步自平台）
                </p>
                {legacyListings.map(item => (
                  <div
                    key={item.id}
                    className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm"
                  >
                    <span className="min-w-0 truncate">
                      {item.platform.toUpperCase()} · {item.title}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {item.platformStatus}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
