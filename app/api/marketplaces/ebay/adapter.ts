import { IntegrationError } from "../../integrations/types";
import type {
  AspectOption,
  CategorySuggestion,
  MarketplaceAdapter,
  MarketplaceOptions,
  OptionsSection,
  PolicyOption,
  PublishResult,
  PushResult,
} from "../types";
import { toInventoryItem, toOffer } from "./payload";
import { type EbayListingPayload, validateEbayListing } from "./schema";

const REQUEST_TIMEOUT_MS = 15_000;

const CATEGORY_TREE_IDS: Record<string, string> = {
  EBAY_US: "0",
  EBAY_GB: "3",
  EBAY_AU: "15",
  EBAY_DE: "77",
  EBAY_CA: "2",
};

const CONTENT_LANGUAGE: Record<string, string> = {
  EBAY_AU: "en-AU",
  EBAY_US: "en-US",
  EBAY_GB: "en-GB",
  EBAY_CA: "en-CA",
  EBAY_DE: "de-DE",
};

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type EbayAdapterOptions = {
  accessToken: string;
  marketplaceId: string;
  baseUrl: string;
  fetchImpl?: FetchLike;
};

type EbayErrorBody = {
  errors?: Array<{
    errorId?: number;
    message?: string;
    longMessage?: string;
    parameters?: Array<{ name?: string; value?: string }>;
  }>;
  error_description?: string;
  message?: string;
};

export class EbayApiError extends IntegrationError {
  readonly errorIds: number[];
  readonly body: EbayErrorBody | null;

  constructor(message: string, status: number, body: EbayErrorBody | null) {
    super(message, status, message);
    this.name = "EbayApiError";
    this.body = body;
    this.errorIds = (body?.errors ?? [])
      .map(error => error.errorId)
      .filter((id): id is number => typeof id === "number");
  }
}

function describeEbayError(body: EbayErrorBody | null, raw: string): string {
  const errors = body?.errors ?? [];
  if (errors.length > 0) {
    return errors
      .slice(0, 3)
      .map(error => {
        const text = error.longMessage || error.message || "平台返回错误";
        return error.errorId ? `[${error.errorId}] ${text}` : text;
      })
      .join("；");
  }
  if (body?.error_description) return body.error_description;
  if (body?.message) return body.message;
  return raw.trim().slice(0, 300) || "平台返回空响应";
}

