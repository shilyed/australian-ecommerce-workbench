import { Hono, type Context } from "hono";
import { eq } from "drizzle-orm";
import type { User } from "@db/schema";
import { users } from "@db/schema";
import { getDb } from "../queries/connection";
import { authenticateRequest } from "../auth/request";
import {
  createPkcePair,
  openOAuthState,
  safeReturnPath,
  sealOAuthState,
} from "../lib/secrets";
import {
  buildAuthorizeUrl,
  describeProvider,
  exchangeAuthorizationCode,
  fetchStoreProfile,
  inferOrigin,
} from "./providers";
import { saveConnectedStore } from "./store-service";
import { IntegrationError, type IntegrationPlatform } from "./types";

function parsePlatform(value: string | undefined): IntegrationPlatform | null {
  if (value === "etsy" || value === "ebay") return value;
  return null;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message ?? fallback);
  }
  return fallback;
}

/** 回调只能回到站内路径，避免开放重定向。 */
function callbackRedirect(
  returnTo: string,
  params: Record<string, string>
): string {
  // 生成相对 Location，浏览器按当前站点解析；不依赖可被伪造的 Host 头
  const url = new URL(safeReturnPath(returnTo), "http://aew.internal");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value.slice(0, 240));
  }
  return `${url.pathname}${url.search}`;
}

async function requireAdmin(c: Context): Promise<User> {
  const user = await authenticateRequest(c.req.raw.headers);
  if (user.role !== "admin") {
    throw new IntegrationError("只有管理员可以连接或断开店铺授权", 403);
  }
  return user;
}

export function createIntegrationRoutes() {
  const app = new Hono();

  app.get("/:platform/start", async c => {
    const platform = parsePlatform(c.req.param("platform"));
    if (!platform) return c.json({ error: "不支持的平台" }, 404);
    const origin = inferOrigin(c.req.raw);
    const returnTo = safeReturnPath(c.req.query("returnTo") ?? "/settings");
    try {
      const user = await requireAdmin(c);
      const provider = describeProvider(platform, origin);
      if (!provider.configured) {
        throw new IntegrationError(
          `${platform === "etsy" ? "Etsy" : "eBay"} 应用凭证未配置：缺少 ${provider.missing.join("、")}`
        );
      }
      const pkce = platform === "etsy" ? createPkcePair() : null;
      const state = await sealOAuthState({
        userId: user.id,
        platform,
        codeVerifier: pkce?.verifier,
        returnTo,
      });
      const authorizeUrl = buildAuthorizeUrl({
        platform,
        state,
        codeChallenge: pkce?.challenge,
        origin,
      });
      return c.redirect(authorizeUrl, 302);
    } catch (error) {
      const message = errorMessage(error, "授权发起失败");
      console.warn(`[integrations] start ${platform} failed: ${message}`);
      return c.redirect(
        callbackRedirect(returnTo, {
          integration: platform,
          status: "error",
          message,
        }),
        302
      );
    }
  });

  app.get("/:platform/callback", async c => {
    const platform = parsePlatform(c.req.param("platform"));
    if (!platform) return c.json({ error: "不支持的平台" }, 404);
    const origin = inferOrigin(c.req.raw);
    const providerError = c.req.query("error");
    const providerErrorDescription = c.req.query("error_description");
    const stateToken = c.req.query("state");
    const code = c.req.query("code");

    let returnTo = "/settings";
    try {
      if (!stateToken)
        throw new IntegrationError("回调缺少 state，无法校验请求来源");
      const state = await openOAuthState(stateToken);
      returnTo = safeReturnPath(state.returnTo);
      if (state.platform !== platform) {
        throw new IntegrationError("回调平台与授权请求不一致");
      }

      if (providerError) {
        throw new IntegrationError(
          providerError === "access_denied"
            ? "你取消了授权"
            : `平台返回错误：${providerErrorDescription ?? providerError}`
        );
      }
      if (!code) throw new IntegrationError("回调缺少授权码");

      const db = getDb();
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, state.userId))
        .limit(1);
      if (!user || user.role !== "admin" || user.status !== "active") {
        throw new IntegrationError(
          "当前账号无权完成店铺授权，请重新登录管理员账号"
        );
      }

      const tokens = await exchangeAuthorizationCode({
        platform,
        code,
        codeVerifier: state.codeVerifier,
        origin,
      });
      const profile = await fetchStoreProfile(platform, tokens.accessToken);
      const storeId = await saveConnectedStore({
        platform,
        profile,
        tokens,
        actorId: user.id,
      });

      return c.redirect(
        callbackRedirect(returnTo, {
          integration: platform,
          status: "connected",
          store: String(storeId),
          shop: profile.shopName,
        }),
        302
      );
    } catch (error) {
      const message = errorMessage(error, "店铺授权失败");
      console.warn(`[integrations] callback ${platform} failed: ${message}`);
      const cancelled = providerError === "access_denied";
      return c.redirect(
        callbackRedirect(returnTo, {
          integration: platform,
          status: cancelled ? "cancelled" : "error",
          message,
        }),
        302
      );
    }
  });

  return app;
}
