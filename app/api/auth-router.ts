import * as cookie from "cookie";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { auditLogs, localAccounts, users } from "@db/schema";
import { Session } from "@contracts/constants";
import { getSessionCookieOptions } from "./lib/cookies";
import {
  adminQuery,
  authedQuery,
  createRouter,
  publicQuery,
} from "./middleware";
import { getDb } from "./queries/connection";
import { createLocalUser, hasAnyLocalAccount } from "./auth/accounts";
import {
  consumePasswordCheck,
  hashPassword,
  isValidEmail,
  normalizeEmail,
  verifyPassword,
} from "./auth/password";
import { signSessionToken } from "./auth/session";

const emailSchema = z.string().trim().min(3).max(320);
const passwordSchema = z.string().min(1).max(128);
const strongPasswordSchema = z.string().min(12).max(128);
const businessRoleSchema = z.enum([
  "admin",
  "operations",
  "fulfillment",
  "finance",
]);

type RateLimitEntry = { count: number; resetAt: number };
const loginAttempts = new Map<string, RateLimitEntry>();
const RATE_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_LOGINS = 10;
const ACCOUNT_LOCK_MS = 15 * 60 * 1000;
const MAX_ACCOUNT_FAILURES = 5;
let setupInProgress = false;

function requestIp(headers: Headers): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

function checkRateLimit(key: string): void {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry) return;
  if (entry.resetAt <= now) {
    loginAttempts.delete(key);
    return;
  }
  if (entry.count >= MAX_FAILED_LOGINS) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "登录尝试过于频繁，请 15 分钟后再试",
    });
  }
}

function recordFailedLogin(key: string): void {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || entry.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return;
  }
  entry.count += 1;
  if (loginAttempts.size > 5_000) {
    for (const [storedKey, stored] of loginAttempts) {
      if (stored.resetAt <= now) loginAttempts.delete(storedKey);
    }
  }
}

function normalizeLoginError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: error instanceof Error ? error.message : "操作失败",
  });
}

async function writeSessionCookie(
  headers: Headers,
  responseHeaders: Headers,
  userId: number,
  sessionVersion: number
): Promise<void> {
  const token = await signSessionToken({ userId, sessionVersion });
  const options = getSessionCookieOptions(headers);
  responseHeaders.append(
    "set-cookie",
    cookie.serialize(Session.cookieName, token, {
      httpOnly: options.httpOnly,
      path: options.path,
      sameSite: "lax",
      secure: options.secure,
      maxAge: Math.floor(Session.maxAgeMs / 1000),
    })
  );
}

function clearSessionCookie(headers: Headers, responseHeaders: Headers): void {
  const options = getSessionCookieOptions(headers);
  responseHeaders.append(
    "set-cookie",
    cookie.serialize(Session.cookieName, "", {
      httpOnly: options.httpOnly,
      path: options.path,
      sameSite: "lax",
      secure: options.secure,
      maxAge: 0,
    })
  );
}

async function auditAuth(
  actorId: number | null,
  action: string,
  targetId: number,
  details: Record<string, unknown>
): Promise<void> {
  await getDb()
    .insert(auditLogs)
    .values({
      actorId,
      action,
      entityType: "user",
      entityId: String(targetId),
      afterJson: details,
    });
}

