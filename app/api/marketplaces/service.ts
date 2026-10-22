import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import {
  channelListings,
  marketplaceListings,
  type MarketplaceListing,
  skus,
  storeConnections,
} from "@db/schema";
import { integrationEnv } from "../lib/env";
import { getDb } from "../queries/connection";
import { audit } from "../modules/workbench/operations";
import { getStoreCredentials, getValidAccessToken } from "../integrations/store-service";
import { getEbayApplicationAccessToken } from "../integrations/providers";
import { IntegrationError } from "../integrations/types";
import { createEbayAdapter } from "./ebay/adapter";
import { draftFromSku, payloadHash } from "./ebay/payload";
import type { EbayDraftPayload } from "./ebay/schema";
import {
  assertEditable,
  assertPublishable,
  assertPushable,
  assertUnpublishable,
  EBAY_WRITE_SCOPE,
  hasScope,
  hasUnpushedChanges,
  normalizedDraft,
  statusAfterPush,
} from "./state";

const EBAY_HOSTS: Record<string, string> = {
  EBAY_AU: "www.ebay.com.au",
  EBAY_US: "www.ebay.com",
  EBAY_GB: "www.ebay.co.uk",
  EBAY_CA: "www.ebay.ca",
  EBAY_DE: "www.ebay.de",
};

function ebayBaseUrl() {
  return integrationEnv.ebay.environment === "sandbox"
    ? "https://api.sandbox.ebay.com"
    : "https://api.ebay.com";
}

