import { authRouter } from "./auth-router";
import { createRouter, publicQuery } from "./middleware";
import { storageRouter } from "./storage-router";
import { workbenchRouter } from "./workbenchRouter";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  workbench: workbenchRouter,
  storage: storageRouter,
});

export type AppRouter = typeof appRouter;
