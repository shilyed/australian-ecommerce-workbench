import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Link2,
  Loader2,
  PlugZap,
  RefreshCw,
  Store,
  Unplug,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/workbench/StatusPill";
import { dateTime, numberFmt } from "@/lib/format";

type StoreProfile = {
  accountId: string;
  accountLabel: string | null;
  shopName: string;
  shopUrl: string | null;
  currency: string | null;
  country: string | null;
  listingCount: number | null;
  orderCount: number | null;
  soldCount: number | null;
  reviewCount: number | null;
  reviewAverage: number | null;
  sellingLimitAmount: number | null;
  sellingLimitQuantity: number | null;
  sellingLimitCurrency: string | null;
  vacation: boolean | null;
  marketplace: string | null;
  fetchedAt: string;
  notes: string[];
};

export type StoreConnectionRow = {
  id: number;
  platform: "etsy" | "ebay";
  shopName: string;
  externalShopId: string;
  authorizationStatus: string;
  errorSummary: string | null;
  lastAttemptAt: Date | string | null;
  lastSuccessAt: Date | string | null;
  profileSyncedAt: Date | string | null;
  accountLabel: string | null;
  hasCredentials: boolean;
  profile: StoreProfile | null;
};

export type ProviderInfoRow = {
  platform: "etsy" | "ebay";
  configured: boolean;
  missing: string[];
  redirectUri: string | null;
  scopes: string[];
  docsUrl: string;
  notes: string[];
};

const PLATFORM_META = {
  etsy: {
    name: "Etsy",
    accent: "bg-orange-500/15 text-orange-600 dark:text-orange-300 border-orange-500/30",
    hint: "Etsy Open API v3 · OAuth 2.0 + PKCE",
  },
  ebay: {
    name: "eBay",
    accent: "bg-blue-500/15 text-blue-600 dark:text-blue-300 border-blue-500/30",
    hint: "eBay REST API · OAuth 2.0 授权码",
  },
} as const;

function Metric({ labelText, value }: { labelText: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{labelText}</p>
      <p className="mt-1 truncate font-mono text-sm text-foreground" title={value}>{value}</p>
    </div>
  );
}

