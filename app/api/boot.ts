import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { sql } from "drizzle-orm";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import { createIntegrationRoutes } from "./integrations/routes";
import { createEbayComplianceRoutes } from "./integrations/ebay-compliance";
import { createFilesRoute } from "./files-route";
import { getDb } from "./queries/connection";

const app = new Hono<{ Bindings: HttpBindings }>();

app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));
app.get("/api/health", async c => {
  try {
    await getDb().execute(sql`SELECT 1`);
    return c.json({ ok: true, service: "australian-ecommerce-workbench" });
  } catch {
    return c.json(
      { ok: false, service: "australian-ecommerce-workbench" },
      503
    );
  }
});
app.route("/api/integrations", createIntegrationRoutes());
app.route("/api/integrations", createEbayComplianceRoutes());
app.route("/api/files", createFilesRoute());
app.use("/api/trpc/*", async c => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});
app.all("/api/*", c => c.json({ error: "Not Found" }, 404));

export default app;

if (env.isProduction) {
  const { bootstrapAdminFromEnv } = await import("./auth/bootstrap");
  await bootstrapAdminFromEnv();

  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  const port = parseInt(process.env.PORT || "3000");
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}
