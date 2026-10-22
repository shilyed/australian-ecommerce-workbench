import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { User } from "@db/schema";
import { authedQuery, createRouter } from "../middleware";
import { requireArea, roleOf } from "../modules/workbench/permissions";
import { ebayDraftSchema } from "./ebay/schema";
import {
  ensureEbayListing,
  getListing,
  getOptions,
  listForSku,
  publishListing,
  pushListing,
  saveDraft,
  unpublishListing,
} from "./service";

const idSchema = z.number().int().positive();

type Actor = Pick<User, "role" | "businessRole" | "status">;

/** 编辑草稿：管理员和运营。 */
function requireDraftEditor(user: Actor) {
  requireArea(user, "sourcing", true);
  const role = roleOf(user);
  if (role !== "admin" && role !== "operations") {
    throw new TRPCError({ code: "FORBIDDEN", message: "只有管理员或运营可以编辑市场详情" });
  }
}

/** 写入平台（更新 / 发布 / 下架）：仅管理员。 */
function requirePlatformWriter(user: Actor) {
  if (user.status !== "active" || roleOf(user) !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "只有管理员可以更新、发布或下架平台刊登" });
  }
}

export const marketplaceRouter = createRouter({
  list: authedQuery.input(z.object({ skuId: idSchema })).query(async ({ ctx, input }) => {
    requireArea(ctx.user, "inventory");
    return listForSku(input.skuId);
  }),

  get: authedQuery.input(z.object({ listingId: idSchema })).query(async ({ ctx, input }) => {
    requireArea(ctx.user, "inventory");
    return getListing(input.listingId);
  }),

  createEbay: authedQuery
    .input(z.object({ skuId: idSchema, storeConnectionId: idSchema }))
    .mutation(async ({ ctx, input }) => {
      requireDraftEditor(ctx.user);
      return ensureEbayListing({ ...input, actorId: ctx.user.id });
    }),

  saveDraft: authedQuery
    .input(z.object({ listingId: idSchema, payload: ebayDraftSchema }))
    .mutation(async ({ ctx, input }) => {
      requireDraftEditor(ctx.user);
      return saveDraft({ ...input, actorId: ctx.user.id });
    }),

  getOptions: authedQuery
    .input(
      z.object({
        storeConnectionId: idSchema,
        categoryId: z.string().max(32).optional(),
        categoryQuery: z.string().max(120).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      requireDraftEditor(ctx.user);
      return getOptions(input);
    }),

  push: authedQuery.input(z.object({ listingId: idSchema })).mutation(async ({ ctx, input }) => {
    requirePlatformWriter(ctx.user);
    return pushListing({ ...input, actorId: ctx.user.id });
  }),

  publish: authedQuery
    .input(z.object({ listingId: idSchema, confirm: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      requirePlatformWriter(ctx.user);
      return publishListing({ listingId: input.listingId, actorId: ctx.user.id });
    }),

  unpublish: authedQuery
    .input(
      z.object({
        listingId: idSchema,
        confirm: z.literal(true),
        reason: z.string().trim().min(2, "请填写下架原因").max(500),
      })
    )
    .mutation(async ({ ctx, input }) => {
      requirePlatformWriter(ctx.user);
      return unpublishListing({ listingId: input.listingId, reason: input.reason, actorId: ctx.user.id });
    }),
});
