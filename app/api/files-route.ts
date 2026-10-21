import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { files } from "@db/schema";
import { authenticateRequest } from "./auth/request";
import { readLocalFile } from "./lib/local-storage";
import { getDb } from "./queries/connection";

export function createFilesRoute() {
  const app = new Hono();

  app.get("/", async c => {
    let user;
    try {
      user = await authenticateRequest(c.req.raw.headers);
    } catch {
      return c.json({ error: "请先登录" }, 401);
    }

    const key = c.req.query("key");
    if (!key) return c.json({ error: "缺少文件 key" }, 400);

    const rows = await getDb()
      .select()
      .from(files)
      .where(eq(files.key, key))
      .limit(1);
    const file = rows.at(0);
    if (!file || (file.ownerId !== user.id && user.role !== "admin")) {
      return c.json({ error: "无权访问该附件" }, 403);
    }

    try {
      const content = await readLocalFile(file.key);
      const encodedName = encodeURIComponent(file.name).replace(/'/g, "%27");
      return c.body(new Uint8Array(content), 200, {
        "Content-Type": file.contentType || "application/octet-stream",
        "Content-Length": String(content.byteLength),
        "Content-Disposition": `inline; filename*=UTF-8''${encodedName}`,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      });
    } catch {
      return c.json({ error: "文件不存在" }, 404);
    }
  });

  return app;
}
