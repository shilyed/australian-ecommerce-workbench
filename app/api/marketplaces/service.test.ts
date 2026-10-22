import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { createPool, type ResultSetHeader } from "mysql2/promise";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { marketplaceListings, storeConnections, type MarketplaceListing } from "@db/schema";
import { cleanDraft, type EbayListingPayload } from "./ebay/schema";
import { payloadHash } from "./ebay/payload";
import { getOptions, publishListing } from "./service";
import { EBAY_WRITE_SCOPE } from "./state";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  publish: vi.fn(),
  fetchOptions: vi.fn(),
  audit: vi.fn(),
  getStoreCredentials: vi.fn(),
  getValidAccessToken: vi.fn(),
}));

vi.mock("../queries/connection", () => ({
  getDb: () => ({ select: mocks.select, update: mocks.update, insert: mocks.insert }),
}));
vi.mock("../modules/workbench/operations", () => ({ audit: mocks.audit }));
vi.mock("../integrations/store-service", () => ({
  getStoreCredentials: mocks.getStoreCredentials,
  getValidAccessToken: mocks.getValidAccessToken,
}));
vi.mock("./ebay/adapter", () => ({
  createEbayAdapter: () => ({ publish: mocks.publish, fetchOptions: mocks.fetchOptions }),
}));

function resultHeader(affectedRows: number): ResultSetHeader {
  return {
    constructor: { name: "ResultSetHeader" },
    fieldCount: 0,
    affectedRows,
    insertId: 0,
    info: "",
    serverStatus: 2,
    warningStatus: 0,
    changedRows: 0,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("Drizzle mysql2 update results", () => {
  it.each([0, 1])("returns affectedRows=%i in the first tuple entry", async affectedRows => {
    const client = createPool({ host: "127.0.0.1", user: "test" });
    const header = resultHeader(affectedRows);
    const query = vi.spyOn(client, "query").mockResolvedValue([header, []]);
    try {
      const db = drizzle(client, { mode: "planetscale" });
      const [lock] = await db
        .update(marketplaceListings)
        .set({ status: "publishing", lastError: null })
        .where(and(eq(marketplaceListings.id, 7), eq(marketplaceListings.status, "ready")));

      expect(lock).toBe(header);
      expect(lock.affectedRows).toBe(affectedRows);
      expect(query).toHaveBeenCalledWith(
        expect.objectContaining({
          sql: expect.stringContaining(
            "where (`marketplace_listings`.`id` = ? and `marketplace_listings`.`status` = ?)"
          ),
        }),
        ["publishing", null, expect.any(String), 7, "ready"]
      );
    } finally {
      await client.end();
    }
  });
});

describe("marketplace options authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.select.mockReturnValue({
      from: () => ({ where: () => ({ limit: async () => [{ id: 1, platform: "ebay" }] }) }),
    });
    mocks.getValidAccessToken.mockResolvedValue({ accessToken: "test-access-token" });
    const empty = () => ({ items: [], error: null });
    mocks.fetchOptions.mockResolvedValue({
      fulfillmentPolicies: empty(),
      paymentPolicies: empty(),
      returnPolicies: empty(),
      locations: empty(),
      aspects: empty(),
      categories: empty(),
    });
  });

  it("does not ask the seller for a nonexistent Taxonomy scope", async () => {
    mocks.getStoreCredentials.mockResolvedValue({ credentials: { scopes: EBAY_WRITE_SCOPE } });
    const result = await getOptions({ storeConnectionId: 1 });
    expect(result.missingScopes).toEqual([]);
  });

  it("still reports missing seller inventory write permission", async () => {
    mocks.getStoreCredentials.mockResolvedValue({ credentials: { scopes: `${EBAY_WRITE_SCOPE}.readonly` } });
    const result = await getOptions({ storeConnectionId: 1 });
    expect(result.missingScopes).toEqual([EBAY_WRITE_SCOPE]);
  });
});