export const authRouter = createRouter({
  setupStatus: publicQuery.query(async () => ({
    needsSetup: !(await hasAnyLocalAccount()),
  })),

  setup: publicQuery
    .input(
      z.object({
        name: z.string().trim().min(1).max(255),
        email: emailSchema,
        password: strongPasswordSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (setupInProgress) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "管理员账号正在创建，请稍后登录",
        });
      }
      setupInProgress = true;
      try {
        if (await hasAnyLocalAccount()) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "工作台已经完成初始化，请直接登录",
          });
        }

        const email = normalizeEmail(input.email);
        if (!isValidEmail(email)) {
          throw new Error("请输入有效邮箱地址");
        }
        const user = await createLocalUser({
          email,
          name: input.name,
          password: input.password,
          role: "admin",
          businessRole: "admin",
        });
        await writeSessionCookie(ctx.req.headers, ctx.resHeaders, user.id, 0);
        await auditAuth(user.id, "auth.admin.setup", user.id, {
          email,
        });
        return user;
      } catch (error) {
        normalizeLoginError(error);
      } finally {
        setupInProgress = false;
      }
    }),

  login: publicQuery
    .input(
      z.object({
        email: emailSchema,
        password: passwordSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const email = normalizeEmail(input.email);
      const rateKey = `${requestIp(ctx.req.headers)}:${email}`;
      checkRateLimit(rateKey);

      const joined = await db
        .select({
          accountId: localAccounts.id,
          passwordHash: localAccounts.passwordHash,
          sessionVersion: localAccounts.sessionVersion,
          failedLoginAttempts: localAccounts.failedLoginAttempts,
          lockedUntil: localAccounts.lockedUntil,
          userId: users.id,
          status: users.status,
        })
        .from(localAccounts)
        .innerJoin(users, eq(users.id, localAccounts.userId))
        .where(eq(localAccounts.email, email))
        .limit(1);
      const account = joined.at(0);

      if (!account) {
        await consumePasswordCheck(input.password);
        recordFailedLogin(rateKey);
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "邮箱或密码错误",
        });
      }

      if (account.lockedUntil && account.lockedUntil.getTime() > Date.now()) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "该账号暂时锁定，请稍后再试",
        });
      }

      const valid = await verifyPassword(input.password, account.passwordHash);
      if (!valid) {
        const failures = account.failedLoginAttempts + 1;
        await db
          .update(localAccounts)
          .set({
            failedLoginAttempts:
              failures >= MAX_ACCOUNT_FAILURES ? 0 : failures,
            lockedUntil:
              failures >= MAX_ACCOUNT_FAILURES
                ? new Date(Date.now() + ACCOUNT_LOCK_MS)
                : null,
          })
          .where(eq(localAccounts.id, account.accountId));
        recordFailedLogin(rateKey);
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "邮箱或密码错误",
        });
      }

      if (account.status !== "active") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "账号已停用，请联系管理员",
        });
      }

      const now = new Date();
      await db.transaction(async tx => {
        await tx
          .update(localAccounts)
          .set({
            failedLoginAttempts: 0,
            lockedUntil: null,
            lastLoginAt: now,
          })
          .where(eq(localAccounts.id, account.accountId));
        await tx
          .update(users)
          .set({ lastSignInAt: now })
          .where(eq(users.id, account.userId));
      });
      loginAttempts.delete(rateKey);
      await writeSessionCookie(
        ctx.req.headers,
        ctx.resHeaders,
        account.userId,
        account.sessionVersion
      );

      const rows = await db
        .select()
        .from(users)
        .where(eq(users.id, account.userId))
        .limit(1);
      const user = rows.at(0);
      if (!user) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "登录账号读取失败",
        });
      }
      return user;
    }),

  me: authedQuery.query(opts => opts.ctx.user),

  logout: publicQuery.mutation(({ ctx }) => {
    clearSessionCookie(ctx.req.headers, ctx.resHeaders);
    return { success: true };
  }),

  changePassword: authedQuery
    .input(
      z.object({
        currentPassword: passwordSchema,
        newPassword: strongPasswordSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const rows = await db
        .select()
        .from(localAccounts)
        .where(eq(localAccounts.userId, ctx.user.id))
        .limit(1);
      const account = rows.at(0);
      if (!account) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "当前账号尚未启用密码登录",
        });
      }
      if (
        !(await verifyPassword(input.currentPassword, account.passwordHash))
      ) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "当前密码不正确",
        });
      }

      const nextVersion = account.sessionVersion + 1;
      const passwordHash = await hashPassword(input.newPassword);
      await db
        .update(localAccounts)
        .set({
          passwordHash,
          sessionVersion: nextVersion,
          passwordChangedAt: new Date(),
          failedLoginAttempts: 0,
          lockedUntil: null,
        })
        .where(eq(localAccounts.id, account.id));
      await writeSessionCookie(
        ctx.req.headers,
        ctx.resHeaders,
        ctx.user.id,
        nextVersion
      );
      await auditAuth(ctx.user.id, "auth.password.change", ctx.user.id, {});
      return { ok: true };
    }),

  createMember: adminQuery
    .input(
      z.object({
        name: z.string().trim().min(1).max(255),
        email: emailSchema,
        password: strongPasswordSchema,
        businessRole: businessRoleSchema,
        reason: z.string().trim().min(3).max(500),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const email = normalizeEmail(input.email);
        if (!isValidEmail(email)) throw new Error("请输入有效邮箱地址");
        const user = await createLocalUser({
          email,
          name: input.name,
          password: input.password,
          role: "user",
          businessRole: input.businessRole,
        });
        await auditAuth(ctx.user.id, "member.create", user.id, {
          email,
          businessRole: input.businessRole,
          reason: input.reason,
        });
        return user;
      } catch (error) {
        normalizeLoginError(error);
      }
    }),

  resetMemberPassword: adminQuery
    .input(
      z.object({
        userId: z.number().int().positive(),
        newPassword: strongPasswordSchema,
        email: emailSchema.optional(),
        reason: z.string().trim().min(3).max(500),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const userRows = await db
        .select()
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);
      const user = userRows.at(0);
      if (!user) {
        throw new TRPCError({ code: "NOT_FOUND", message: "成员不存在" });
      }

      const accountRows = await db
        .select()
        .from(localAccounts)
        .where(eq(localAccounts.userId, user.id))
        .limit(1);
      const account = accountRows.at(0);
      const email = normalizeEmail(
        input.email || account?.email || user.email || ""
      );
      if (!isValidEmail(email)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "该成员没有有效邮箱，请填写登录邮箱",
        });
      }

      const passwordHash = await hashPassword(input.newPassword);
      try {
        await db.transaction(async tx => {
          const emailOwner = await tx
            .select({ userId: localAccounts.userId })
            .from(localAccounts)
            .where(eq(localAccounts.email, email))
            .limit(1);
          if (emailOwner.at(0) && emailOwner[0].userId !== user.id) {
            throw new Error("该邮箱已绑定其他工作台账号");
          }

          if (account) {
            await tx
              .update(localAccounts)
              .set({
                email,
                passwordHash,
                sessionVersion: account.sessionVersion + 1,
                passwordChangedAt: new Date(),
                failedLoginAttempts: 0,
                lockedUntil: null,
              })
              .where(eq(localAccounts.id, account.id));
          } else {
            await tx.insert(localAccounts).values({
              userId: user.id,
              email,
              passwordHash,
              sessionVersion: 0,
            });
          }
          await tx
            .update(users)
            .set({ email, status: "active" })
            .where(eq(users.id, user.id));
        });
      } catch (error) {
        normalizeLoginError(error);
      }

      await auditAuth(ctx.user.id, "member.password.reset", user.id, {
        email,
        reason: input.reason,
      });
      return { ok: true };
    }),
});
