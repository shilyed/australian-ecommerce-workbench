import { z } from "zod";
import { adminQuery, authedQuery, createRouter } from "../middleware";
import { describeProvider, inferOrigin } from "./providers";
import { disconnectStore, refreshStoreProfile } from "./store-service";

const storeIdSchema = z.coerce.number().int().positive();

/**
 * 回调地址完全由服务端按 APP_ORIGIN/请求头推导，前端传值仅作为兜底展示。
 */
export const integrationsRouter = createRouter({
  providers: authedQuery
    .input(z.object({ origin: z.string().url().optional() }).optional())
    .query(({ ctx, input }) => {
      const origin = inferOrigin(ctx.req) || input?.origin || "http://localhost:3000";
      return {
        providers: [describeProvider("etsy", origin), describeProvider("ebay", origin)],
      };
    }),

  refreshProfile: adminQuery
    .input(z.object({ storeConnectionId: storeIdSchema }))
    .mutation(async ({ input }) => refreshStoreProfile(input.storeConnectionId)),

  disconnect: adminQuery
    .input(z.object({ storeConnectionId: storeIdSchema }))
    .mutation(async ({ ctx, input }) => {
      await disconnectStore(input.storeConnectionId, ctx.user.id);
      return { success: true };
    }),
});