export function StoreIntegrationCard({
  platform,
  provider,
  providerLoading = false,
  stores,
  isAdmin,
  onRefresh,
  onDisconnect,
  refreshPending,
  disconnectPending,
}: {
  platform: "etsy" | "ebay";
  provider: ProviderInfoRow | undefined;
  providerLoading?: boolean;
  stores: StoreConnectionRow[];
  isAdmin: boolean;
  onRefresh: (storeId: number) => void;
  onDisconnect: (storeId: number) => void;
  refreshPending: boolean;
  disconnectPending: boolean;
}) {
  const meta = PLATFORM_META[platform];
  const connected = stores.filter((store) => store.hasCredentials);
  const hasAnyStore = stores.length > 0;

  return (
    <article className="flex h-full flex-col rounded-xl border border-border/70 bg-secondary/25">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`inline-flex h-7 items-center rounded-md border px-2 text-xs font-semibold ${meta.accent}`}>
              {meta.name}
            </span>
            {connected.length > 0 ? (
              <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 dark:text-emerald-300">
                <CheckCircle2 className="mr-1 h-3 w-3" />已直连 {connected.length} 家
              </Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">未直连</Badge>
            )}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{meta.hint}</p>
        </div>
        {providerLoading ? (
          <Badge variant="outline" className="text-muted-foreground">
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />检查配置中
          </Badge>
        ) : provider?.configured ? (
          isAdmin ? (
            <Button asChild className="min-h-10">
              <a href={`/api/integrations/${platform}/start?returnTo=${encodeURIComponent("/settings")}`}>
                <Link2 className="mr-2 h-4 w-4" />
                {connected.length > 0 ? `重新授权 ${meta.name}` : `用 ${meta.name} 账号连接`}
              </a>
            </Button>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">仅管理员可连接</Badge>
          )
        ) : (
          <Badge variant="outline" className="border-amber-500/40 text-amber-600 dark:text-amber-300">
            <AlertTriangle className="mr-1 h-3 w-3" />应用未配置
          </Badge>
        )}
      </header>

      <div className="flex-1 space-y-3 p-4">
        {!providerLoading && !provider?.configured && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-5 text-amber-700 dark:text-amber-200">
            <p className="font-semibold">还差一步：在服务端环境变量中补全应用凭证</p>
            <p className="mt-1">缺少：<span className="font-mono">{provider?.missing.join("、") || "未知"}</span></p>
            <p className="mt-1">
              配置后重启服务即可在此直接登录 {meta.name} 授权，无需手工填写店铺 ID。
              {" "}
              <a className="underline underline-offset-2" href={provider?.docsUrl} target="_blank" rel="noreferrer">
                查看官方文档
              </a>
            </p>
          </div>
        )}

        {!hasAnyStore && (
          <div className="rounded-lg border border-dashed border-border p-6 text-center">
            <Store className="mx-auto h-6 w-6 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">还没有登记 {meta.name} 店铺。</p>
            <p className="mt-1 text-xs text-muted-foreground">
              完成官方授权后，店铺名称、刊登数、订单数与销售额度会自动同步到这里。
            </p>
          </div>
        )}

        {stores.map((store) => (
          <div key={store.id} className="rounded-lg border border-border/60 bg-card/70 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-semibold">{store.shopName}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {store.hasCredentials ? "官方 OAuth 直连" : "手工登记（无官方凭证）"}
                  {store.accountLabel ? ` · ${store.accountLabel}` : ""}
                  {" "}· ID {store.externalShopId}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusPill value={store.authorizationStatus} />
                {store.hasCredentials ? (
                  <Badge variant="outline" className="border-primary/40 text-primary">实时</Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">静态</Badge>
                )}
              </div>
            </div>

            {store.profile ? (
              <>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Metric labelText="在售刊登" value={store.profile.listingCount === null ? "—" : numberFmt(store.profile.listingCount)} />
                  <Metric
                    labelText={platform === "ebay" ? "近 90 天订单" : "店铺订单"}
                    value={store.profile.orderCount === null ? "—" : numberFmt(store.profile.orderCount)}
                  />
                  {platform === "etsy" ? (
                    <Metric labelText="累计销量" value={store.profile.soldCount === null ? "—" : numberFmt(store.profile.soldCount)} />
                  ) : (
                    <Metric
                      labelText="销售额度"
                      value={
                        store.profile.sellingLimitAmount === null
                          ? "—"
                          : `${numberFmt(store.profile.sellingLimitAmount)} ${store.profile.sellingLimitCurrency ?? ""}`.trim()
                      }
                    />
                  )}
                  {platform === "etsy" ? (
                    <Metric
                      labelText="评价"
                      value={
                        store.profile.reviewAverage === null
                          ? "—"
                          : `${store.profile.reviewAverage.toFixed(2)} · ${numberFmt(store.profile.reviewCount ?? 0)}`
                      }
                    />
                  ) : (
                    <Metric
                      labelText="可售数量额度"
                      value={store.profile.sellingLimitQuantity === null ? "—" : numberFmt(store.profile.sellingLimitQuantity)}
                    />
                  )}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                  <span>币种：{store.profile.currency ?? "—"}</span>
                  <span>市场：{store.profile.marketplace ?? "—"}</span>
                  <span>数据时间：{dateTime(store.profileSyncedAt ?? store.profile.fetchedAt)}</span>
                  {store.profile.vacation ? <span className="text-amber-600 dark:text-amber-300">店铺休假中</span> : null}
                  {store.profile.shopUrl ? (
                    <a className="inline-flex items-center gap-1 text-primary hover:underline" href={store.profile.shopUrl} target="_blank" rel="noreferrer">
                      打开店铺<ArrowUpRight className="h-3 w-3" />
                    </a>
                  ) : null}
                </div>

                {store.profile.notes.length > 0 && (
                  <ul className="mt-2 space-y-1 text-[11px] leading-5 text-muted-foreground">
                    {store.profile.notes.map((note) => (
                      <li key={note}>· {note}</li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="mt-3 rounded-md border border-dashed border-border p-2 text-xs leading-5 text-muted-foreground">
                暂无实时店铺数据。{store.hasCredentials ? "点击右侧“刷新数据”从平台重新读取。" : "完成官方授权后可读取店铺名称、刊登与订单数据。"}
              </p>
            )}

            {store.errorSummary && (
              <p className="mt-2 rounded-md border border-red-500/30 bg-red-500/10 p-2 text-xs leading-5 text-red-700 dark:text-red-200">
                {store.errorSummary}
              </p>
            )}

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground">
                最近尝试：{store.lastAttemptAt ? dateTime(store.lastAttemptAt) : "—"}
              </span>
              {isAdmin && store.hasCredentials && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-9"
                    disabled={refreshPending}
                    onClick={() => onRefresh(store.id)}
                  >
                    {refreshPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}
                    刷新数据
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="min-h-9 text-destructive hover:text-destructive"
                    disabled={disconnectPending}
                    onClick={() => {
                      if (window.confirm(`确定断开 ${store.shopName} 的官方授权？历史业务数据会保留，但实时读取会停止。`)) {
                        onDisconnect(store.id);
                      }
                    }}
                  >
                    <Unplug className="mr-1 h-4 w-4" />断开授权
                  </Button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <footer className="border-t border-border/60 px-4 py-3 text-[11px] leading-5 text-muted-foreground">
        <p className="flex items-center gap-1">
          <PlugZap className="h-3 w-3" />
          回调地址：<span className="break-all font-mono">{provider?.redirectUri ?? "未配置"}</span>
        </p>
        {provider?.notes.map((note) => <p key={note} className="mt-1">· {note}</p>)}
      </footer>
    </article>
  );
}
