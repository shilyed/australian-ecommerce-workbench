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
app.get("/privacy", c =>
  c.html(`<!doctype html>
<html lang="en-AU">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Privacy Policy - Australian Ecommerce Workbench</title>
  <style>
    body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;max-width:760px;margin:48px auto;padding:0 24px;line-height:1.65;color:#17202a}
    h1,h2{line-height:1.25} h1{margin-bottom:8px} .muted{color:#5b6573}
    code{background:#f2f4f7;padding:2px 5px;border-radius:4px}
  </style>
</head>
<body>
  <h1>Privacy Policy</h1>
  <p class="muted">Australian Ecommerce Workbench · Effective 21 October 2026</p>
  <p>This self-hosted workbench helps the store owner review and manage their own eBay store, listings, orders and fulfilment information.</p>
  <h2>Information processed</h2>
  <p>When the store owner authorises eBay access, the workbench receives an OAuth access token and refresh token, the eBay account ID and username, shop profile details, and store metrics such as listing and order counts. eBay passwords are entered directly on eBay and are never received or stored by this workbench.</p>
  <h2>How information is used</h2>
  <p>Information is used only to operate the store owner's authorised eBay integration, display store summaries and support the owner's fulfilment workflow. It is not sold and is not used for advertising.</p>
  <h2>Storage and security</h2>
  <p>OAuth credentials are encrypted before being stored in the service database. Access is restricted to authorised workbench administrators. The service is operated on a private server controlled by the store owner.</p>
  <h2>Retention and deletion</h2>
  <p>Data is retained while the eBay integration remains connected, or as required for accounting and legal obligations. The owner can disconnect the integration at any time, which deletes the stored OAuth credentials. eBay marketplace account deletion notifications are processed through a dedicated endpoint that removes eBay account data and anonymises related buyer fields.</p>
  <h2>Contact</h2>
  <p>Privacy questions or deletion requests: <a href="mailto:sorencai2003@outlook.com">sorencai2003@outlook.com</a>.</p>
</body>
</html>`)
);
app.get("/terms", c =>
  c.html(`<!doctype html>
<html lang="en-AU">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Terms of Service - Australian Ecommerce Workbench</title>
  <style>body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;max-width:760px;margin:48px auto;padding:0 24px;line-height:1.65;color:#17202a}h1,h2{line-height:1.25}.muted{color:#5b6573}</style>
</head>
<body>
  <h1>Terms of Service</h1>
  <p class="muted">Australian Ecommerce Workbench · Effective 21 October 2026</p>
  <p>This workbench is a private operational tool for the store owner. By authorising an eBay connection, the owner permits the workbench to read the eBay data covered by the requested OAuth scopes.</p>
  <h2>Authorised use</h2>
  <p>The tool may be used only by the store owner and authorised staff for legitimate store operations. eBay access must comply with eBay's user agreement, API licence and applicable marketplace rules.</p>
  <h2>Availability</h2>
  <p>The service is provided as-is for private operational use. The owner is responsible for maintaining the server, credentials and backups, and for verifying order, tax and fulfilment information before relying on it.</p>
  <h2>Termination</h2>
  <p>The eBay integration can be disconnected from the workbench Settings page at any time. Disconnecting removes stored OAuth credentials.</p>
  <h2>Contact</h2>
  <p><a href="mailto:sorencai2003@outlook.com">sorencai2003@outlook.com</a></p>
</body>
</html>`)
);
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
