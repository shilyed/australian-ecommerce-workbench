import { TRPCError } from "@trpc/server";
import type { MarketplaceListing } from "@db/schema";
import { payloadHash } from "./ebay/payload";
import { cleanDraft, ebayDraftSchema } from "./ebay/schema";

export const EBAY_WRITE_SCOPE = "https://api.ebay.com/oauth/api_scope/sell.inventory";

/** 发布中超过这个时间仍未结束，视为进程中断，允许重新推送恢复。 */
export const STALE_PUBLISHING_MS = 5 * 60 * 1000;

type ListingState = Pick<
  MarketplaceListing,
  "status" | "externalOfferId" | "externalListingId" | "updatedAt"
>;

/** 必须精确包含写权限；sell.inventory.readonly 不算。 */
export function hasScope(scopes: string | null | undefined, scope: string) {
  return (scopes ?? "").split(/\s+/).filter(Boolean).includes(scope);
}

export function normalizedDraft(localPayload: unknown) {
  const parsed = ebayDraftSchema.safeParse(localPayload ?? {});
  return cleanDraft(parsed.success ? parsed.data : {});
}

export function draftHash(localPayload: unknown) {
  return payloadHash(normalizedDraft(localPayload));
}

export function hasUnpushedChanges(localPayload: unknown, lastPushedHash: string | null) {
  if (!lastPushedHash) return true;
  return draftHash(localPayload) !== lastPushedHash;
}

export function isStalePublishing(listing: ListingState, now = new Date()) {
  return (
    listing.status === "publishing" &&
    now.getTime() - new Date(listing.updatedAt).getTime() > STALE_PUBLISHING_MS
  );
}

export function assertEditable(listing: ListingState, now = new Date()) {
  if (listing.status === "publishing" && !isStalePublishing(listing, now)) {
    throw new TRPCError({ code: "CONFLICT", message: "正在发布中，请等待完成后再修改" });
  }
}

export function assertPushable(listing: ListingState, now = new Date()) {
  if (listing.status === "publishing" && !isStalePublishing(listing, now)) {
    throw new TRPCError({ code: "CONFLICT", message: "正在发布中，请稍后再更新到平台" });
  }
}

/** 推送后：已在售的刊登保持在售（eBay 会直接更新线上内容），其余进入待发布。 */
export function statusAfterPush(status: MarketplaceListing["status"]): MarketplaceListing["status"] {
  return status === "published" ? "published" : "ready";
}

export function assertPublishable(listing: ListingState, unpushedChanges: boolean) {
  if (listing.status === "published" && listing.externalListingId) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `该商品已在 eBay 在售（Listing ${listing.externalListingId}），不能重复发布`,
    });
  }
  if (listing.status !== "ready") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "只有“待发布”状态才能发布；请先点击“更新到 eBay”",
    });
  }
  if (!listing.externalOfferId) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "缺少 eBay Offer，请先更新到 eBay" });
  }
  if (unpushedChanges) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "本地详情有未推送的修改，请先“更新到 eBay”再发布，确保线上内容与核对内容一致",
    });
  }
}

export function assertUnpublishable(listing: ListingState) {
  if (listing.status !== "published" || !listing.externalOfferId) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "只有在售的刊登才能下架" });
  }
}
