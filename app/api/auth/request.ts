import * as cookie from "cookie";
import { eq } from "drizzle-orm";
import { localAccounts, users } from "@db/schema";
import { Session } from "@contracts/constants";
import { Errors } from "@contracts/errors";
import { getDb } from "../queries/connection";
import { verifySessionToken } from "./session";

export async function authenticateRequest(headers: Headers) {
  const parsed = cookie.parse(headers.get("cookie") || "");
  const token = parsed[Session.cookieName];
  if (!token) {
    throw Errors.forbidden("请先登录");
  }

  const claim = await verifySessionToken(token);
  if (!claim) {
    throw Errors.forbidden("登录已过期，请重新登录");
  }

  const db = getDb();
  const accountRows = await db
    .select({
      sessionVersion: localAccounts.sessionVersion,
      userId: localAccounts.userId,
    })
    .from(localAccounts)
    .where(eq(localAccounts.userId, claim.userId))
    .limit(1);
  const account = accountRows.at(0);
  if (!account || account.sessionVersion !== claim.sessionVersion) {
    throw Errors.forbidden("登录已失效，请重新登录");
  }

  const userRows = await db
    .select()
    .from(users)
    .where(eq(users.id, account.userId))
    .limit(1);
  const user = userRows.at(0);
  if (!user || user.status !== "active") {
    throw Errors.forbidden("账号已停用");
  }
  return user;
}