describe("publishListing locking", () => {
  const payload: EbayListingPayload = {
    ebaySku: "TEST-4",
    title: "Insulated Tumbler",
    description: "Stainless steel tumbler.",
    categoryId: "20625",
    condition: "NEW",
    priceAud: 29.9,
    quantity: 3,
    imageUrls: ["https://example.com/tumbler.jpg"],
    aspects: { Brand: ["Unbranded"] },
    packageWeightG: 420,
    packageLengthCm: 12,
    packageWidthCm: 12,
    packageHeightCm: 22,
    fulfillmentPolicyId: "f1",
    paymentPolicyId: "p1",
    returnPolicyId: "r1",
    merchantLocationKey: "warehouse",
  };
  let listing: MarketplaceListing;
  let lockAffectedRows: number;
  let patches: Array<Partial<MarketplaceListing>>;

  beforeEach(() => {
    vi.clearAllMocks();
    listing = {
      id: 7,
      skuId: 4,
      platform: "ebay",
      storeConnectionId: 1,
      status: "ready",
      platformSku: payload.ebaySku,
      externalOfferId: "offer-1",
      externalListingId: null,
      listingUrl: null,
      localPayload: payload,
      lastPushedPayload: payload,
      lastPushedHash: payloadHash(cleanDraft(payload)),
      lastError: null,
      lastPushedAt: new Date(),
      publishedAt: null,
      createdBy: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    lockAffectedRows = 1;
    patches = [];
    mocks.getStoreCredentials.mockResolvedValue({ credentials: { scopes: EBAY_WRITE_SCOPE } });
    mocks.getValidAccessToken.mockResolvedValue({ accessToken: "test-access-token" });
    mocks.publish.mockResolvedValue({ listingId: "1234567890", warnings: [] });
    mocks.audit.mockResolvedValue(undefined);
    mocks.select.mockImplementation(() => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () => {
            if (table === marketplaceListings) return [{ ...listing }];
            if (table === storeConnections)
              return [{ id: 1, platform: "ebay", externalShopId: "shop-1" }];
            throw new Error("Unexpected table");
          },
        }),
      }),
    }));
    mocks.update.mockImplementation(() => ({
      set: (patch: Partial<MarketplaceListing>) => ({
        where: async () => {
          patches.push(patch);
          if (patch.status === "publishing") {
            const affectedRows = listing.status === "ready" ? lockAffectedRows : 0;
            if (affectedRows > 0) Object.assign(listing, patch);
            return [resultHeader(affectedRows), []];
          }
          Object.assign(listing, patch);
          return [resultHeader(1), []];
        },
      }),
    }));
    mocks.insert.mockReturnValue({
      values: () => ({ onDuplicateKeyUpdate: async () => undefined }),
    });
  });

  it("publishes when the mysql2 result header reports one affected row", async () => {
    const result = await publishListing({ listingId: 7, actorId: 1 });
    expect(result.status).toBe("published");
    expect(result.externalListingId).toBe("1234567890");
    expect(mocks.publish).toHaveBeenCalledExactlyOnceWith("offer-1");
    expect(patches[0]).toEqual({ status: "publishing", lastError: null });
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.anything(),
      1,
      "marketplace.publish",
      "marketplace_listing",
      7,
      { status: "ready" },
      { status: "published", listingId: "1234567890", warnings: [] }
    );
  });

  it("rejects a lost lock without calling eBay or marking the listing failed", async () => {
    lockAffectedRows = 0;
    await expect(publishListing({ listingId: 7, actorId: 1 })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(listing.status).toBe("ready");
    expect(patches).toHaveLength(1);
  });

  it("only calls eBay once when two callers read the same ready listing", async () => {
    const results = await Promise.allSettled([
      publishListing({ listingId: 7, actorId: 1 }),
      publishListing({ listingId: 7, actorId: 2 }),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(result => result.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason).toMatchObject({ code: "CONFLICT" });
    expect(mocks.publish).toHaveBeenCalledTimes(1);
    expect(listing.status).toBe("published");
  });

  it("does not acquire a lock or call eBay when saved changes have not been pushed", async () => {
    listing.localPayload = { ...payload, priceAud: 31 };
    await expect(publishListing({ listingId: 7, actorId: 1 })).rejects.toThrow(/未推送/);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("records the error and releases publishing state when eBay rejects publication", async () => {
    mocks.publish.mockRejectedValueOnce(new Error("eBay rejected the category"));
    await expect(publishListing({ listingId: 7, actorId: 1 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "eBay rejected the category",
    });
    expect(listing.status).toBe("failed");
    expect(listing.lastError).toBe("eBay rejected the category");
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.anything(),
      1,
      "marketplace.publish",
      "marketplace_listing",
      7,
      { status: "ready" },
      { status: "failed", error: "eBay rejected the category" }
    );
  });
});
