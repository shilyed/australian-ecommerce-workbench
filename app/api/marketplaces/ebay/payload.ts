import { createHash } from "node:crypto";
import type { Sku } from "@db/schema";
import type { EbayDraftPayload, EbayListingPayload } from "./schema";

const round = (value: number, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/** eBay inventory_item 请求体（PUT /sell/inventory/v1/inventory_item/{sku}）。 */
export function toInventoryItem(payload: EbayListingPayload) {
  return {
    availability: {
      shipToLocationAvailability: { quantity: payload.quantity },
    },
    condition: payload.condition,
    product: {
      title: payload.title,
      description: payload.description,
      aspects: payload.aspects,
      imageUrls: payload.imageUrls,
    },
    packageWeightAndSize: {
      dimensions: {
        length: round(payload.packageLengthCm),
        width: round(payload.packageWidthCm),
        height: round(payload.packageHeightCm),
        unit: "CENTIMETER",
      },
      weight: { value: round(payload.packageWeightG), unit: "GRAM" },
    },
  };
}

/** eBay offer 请求体（POST /offer 或 PUT /offer/{offerId}）。 */
export function toOffer(payload: EbayListingPayload, marketplaceId: string) {
  return {
    sku: payload.ebaySku,
    marketplaceId,
    format: "FIXED_PRICE",
    availableQuantity: payload.quantity,
    categoryId: payload.categoryId,
    listingDescription: payload.description,
    merchantLocationKey: payload.merchantLocationKey,
    listingPolicies: {
      fulfillmentPolicyId: payload.fulfillmentPolicyId,
      paymentPolicyId: payload.paymentPolicyId,
      returnPolicyId: payload.returnPolicyId,
    },
    pricingSummary: {
      price: { value: payload.priceAud.toFixed(2), currency: "AUD" },
    },
  };
}

/** 稳定序列化：键排序后再哈希，保证同样内容得到同样指纹。 */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function payloadHash(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

/** 解析“长×宽×高 cm”这类尺寸文本，支持 x / X / × / * 分隔。 */
export function parseDimensions(text: string | null | undefined) {
  if (!text) return null;
  const numbers = text
    .replace(/[,，]/g, ".")
    .split(/[x×X*＊]/)
    .map(part => Number.parseFloat(part.replace(/[^\d.]/g, "")));
  if (numbers.length !== 3 || numbers.some(value => !Number.isFinite(value) || value <= 0)) {
    return null;
  }
  const isMm = /mm/i.test(text);
  const [length, width, height] = numbers.map(value => (isMm ? value / 10 : value));
  return { length, width, height };
}

export function weightInGrams(sku: Pick<Sku, "weight" | "weightUnit">): number | null {
  const value = Number(sku.weight ?? NaN);
  if (!Number.isFinite(value) || value <= 0) return null;
  return sku.weightUnit === "kg" ? round(value * 1000, 1) : value;
}

/** 新建 eBay 市场详情时，用主商品资料预填草稿。 */
export function draftFromSku(
  sku: Pick<
    Sku,
    | "code"
    | "name"
    | "productName"
    | "spec"
    | "declarationNameEn"
    | "material"
    | "originCountry"
    | "weight"
    | "weightUnit"
    | "dimensions"
  >
): EbayDraftPayload {
  const title = (sku.declarationNameEn?.trim() || sku.productName || sku.name).slice(0, 80);
  const dimensions = parseDimensions(sku.dimensions);
  const aspects: Record<string, string[]> = { Brand: ["Unbranded"] };
  if (sku.material?.trim()) aspects.Material = [sku.material.trim()];
  if (sku.originCountry?.trim()) aspects["Country/Region of Manufacture"] = [sku.originCountry.trim()];
  return {
    ebaySku: sku.code.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 50),
    title,
    description: "",
    categoryId: "",
    condition: "NEW",
    priceAud: null,
    quantity: null,
    imageUrls: [],
    aspects,
    packageWeightG: weightInGrams(sku),
    packageLengthCm: dimensions?.length ?? null,
    packageWidthCm: dimensions?.width ?? null,
    packageHeightCm: dimensions?.height ?? null,
    fulfillmentPolicyId: "",
    paymentPolicyId: "",
    returnPolicyId: "",
    merchantLocationKey: "",
  };
}
