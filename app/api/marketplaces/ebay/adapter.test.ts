import { describe, expect, it } from "vitest";
import { createEbayAdapter } from "./adapter";
import { draftFromSku, parseDimensions, payloadHash, toInventoryItem, toOffer } from "./payload";
import { cleanDraft, type EbayListingPayload, validateEbayListing } from "./schema";
import {
  assertPublishable,
  assertPushable,
  assertUnpublishable,
  EBAY_WRITE_SCOPE,
  hasScope,
  hasUnpushedChanges,
  statusAfterPush,
} from "../state";

const validPayload: EbayListingPayload = {
  ebaySku: "CUP-001",
  title: "Insulated Stainless Steel Tumbler 600ml",
  description: "<p>Double-wall vacuum insulated tumbler.</p>",
  categoryId: "20625",
  condition: "NEW",
  priceAud: 29.95,
  quantity: 10,
  imageUrls: ["https://example.com/a.jpg"],
  aspects: { Brand: ["Unbranded"], Material: ["Stainless Steel"] },
  packageWeightG: 420,
  packageLengthCm: 12,
  packageWidthCm: 12,
  packageHeightCm: 22,
  fulfillmentPolicyId: "f1",
  paymentPolicyId: "p1",
  returnPolicyId: "r1",
  merchantLocationKey: "SH-WAREHOUSE",
};

type Call = { url: string; method: string; body: unknown; headers: Record<string, string> };

function fakeFetch(responses: Array<{ status: number; body?: unknown }>) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: String(init.method),
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      headers: init.headers as Record<string, string>,
    });
    const next = responses.shift() ?? { status: 204 };
    return new Response(next.body === undefined ? null : JSON.stringify(next.body), {
      status: next.status,
    });
  };
  return { calls, fetchImpl };
}

function adapterWith(responses: Array<{ status: number; body?: unknown }>) {
  const fake = fakeFetch(responses);
  const adapter = createEbayAdapter({
    accessToken: "token",
    marketplaceId: "EBAY_AU",
    baseUrl: "https://api.ebay.com",
    fetchImpl: fake.fetchImpl,
  });
  return { adapter, calls: fake.calls };
}

const listingState = (overrides: Partial<Parameters<typeof assertPublishable>[0]> = {}) => ({
  status: "ready" as const,
  externalOfferId: "offer-1",
  externalListingId: null,
  updatedAt: new Date(),
  ...overrides,
});

describe("eBay payload mapping", () => {
  it("maps the listing into inventory_item and offer bodies", () => {
    const item = toInventoryItem(validPayload);
    expect(item.availability.shipToLocationAvailability.quantity).toBe(10);
    expect(item.product.aspects.Material).toEqual(["Stainless Steel"]);
    expect(item.packageWeightAndSize.weight).toEqual({ value: 420, unit: "GRAM" });
    expect(item.packageWeightAndSize.dimensions.unit).toBe("CENTIMETER");

    const offer = toOffer(validPayload, "EBAY_AU");
    expect(offer).toMatchObject({
      sku: "CUP-001",
      marketplaceId: "EBAY_AU",
      format: "FIXED_PRICE",
      categoryId: "20625",
      merchantLocationKey: "SH-WAREHOUSE",
      pricingSummary: { price: { value: "29.95", currency: "AUD" } },
      listingPolicies: { fulfillmentPolicyId: "f1", paymentPolicyId: "p1", returnPolicyId: "r1" },
    });
  });

  it("prefills the draft from the master product", () => {
    const draft = draftFromSku({
      code: "CUP 001/A",
      name: "保温杯",
      productName: "不锈钢保温杯",
      spec: "600ml",
      declarationNameEn: "Stainless Steel Vacuum Tumbler 600ml",
      material: "304 Stainless Steel",
      originCountry: "CN",
      weight: "0.42",
      weightUnit: "kg",
      dimensions: "12×12×22 cm",
    });
    expect(draft.ebaySku).toBe("CUP-001-A");
    expect(draft.title).toBe("Stainless Steel Vacuum Tumbler 600ml");
    expect(draft.packageWeightG).toBe(420);
    expect([draft.packageLengthCm, draft.packageWidthCm, draft.packageHeightCm]).toEqual([12, 12, 22]);
    expect(draft.aspects?.Material).toEqual(["304 Stainless Steel"]);
  });

  it("parses dimension text and rejects malformed values", () => {
    expect(parseDimensions("10x20x30")).toEqual({ length: 10, width: 20, height: 30 });
    expect(parseDimensions("100*200*300 mm")).toEqual({ length: 10, width: 20, height: 30 });
    expect(parseDimensions("about 10cm")).toBeNull();
  });
});