export function ebayListingUrl(listingId: string) {
  if (integrationEnv.ebay.environment === "sandbox") {
    return `https://www.sandbox.ebay.com/itm/${listingId}`;
  }
  const host = EBAY_HOSTS[integrationEnv.ebay.marketplaceId] ?? "www.ebay.com";
  return `https://${host}/itm/${listingId}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}

function platformError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  throw new TRPCError({
    code: error instanceof IntegrationError && error.status === 401 ? "UNAUTHORIZED" : "BAD_REQUEST",
    message: errorMessage(error),
  });
}

/** 返回给前端的视图：不包含任何凭证，并附带“是否有未推送修改”。 */
export function presentListing(listing: MarketplaceListing) {
  return {
    ...listing,
    localPayload: normalizedDraft(listing.localPayload),
    hasUnpushedChanges: hasUnpushedChanges(listing.localPayload, listing.lastPushedHash),
  };
}

export type ListingView = ReturnType<typeof presentListing>;

async function loadSku(skuId: number) {
  const db = getDb();
  const [sku] = await db.select().from(skus).where(eq(skus.id, skuId)).limit(1);
  if (!sku) throw new TRPCError({ code: "NOT_FOUND", message: "主商品不存在" });
  return sku;
}

async function loadListing(listingId: number) {
  const db = getDb();
  const [listing] = await db
    .select()
    .from(marketplaceListings)
    .where(eq(marketplaceListings.id, listingId))
    .limit(1);
  if (!listing) throw new TRPCError({ code: "NOT_FOUND", message: "市场详情不存在" });
  return listing;
}

async function loadEbayStore(storeConnectionId: number) {
  const db = getDb();
  const [store] = await db
    .select()
    .from(storeConnections)
    .where(eq(storeConnections.id, storeConnectionId))
    .limit(1);
  if (!store) throw new TRPCError({ code: "NOT_FOUND", message: "店铺不存在" });
  if (store.platform !== "ebay") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "该店铺不是 eBay 店铺" });
  }
  return store;
}

async function requireScopes(storeConnectionId: number, scopes: string[]) {
  const { credentials } = await getStoreCredentials(storeConnectionId);
  if (!credentials) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "该 eBay 店铺尚未授权，请到“设置 → 店铺连接”重新授权",
    });
  }
  const missing = scopes.filter(scope => !hasScope(credentials.scopes, scope));
  if (missing.length > 0) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "当前 eBay 授权缺少刊登写入权限（sell.inventory）。请到“设置 → 店铺连接”点击重新授权 eBay 后再试。",
    });
  }
}

async function ebayAdapterFor(storeConnectionId: number) {
  const { accessToken } = await getValidAccessToken(storeConnectionId);
  return createEbayAdapter({
    accessToken,
    getApplicationAccessToken: getEbayApplicationAccessToken,
    marketplaceId: integrationEnv.ebay.marketplaceId,
    baseUrl: ebayBaseUrl(),
  });
}

export async function listForSku(skuId: number) {
  const db = getDb();
  const sku = await loadSku(skuId);
  const rows = await db
    .select()
    .from(marketplaceListings)
    .where(eq(marketplaceListings.skuId, skuId));
  const stores = await db
    .select({
      id: storeConnections.id,
      platform: storeConnections.platform,
      shopName: storeConnections.shopName,
      authorizationStatus: storeConnections.authorizationStatus,
    })
    .from(storeConnections);
  const legacyListings = await db
    .select()
    .from(channelListings)
    .where(eq(channelListings.skuId, skuId));
  return {
    sku,
    listings: rows.map(presentListing),
    stores,
    legacyListings,
    marketplaceId: integrationEnv.ebay.marketplaceId,
  };
}

export async function getListing(listingId: number) {
  const listing = await loadListing(listingId);
  const sku = await loadSku(listing.skuId);
  const db = getDb();
  const [store] = await db
    .select({
      id: storeConnections.id,
      platform: storeConnections.platform,
      shopName: storeConnections.shopName,
      authorizationStatus: storeConnections.authorizationStatus,
    })
    .from(storeConnections)
    .where(eq(storeConnections.id, listing.storeConnectionId))
    .limit(1);
  const { credentials } = await getStoreCredentials(listing.storeConnectionId).catch(() => ({
    credentials: undefined,
  }));
  return {
    listing: presentListing(listing),
    sku,
    store: store ?? null,
    canWriteToPlatform: hasScope(credentials?.scopes, EBAY_WRITE_SCOPE),
    marketplaceId: integrationEnv.ebay.marketplaceId,
  };
}

/** 创建（或取回已有的）eBay 市场详情，用主商品资料预填草稿。 */
export async function ensureEbayListing(input: {
  skuId: number;
  storeConnectionId: number;
  actorId: number;
}) {
  const db = getDb();
  const sku = await loadSku(input.skuId);
  await loadEbayStore(input.storeConnectionId);
  const [existing] = await db
    .select()
    .from(marketplaceListings)
    .where(
      and(
        eq(marketplaceListings.skuId, input.skuId),
        eq(marketplaceListings.platform, "ebay"),
        eq(marketplaceListings.storeConnectionId, input.storeConnectionId)
      )
    )
    .limit(1);
  if (existing) return presentListing(existing);

  const draft = draftFromSku(sku);
  await db.insert(marketplaceListings).values({
    skuId: input.skuId,
    platform: "ebay",
    storeConnectionId: input.storeConnectionId,
    status: "draft",
    platformSku: draft.ebaySku ?? sku.code,
    localPayload: draft as Record<string, unknown>,
    createdBy: input.actorId,
  });
  const [created] = await db
    .select()
    .from(marketplaceListings)
    .where(
      and(
        eq(marketplaceListings.skuId, input.skuId),
        eq(marketplaceListings.platform, "ebay"),
        eq(marketplaceListings.storeConnectionId, input.storeConnectionId)
      )
    )
    .limit(1);
  if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "市场详情创建失败" });
  await audit(db, input.actorId, "marketplace.draft.create", "marketplace_listing", created.id, null, {
    skuId: input.skuId,
    platform: "ebay",
    storeConnectionId: input.storeConnectionId,
  });
  return presentListing(created);
}

/** 只写本地数据库，不调用平台。 */
export async function saveDraft(input: {
  listingId: number;
  payload: EbayDraftPayload;
  actorId: number;
}) {
  const db = getDb();
  const before = await loadListing(input.listingId);
  assertEditable(before);
  const draft = normalizedDraft(input.payload);
  await db
    .update(marketplaceListings)
    .set({
      localPayload: draft as Record<string, unknown>,
      platformSku: draft.ebaySku?.trim() || before.platformSku,
    })
    .where(eq(marketplaceListings.id, input.listingId));
  await audit(
    db,
    input.actorId,
    "marketplace.draft.update",
    "marketplace_listing",
    input.listingId,
    { localPayload: before.localPayload },
    { localPayload: draft }
  );
  return presentListing(await loadListing(input.listingId));
}

export async function getOptions(input: {
  storeConnectionId: number;
  categoryId?: string;
  categoryQuery?: string;
}) {
  await loadEbayStore(input.storeConnectionId);
  try {
    const { credentials } = await getStoreCredentials(input.storeConnectionId);
    const adapter = await ebayAdapterFor(input.storeConnectionId);
    const options = await adapter.fetchOptions(input);
    const missingScopes = [EBAY_WRITE_SCOPE].filter(
      scope => !hasScope(credentials?.scopes, scope)
    );
    return { ...options, missingScopes };
  } catch (error) {
    platformError(error);
  }
}

/** 校验 → 写入 eBay Inventory Item → 创建或更新 Offer。不会发布。 */
export async function pushListing(input: { listingId: number; actorId: number }) {
  const db = getDb();
  const listing = await loadListing(input.listingId);
  if (listing.platform !== "ebay") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "该市场尚未接入" });
  }
  assertPushable(listing);
  const adapter = await ebayAdapterFor(listing.storeConnectionId).catch(platformError);
  const draft = normalizedDraft(listing.localPayload);
  const validation = adapter.validate(draft);
  if (!validation.ok) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `请先补全以下内容：${validation.issues.map(issue => issue.message).join("；")}`,
    });
  }
  await requireScopes(listing.storeConnectionId, [EBAY_WRITE_SCOPE]);

  try {
    const result = await adapter.createOrUpdate(validation.data, listing.externalOfferId);
    const now = new Date();
    const nextStatus = statusAfterPush(listing.status);
    await db
      .update(marketplaceListings)
      .set({
        status: nextStatus,
        externalOfferId: result.offerId,
        platformSku: validation.data.ebaySku,
        lastPushedPayload: validation.data as Record<string, unknown>,
        lastPushedHash: payloadHash(draft),
        lastPushedAt: now,
        lastError: null,
      })
      .where(eq(marketplaceListings.id, listing.id));
    await audit(
      db,
      input.actorId,
      "marketplace.push",
      "marketplace_listing",
      listing.id,
      { status: listing.status, externalOfferId: listing.externalOfferId },
      { status: nextStatus, externalOfferId: result.offerId, ebaySku: validation.data.ebaySku }
    );
    return presentListing(await loadListing(listing.id));
  } catch (error) {
    await db
      .update(marketplaceListings)
      .set({ lastError: errorMessage(error) })
      .where(eq(marketplaceListings.id, listing.id));
    platformError(error);
  }
}

export async function publishListing(input: { listingId: number; actorId: number }) {
  const db = getDb();
  const listing = await loadListing(input.listingId);
  assertPublishable(listing, hasUnpushedChanges(listing.localPayload, listing.lastPushedHash));
  await requireScopes(listing.storeConnectionId, [EBAY_WRITE_SCOPE]);
  const store = await loadEbayStore(listing.storeConnectionId);
  const adapter = await ebayAdapterFor(listing.storeConnectionId).catch(platformError);

  // 先占位，防止并发重复发布：只有仍是 ready 的记录才能进入 publishing。
  // drizzle mysql2 的 update 返回 [ResultSetHeader, FieldPacket[]]。
  const [lock] = await db
    .update(marketplaceListings)
    .set({ status: "publishing", lastError: null })
    .where(and(eq(marketplaceListings.id, listing.id), eq(marketplaceListings.status, "ready")));
  if (!lock || lock.affectedRows === 0) {
    throw new TRPCError({ code: "CONFLICT", message: "该刊登状态已变化，请刷新后重试" });
  }

  try {
    const result = await adapter.publish(listing.externalOfferId!);
    const now = new Date();
    const url = ebayListingUrl(result.listingId);
    const payload = (listing.lastPushedPayload ?? {}) as {
      title?: string;
      priceAud?: number;
      ebaySku?: string;
    };
    await db
      .update(marketplaceListings)
      .set({
        status: "published",
        externalListingId: result.listingId,
        listingUrl: url,
        publishedAt: now,
        lastError: result.warnings.length > 0 ? `eBay 提示：${result.warnings.join("；")}` : null,
      })
      .where(eq(marketplaceListings.id, listing.id));

    const snapshot = {
      title: (payload.title ?? "").slice(0, 512) || `SKU ${listing.skuId}`,
      url,
      price: (payload.priceAud ?? 0).toFixed(2),
      platformSku: payload.ebaySku ?? listing.platformSku,
      skuId: listing.skuId,
      platformStatus: "PUBLISHED",
      lastSyncAt: now,
      rawSnapshot: { source: "workbench.marketplace", offerId: listing.externalOfferId, listingId: result.listingId },
    };
    await db
      .insert(channelListings)
      .values({
        platform: "ebay",
        externalShopId: store.externalShopId,
        externalListingId: result.listingId,
        externalVariantId: payload.ebaySku ?? listing.platformSku ?? String(listing.skuId),
        currency: "AUD",
        ...snapshot,
      })
      .onDuplicateKeyUpdate({ set: snapshot });

    await audit(
      db,
      input.actorId,
      "marketplace.publish",
      "marketplace_listing",
      listing.id,
      { status: "ready" },
      { status: "published", listingId: result.listingId, warnings: result.warnings }
    );
    return presentListing(await loadListing(listing.id));
  } catch (error) {
    await db
      .update(marketplaceListings)
      .set({ status: "failed", lastError: errorMessage(error) })
      .where(eq(marketplaceListings.id, listing.id));
    await audit(
      db,
      input.actorId,
      "marketplace.publish",
      "marketplace_listing",
      listing.id,
      { status: "ready" },
      { status: "failed", error: errorMessage(error) }
    );
    platformError(error);
  }
}

export async function unpublishListing(input: { listingId: number; actorId: number; reason: string }) {
  const db = getDb();
  const listing = await loadListing(input.listingId);
  assertUnpublishable(listing);
  await requireScopes(listing.storeConnectionId, [EBAY_WRITE_SCOPE]);
  const store = await loadEbayStore(listing.storeConnectionId);
  const adapter = await ebayAdapterFor(listing.storeConnectionId).catch(platformError);
  try {
    await adapter.unpublish(listing.externalOfferId!);
  } catch (error) {
    await db
      .update(marketplaceListings)
      .set({ lastError: errorMessage(error) })
      .where(eq(marketplaceListings.id, listing.id));
    platformError(error);
  }
  const now = new Date();
  await db
    .update(marketplaceListings)
    .set({ status: "unpublished", lastError: null })
    .where(eq(marketplaceListings.id, listing.id));
  if (listing.externalListingId) {
    await db
      .update(channelListings)
      .set({ platformStatus: "ENDED", lastSyncAt: now })
      .where(
        and(
          eq(channelListings.platform, "ebay"),
          eq(channelListings.externalShopId, store.externalShopId),
          eq(channelListings.externalListingId, listing.externalListingId)
        )
      );
  }
  await audit(
    db,
    input.actorId,
    "marketplace.unpublish",
    "marketplace_listing",
    listing.id,
    { status: "published", listingId: listing.externalListingId },
    { status: "unpublished" },
    input.reason
  );
  return presentListing(await loadListing(listing.id));
}
