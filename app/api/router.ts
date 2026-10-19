import { authRouter } from "./auth-router";
import { integrationsRouter } from "./integrations/router";
import { createRouter, publicQuery } from "./middleware";
import { storageRouter } from "./storage-router";
import { workbenchRouter } from "./modules/workbench/router";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  integrations: integrationsRouter,
  workbench: workbenchRouter,
  storage: storageRouter,
});

export type AppRouter = typeof appRouter;
