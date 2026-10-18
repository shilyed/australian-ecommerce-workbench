import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { files } from "@db/schema";
import { storage } from "./lib/storage";
import { authedQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";

const MAX_INLINE_FILE_BYTES = 20 * 1024 * 1024;

export const storageRouter = createRouter({
  upload: authedQuery
    .input(
      z.object({
        name: z.string().min(1).max(512),
        contentBase64: z.string().min(1),
        contentType: z.string().max(255).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const bytes = Uint8Array.from(Buffer.from(input.contentBase64, "base64"));
      if (bytes.byteLength > MAX_INLINE_FILE_BYTES) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "单个附件不能超过 20MB" });
      }
      const safePrefix = `workbench/u/${ctx.user.id}/`;
      const saved = await storage.uploadFile({
        fileContent: bytes,
        fileName: `${safePrefix}${input.name}`,
        contentType: input.contentType,
      });
      const db = getDb();
      await db.insert(files).values({
        key: saved.key,
        ownerId: ctx.user.id,
        name: input.name,
        size: saved.size,
        contentType: saved.contentType,
      });
      return { key: saved.key, size: saved.size, etag: saved.etag };
    }),

  url: authedQuery.input(z.object({ key: z.string().min(1) })).query(async ({ ctx, input }) => {
    const db = getDb();
    const rows = await db.select().from(files).where(eq(files.key, input.key)).limit(1);
    const file = rows.at(0);
    if (!file || (file.ownerId !== ctx.user.id && ctx.user.role !== "admin")) {
      throw new TRPCError({ code: "FORBIDDEN", message: "无权访问该附件" });
    }
    const result = await storage.getPresignedUrl({ key: input.key });
    return { url: result.url };
  }),

  listMine: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    return db.select().from(files).where(eq(files.ownerId, ctx.user.id));
  }),

  remove: authedQuery.input(z.object({ key: z.string().min(1) })).mutation(async ({ ctx, input }) => {
    const db = getDb();
    const rows = await db.select().from(files).where(eq(files.key, input.key)).limit(1);
    const file = rows.at(0);
    if (!file || (file.ownerId !== ctx.user.id && ctx.user.role !== "admin")) {
      throw new TRPCError({ code: "FORBIDDEN", message: "无权删除该附件" });
    }
    await db.delete(files).where(eq(files.key, input.key));
    return storage.deleteFile({ fileKey: input.key });
  }),
});