export function createEbayAdapter(options: EbayAdapterOptions): MarketplaceAdapter<EbayListingPayload> {
  const { accessToken, marketplaceId, baseUrl } = options;
  const fetchImpl: FetchLike = options.fetchImpl ?? ((url, init) => fetch(url, init));
  const language = CONTENT_LANGUAGE[marketplaceId] ?? "en-US";

  async function request<T>(
    method: "GET" | "POST" | "PUT",
    path: string,
    label: string,
    body?: unknown
  ): Promise<T | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "Accept-Language": language,
        "Content-Language": language,
        "X-EBAY-C-MARKETPLACE-ID": marketplaceId,
      };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      const response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      let parsed: unknown = null;
      if (text.trim()) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = null;
        }
      }
      if (!response.ok) {
        const errorBody = (parsed as EbayErrorBody | null) ?? null;
        throw new EbayApiError(
          `${label}失败（HTTP ${response.status}）：${describeEbayError(errorBody, text)}`,
          response.status,
          errorBody
        );
      }
      return (parsed as T | null) ?? null;
    } catch (error) {
      if (error instanceof IntegrationError) throw error;
      if ((error as Error).name === "AbortError") {
        throw new IntegrationError(`${label}超时，请稍后重试`);
      }
      throw new IntegrationError(`${label}失败：${(error as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  async function findOfferIdBySku(sku: string): Promise<string | null> {
    try {
      const result = await request<{ offers?: Array<{ offerId?: string; marketplaceId?: string }> }>(
        "GET",
        `/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}&marketplace_id=${encodeURIComponent(marketplaceId)}`,
        "查询 eBay Offer"
      );
      const match = (result?.offers ?? []).find(
        offer => offer.offerId && (!offer.marketplaceId || offer.marketplaceId === marketplaceId)
      );
      return match?.offerId ?? null;
    } catch (error) {
      // 404 / 25713：该 SKU 还没有 Offer，属于正常情况。
      if (error instanceof EbayApiError && (error.status === 404 || error.errorIds.includes(25713))) {
        return null;
      }
      throw error;
    }
  }

  async function section<T>(load: () => Promise<T[]>): Promise<OptionsSection<T>> {
    try {
      return { items: await load(), error: null };
    } catch (error) {
      return { items: [], error: error instanceof Error ? error.message : "读取失败" };
    }
  }

  const treeId = CATEGORY_TREE_IDS[marketplaceId] ?? "15";

  return {
    validate: validateEbayListing,

    async createOrUpdate(payload, existingOfferId): Promise<PushResult> {
      await request(
        "PUT",
        `/sell/inventory/v1/inventory_item/${encodeURIComponent(payload.ebaySku)}`,
        "写入 eBay 库存商品",
        toInventoryItem(payload)
      );

      const offerBody = toOffer(payload, marketplaceId);
      const offerId = existingOfferId ?? (await findOfferIdBySku(payload.ebaySku));
      if (offerId) {
        await request(
          "PUT",
          `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`,
          "更新 eBay Offer",
          offerBody
        );
        return { offerId, inventoryWritten: true };
      }

      const created = await request<{ offerId?: string }>(
        "POST",
        "/sell/inventory/v1/offer",
        "创建 eBay Offer",
        offerBody
      );
      if (!created?.offerId) throw new IntegrationError("eBay 未返回 offerId");
      return { offerId: created.offerId, inventoryWritten: true };
    },

    async publish(offerId): Promise<PublishResult> {
      const result = await request<{ listingId?: string; warnings?: Array<{ message?: string }> }>(
        "POST",
        `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/publish`,
        "发布 eBay 刊登"
      );
      if (!result?.listingId) throw new IntegrationError("eBay 未返回 listingId");
      return {
        listingId: result.listingId,
        warnings: (result.warnings ?? []).map(warning => warning.message ?? "").filter(Boolean),
      };
    },

    async unpublish(offerId): Promise<PublishResult> {
      const result = await request<{ listingId?: string; warnings?: Array<{ message?: string }> }>(
        "POST",
        `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/withdraw`,
        "下架 eBay 刊登"
      );
      return {
        listingId: result?.listingId ?? "",
        warnings: (result?.warnings ?? []).map(warning => warning.message ?? "").filter(Boolean),
      };
    },

    async fetchOptions({ categoryId, categoryQuery }): Promise<MarketplaceOptions> {
      const market = encodeURIComponent(marketplaceId);
      const [fulfillmentPolicies, paymentPolicies, returnPolicies, locations, aspects, categories] =
        await Promise.all([
          section<PolicyOption>(async () => {
            const data = await request<{
              fulfillmentPolicies?: Array<{ fulfillmentPolicyId?: string; name?: string; description?: string }>;
            }>("GET", `/sell/account/v1/fulfillment_policy?marketplace_id=${market}`, "读取运费政策");
            return (data?.fulfillmentPolicies ?? [])
              .filter(policy => policy.fulfillmentPolicyId)
              .map(policy => ({
                id: policy.fulfillmentPolicyId!,
                name: policy.name ?? policy.fulfillmentPolicyId!,
                description: policy.description ?? null,
              }));
          }),
          section<PolicyOption>(async () => {
            const data = await request<{
              paymentPolicies?: Array<{ paymentPolicyId?: string; name?: string; description?: string }>;
            }>("GET", `/sell/account/v1/payment_policy?marketplace_id=${market}`, "读取付款政策");
            return (data?.paymentPolicies ?? [])
              .filter(policy => policy.paymentPolicyId)
              .map(policy => ({
                id: policy.paymentPolicyId!,
                name: policy.name ?? policy.paymentPolicyId!,
                description: policy.description ?? null,
              }));
          }),
          section<PolicyOption>(async () => {
            const data = await request<{
              returnPolicies?: Array<{ returnPolicyId?: string; name?: string; description?: string }>;
            }>("GET", `/sell/account/v1/return_policy?marketplace_id=${market}`, "读取退货政策");
            return (data?.returnPolicies ?? [])
              .filter(policy => policy.returnPolicyId)
              .map(policy => ({
                id: policy.returnPolicyId!,
                name: policy.name ?? policy.returnPolicyId!,
                description: policy.description ?? null,
              }));
          }),
          section<PolicyOption>(async () => {
            const data = await request<{
              locations?: Array<{
                merchantLocationKey?: string;
                name?: string;
                location?: { address?: { city?: string; stateOrProvince?: string; country?: string } };
              }>;
            }>("GET", "/sell/inventory/v1/location?limit=100", "读取发货地点");
            return (data?.locations ?? [])
              .filter(location => location.merchantLocationKey)
              .map(location => {
                const address = location.location?.address;
                return {
                  id: location.merchantLocationKey!,
                  name: location.name ?? location.merchantLocationKey!,
                  description: [address?.city, address?.stateOrProvince, address?.country]
                    .filter(Boolean)
                    .join(", "),
                };
              });
          }),
          section<AspectOption>(async () => {
            if (!categoryId || !/^\d+$/.test(categoryId)) return [];
            const data = await request<{
              aspects?: Array<{
                localizedAspectName?: string;
                aspectConstraint?: {
                  aspectRequired?: boolean;
                  aspectUsage?: string;
                  aspectMode?: string;
                  itemToAspectCardinality?: string;
                };
                aspectValues?: Array<{ localizedValue?: string }>;
              }>;
            }>(
              "GET",
              `/commerce/taxonomy/v1/category_tree/${treeId}/get_item_aspects_for_category?category_id=${encodeURIComponent(categoryId)}`,
              "读取类目属性"
            );
            return (data?.aspects ?? [])
              .filter(aspect => aspect.localizedAspectName)
              .map(aspect => ({
                name: aspect.localizedAspectName!,
                required: Boolean(aspect.aspectConstraint?.aspectRequired),
                recommended: aspect.aspectConstraint?.aspectUsage === "RECOMMENDED",
                mode: aspect.aspectConstraint?.aspectMode === "SELECTION_ONLY" ? "SELECTION_ONLY" : "FREE_TEXT",
                multiple: aspect.aspectConstraint?.itemToAspectCardinality === "MULTI",
                values: (aspect.aspectValues ?? [])
                  .map(value => value.localizedValue ?? "")
                  .filter(Boolean)
                  .slice(0, 60),
              }));
          }),
          section<CategorySuggestion>(async () => {
            const query = categoryQuery?.trim();
            if (!query) return [];
            const data = await request<{
              categorySuggestions?: Array<{
                category?: { categoryId?: string; categoryName?: string };
                categoryTreeNodeAncestors?: Array<{ categoryName?: string }>;
              }>;
            }>(
              "GET",
              `/commerce/taxonomy/v1/category_tree/${treeId}/get_category_suggestions?q=${encodeURIComponent(query)}`,
              "搜索 eBay 类目"
            );
            return (data?.categorySuggestions ?? [])
              .filter(item => item.category?.categoryId)
              .slice(0, 10)
              .map(item => ({
                id: item.category!.categoryId!,
                name: item.category!.categoryName ?? item.category!.categoryId!,
                path: [...(item.categoryTreeNodeAncestors ?? []).map(node => node.categoryName ?? "").reverse(), item.category!.categoryName ?? ""]
                  .filter(Boolean)
                  .join(" › "),
              }));
          }),
        ]);
      return { fulfillmentPolicies, paymentPolicies, returnPolicies, locations, aspects, categories };
    },
  };
}