describe("eBay validation", () => {
  it("accepts a complete listing", () => {
    expect(validateEbayListing(validPayload).ok).toBe(true);
  });

  it("rejects long titles, http images and missing policies", () => {
    const result = validateEbayListing({
      ...validPayload,
      title: "x".repeat(81),
      imageUrls: ["http://example.com/a.jpg"],
      returnPolicyId: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const paths = result.issues.map(issue => issue.path);
      expect(paths).toContain("title");
      expect(paths).toContain("imageUrls.0");
      expect(paths).toContain("returnPolicyId");
    }
  });

  it("drops empty aspects and blank image rows before validating", () => {
    const cleaned = cleanDraft({ aspects: { Brand: [" Unbranded "], "": ["x"], Color: [""] }, imageUrls: [" ", "https://a.com/1.jpg"] });
    expect(cleaned.aspects).toEqual({ Brand: ["Unbranded"] });
    expect(cleaned.imageUrls).toEqual(["https://a.com/1.jpg"]);
  });
});

describe("change tracking", () => {
  it("hashes independently of key order", () => {
    expect(payloadHash({ a: 1, b: { c: 2, d: 3 } })).toBe(payloadHash({ b: { d: 3, c: 2 }, a: 1 }));
  });

  it("detects unpushed edits", () => {
    const pushedHash = payloadHash(cleanDraft(validPayload));
    expect(hasUnpushedChanges(validPayload, pushedHash)).toBe(false);
    expect(hasUnpushedChanges({ ...validPayload, priceAud: 31 }, pushedHash)).toBe(true);
    expect(hasUnpushedChanges(validPayload, null)).toBe(true);
  });
});

describe("state transitions", () => {
  it("requires the exact write scope, not the readonly one", () => {
    expect(hasScope(`${EBAY_WRITE_SCOPE}.readonly`, EBAY_WRITE_SCOPE)).toBe(false);
    expect(hasScope(`a ${EBAY_WRITE_SCOPE} b`, EBAY_WRITE_SCOPE)).toBe(true);
  });

  it("keeps published listings published after an update", () => {
    expect(statusAfterPush("published")).toBe("published");
    expect(statusAfterPush("draft")).toBe("ready");
    expect(statusAfterPush("failed")).toBe("ready");
    expect(statusAfterPush("unpublished")).toBe("ready");
  });

  it("blocks duplicate publishing of a live listing", () => {
    expect(() =>
      assertPublishable(listingState({ status: "published", externalListingId: "1234" }), false)
    ).toThrow(/不能重复发布/);
  });

  it("requires ready status, an offer and no unpushed edits to publish", () => {
    expect(() => assertPublishable(listingState({ status: "draft" }), false)).toThrow(/待发布/);
    expect(() => assertPublishable(listingState({ externalOfferId: null }), false)).toThrow(/Offer/);
    expect(() => assertPublishable(listingState(), true)).toThrow(/未推送/);
    expect(() => assertPublishable(listingState(), false)).not.toThrow();
  });

  it("allows recovery from a stale publishing lock only", () => {
    expect(() => assertPushable(listingState({ status: "publishing" }))).toThrow(/发布中/);
    const stale = listingState({ status: "publishing", updatedAt: new Date(Date.now() - 10 * 60_000) });
    expect(() => assertPushable(stale)).not.toThrow();
  });

  it("only unpublishes live listings", () => {
    expect(() => assertUnpublishable(listingState({ status: "ready" }))).toThrow(/在售/);
    expect(() => assertUnpublishable(listingState({ status: "published" }))).not.toThrow();
  });
});

describe("eBay adapter", () => {
  it("creates inventory then a new offer, with AU language headers", async () => {
    const { adapter, calls } = adapterWith([
      { status: 204 },
      { status: 404, body: { errors: [{ errorId: 25713, message: "not found" }] } },
      { status: 201, body: { offerId: "offer-9" } },
    ]);
    const result = await adapter.createOrUpdate(validPayload, null);
    expect(result.offerId).toBe("offer-9");
    expect(calls.map(call => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      "PUT /sell/inventory/v1/inventory_item/CUP-001",
      "GET /sell/inventory/v1/offer",
      "POST /sell/inventory/v1/offer",
    ]);
    expect(calls[0]?.headers["Content-Language"]).toBe("en-AU");
    expect(calls[0]?.headers["X-EBAY-C-MARKETPLACE-ID"]).toBe("EBAY_AU");
  });

  it("updates the existing offer instead of creating a duplicate", async () => {
    const { adapter, calls } = adapterWith([{ status: 204 }, { status: 204 }]);
    const result = await adapter.createOrUpdate(validPayload, "offer-1");
    expect(result.offerId).toBe("offer-1");
    expect(calls[1]?.method).toBe("PUT");
    expect(new URL(calls[1]!.url).pathname).toBe("/sell/inventory/v1/offer/offer-1");
    expect(calls[1]?.body).toMatchObject({ categoryId: "20625" });
  });

  it("reuses an offer found on eBay for the same SKU", async () => {
    const { adapter, calls } = adapterWith([
      { status: 204 },
      { status: 200, body: { offers: [{ offerId: "offer-7", marketplaceId: "EBAY_AU" }] } },
      { status: 204 },
    ]);
    const result = await adapter.createOrUpdate(validPayload, null);
    expect(result.offerId).toBe("offer-7");
    expect(calls[2]?.method).toBe("PUT");
  });

  it("surfaces eBay error messages so they can be stored as lastError", async () => {
    const { adapter } = adapterWith([
      { status: 400, body: { errors: [{ errorId: 25002, longMessage: "Item specific Brand is missing." }] } },
    ]);
    await expect(adapter.publish("offer-1")).rejects.toThrow(/25002.*Brand is missing/);
  });

  it("returns the listing id when publishing", async () => {
    const { adapter } = adapterWith([{ status: 200, body: { listingId: "1234567890" } }]);
    await expect(adapter.publish("offer-1")).resolves.toEqual({ listingId: "1234567890", warnings: [] });
  });

  it("reports per-section option errors without failing the whole request", async () => {
    const { adapter } = adapterWith([
      { status: 200, body: { fulfillmentPolicies: [{ fulfillmentPolicyId: "f1", name: "Free post" }] } },
      { status: 403, body: { errors: [{ errorId: 1100, message: "Access denied" }] } },
      { status: 200, body: { returnPolicies: [] } },
      { status: 200, body: { locations: [] } },
    ]);
    const options = await adapter.fetchOptions({});
    expect(options.fulfillmentPolicies.items).toEqual([{ id: "f1", name: "Free post", description: null }]);
    expect(options.paymentPolicies.error).toMatch(/Access denied/);
    expect(options.aspects.items).toEqual([]);
  });
});
