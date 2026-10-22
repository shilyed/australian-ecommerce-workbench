import { env, integrationEnv } from "../lib/env";
import {
  IntegrationError,
  type IntegrationPlatform,
  type ProviderInfo,
  type StoreProfile,
  type TokenSet,
} from "./types";

const REQUEST_TIMEOUT_MS = 15_000;

const ETSY_AUTHORIZE_URL = "https://www.etsy.com/oauth/connect";
const ETSY_TOKEN_URL = "https://api.etsy.com/v3/public/oauth/token";
const ETSY_API_BASE = "https://openapi.etsy.com/v3/application";
const ETSY_SCOPES = ["profile_r", "shops_r", "listings_r", "transactions_r"];

const EBAY_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
  "https://api.ebay.com/oauth/api_scope/commerce.identity.readonly",
  "https://api.ebay.com/oauth/api_scope/commerce.taxonomy.readonly",
];

const EBAY_MARKETPLACE_HOSTS: Record<string, string> = {
  EBAY_AU: "ebay.com.au",
  EBAY_US: "ebay.com",
  EBAY_GB: "ebay.co.uk",
  EBAY_DE: "ebay.de",
  EBAY_CA: "ebay.ca",
  EBAY_FR: "ebay.fr",
  EBAY_IT: "ebay.it",
  EBAY_ES: "ebay.es",
  EBAY_IE: "ebay.ie",
  EBAY_NZ: "ebay.com",
};

function ebayBaseUrl(): string {
  return integrationEnv.ebay.environment === "sandbox"
    ? "https://api.sandbox.ebay.com"
    : "https://api.ebay.com";
}

function ebayIdentityBaseUrl(): string {
  // Identity API is hosted on apiz.ebay.com, unlike the Sell APIs on api.ebay.com.
  return integrationEnv.ebay.environment === "sandbox"
    ? "https://apiz.sandbox.ebay.com"
    : "https://apiz.ebay.com";
}

function ebayAuthorizeUrl(): string {
  return integrationEnv.ebay.environment === "sandbox"
    ? "https://auth.sandbox.ebay.com/oauth2/authorize"
    : "https://auth.ebay.com/oauth2/authorize";
}

export function normalizeOrigin(origin: string): string {
  const trimmed = origin.trim().replace(/\/+$/, "");
  return trimmed || "http://localhost:3000";
}

/** 服务端统一推导对外 origin：优先 APP_ORIGIN，其次反向代理头，最后请求 URL。 */
export function inferOrigin(req: Request): string {
  if (env.appOrigin) return env.appOrigin;
  const url = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || req.headers.get("host") || url.host;
  return `${proto}://${host}`;
}

function resolveRedirectUri(platform: IntegrationPlatform, origin: string): string | null {
  if (platform === "etsy") {
    const configured = integrationEnv.etsy.redirectUri.trim();
    return configured || `${normalizeOrigin(origin)}/api/integrations/etsy/callback`;
  }
  // eBay 的 redirect_uri 实际是 RuName，必须在开发者后台预先登记，不能推导。
  const configured = integrationEnv.ebay.redirectUri.trim();
  return configured || null;
}

export function describeProvider(platform: IntegrationPlatform, origin: string): ProviderInfo {
  const redirectUri = resolveRedirectUri(platform, origin);
  if (platform === "etsy") {
    const missing: string[] = [];
    if (!integrationEnv.etsy.clientId) missing.push("ETSY_CLIENT_ID");
    const notes: string[] = [];
    if (!integrationEnv.etsy.redirectUri) {
      notes.push(`未设置 ETSY_REDIRECT_URI，将回退使用 ${redirectUri ?? "请求 origin"}；请确认它与 Etsy 应用登记的回调地址完全一致。`);
    }
    if (!integrationEnv.etsy.clientSecret) {
      notes.push("Etsy OAuth 走 PKCE，不强制 ETSY_CLIENT_SECRET；如需签名校验可补上。");
    }
    return {
      platform,
      configured: missing.length === 0,
      missing,
      redirectUri,
      scopes: ETSY_SCOPES,
      docsUrl: "https://developers.etsy.com/documentation/essentials/authentication",
      notes,
    };
  }
  const missing: string[] = [];
  if (!integrationEnv.ebay.clientId) missing.push("EBAY_CLIENT_ID");
  if (!integrationEnv.ebay.clientSecret) missing.push("EBAY_CLIENT_SECRET");
  if (!integrationEnv.ebay.redirectUri) missing.push("EBAY_REDIRECT_URI (RuName)");
  return {
    platform,
    configured: missing.length === 0,
    missing,
    redirectUri,
    scopes: EBAY_SCOPES,
    docsUrl: "https://developer.ebay.com/api-docs/static/oauth-authorization-code-grant.html",
    notes: [
      `当前环境：${integrationEnv.ebay.environment}，市场：${integrationEnv.ebay.marketplaceId}。`,
      "eBay 的 redirect_uri 必须填写开发者后台生成的 RuName，而不是完整网址。",
    ],
  };
}

export function buildAuthorizeUrl(options: {
  platform: IntegrationPlatform;
  state: string;
  codeChallenge?: string;
  origin: string;
}): string {
  const { platform, state, codeChallenge, origin } = options;
  const redirectUri = resolveRedirectUri(platform, origin);
  if (!redirectUri) throw new IntegrationError("缺少平台回调地址配置");

  if (platform === "etsy") {
    if (!integrationEnv.etsy.clientId) throw new IntegrationError("缺少 ETSY_CLIENT_ID");
    if (!codeChallenge) throw new IntegrationError("Etsy 授权需要 PKCE challenge");
    const url = new URL(ETSY_AUTHORIZE_URL);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", integrationEnv.etsy.clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", ETSY_SCOPES.join(" "));
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    // 把表单编码的空格还原为 %20，兼容对 scope 编码较严格的平台
    url.search = url.search.replace(/\+/g, "%20");
    return url.toString();
  }

  if (!integrationEnv.ebay.clientId) throw new IntegrationError("缺少 EBAY_CLIENT_ID");
  const url = new URL(ebayAuthorizeUrl());
  url.searchParams.set("client_id", integrationEnv.ebay.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", EBAY_SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.search = url.search.replace(/\+/g, "%20");
  return url.toString();
}

type ErrorShape = { message?: string; error?: string; error_description?: string };

function briefProviderError(body: string): string {
  const trimmed = body.trim().slice(0, 400);
  try {
    const parsed = JSON.parse(trimmed) as
      | ErrorShape
      | { errors?: Array<{ message?: string; longMessage?: string }> };
    if ("errors" in parsed && Array.isArray(parsed.errors) && parsed.errors.length > 0) {
      return parsed.errors[0]?.longMessage || parsed.errors[0]?.message || "平台返回错误";
    }
    if ("error_description" in parsed && parsed.error_description) return parsed.error_description;
    if ("error" in parsed && parsed.error) return parsed.error;
    if ("message" in parsed && parsed.message) return parsed.message;
  } catch {
    // 非 JSON 响应，保留截断文本
  }
  return trimmed || "平台返回空响应";
}

async function requestJson<T>(
  url: string,
  init: RequestInit,
  label: string,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      const body = await response.text();
      throw new IntegrationError(
        `${label}失败（HTTP ${response.status}）：${briefProviderError(body)}`,
        response.status,
        briefProviderError(body),
      );
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof IntegrationError) throw error;
    if ((error as Error).name === "AbortError") {
      throw new IntegrationError(`${label}超时，请稍后重试`);
    }
    throw new IntegrationError(`${label}失败：${(error as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asString(value: unknown): string | null {
  if (typeof value === "number") return String(value);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

type EtsyTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
};

async function etsyExchangeCode(code: string, verifier: string, origin: string): Promise<TokenSet> {
  const redirectUri = resolveRedirectUri("etsy", origin);
  if (!redirectUri) throw new IntegrationError("缺少 Etsy 回调地址");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: integrationEnv.etsy.clientId,
    redirect_uri: redirectUri,
    code,
    code_verifier: verifier,
  });
  const json = await requestJson<EtsyTokenResponse>(
    ETSY_TOKEN_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: body.toString(),
    },
    "Etsy 换取令牌",
  );
  if (!json.access_token) throw new IntegrationError("Etsy 未返回 access_token");
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: new Date(Date.now() + (json.expires_in ?? 3600) * 1000),
    scopes: (json.scope ?? ETSY_SCOPES.join(" ")).split(/\s+/).filter(Boolean),
    tokenType: json.token_type ?? "Bearer",
  };
}

async function etsyRefresh(refreshToken: string): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: integrationEnv.etsy.clientId,
    refresh_token: refreshToken,
  });
  const json = await requestJson<EtsyTokenResponse>(
    ETSY_TOKEN_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: body.toString(),
    },
    "Etsy 刷新令牌",
  );
  if (!json.access_token) throw new IntegrationError("Etsy 刷新未返回 access_token");
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? refreshToken,
    expiresAt: new Date(Date.now() + (json.expires_in ?? 3600) * 1000),
    scopes: (json.scope ?? ETSY_SCOPES.join(" ")).split(/\s+/).filter(Boolean),
    tokenType: json.token_type ?? "Bearer",
  };
}

async function etsyGet<T>(path: string, accessToken: string): Promise<T> {
  return requestJson<T>(
    `${ETSY_API_BASE}${path}`,
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "x-api-key": integrationEnv.etsy.clientId,
      },
    },
    "Etsy 接口调用",
  );
}

type EtsyUser = { user_id?: number; login_name?: string };
type EtsyShop = {
  shop_id?: number;
  shop_name?: string;
  title?: string | null;
  url?: string | null;
  currency_code?: string | null;
  shop_location_country_iso?: string | null;
  listing_active_count?: number | null;
  transaction_sold_count?: number | null;
  review_count?: number | null;
  review_average?: number | null;
  is_vacation?: boolean | null;
};

async function etsyProfile(accessToken: string): Promise<StoreProfile> {
  const notes: string[] = [];
  const me = await etsyGet<EtsyUser>("/users/me", accessToken);
  const userId = asNumber(me.user_id);
  if (!userId) throw new IntegrationError("Etsy 未返回账号 ID，无法完成绑定");

  const shopId = integrationEnv.etsy.shopId.trim();
  let shop: EtsyShop | undefined;
  if (shopId) {
    shop = await etsyGet<EtsyShop>(`/shops/${encodeURIComponent(shopId)}`, accessToken);
  } else {
    const shops = await etsyGet<{ count?: number; results?: EtsyShop[] }>(
      `/users/${userId}/shops`,
      accessToken,
    );
    shop = shops.results?.[0];
  }
  if (!shop?.shop_id) {
    throw new IntegrationError("该 Etsy 账号名下没有可用店铺，请先在 Etsy 开店或配置 ETSY_SHOP_ID");
  }

  let orderCount: number | null = null;
  try {
    const receipts = await etsyGet<{ count?: number }>(
      `/shops/${shop.shop_id}/receipts?limit=1`,
      accessToken,
    );
    orderCount = asNumber(receipts.count);
  } catch (error) {
    notes.push(`订单数未读取（${(error as Error).message}）`);
  }

  return {
    platform: "etsy",
    accountId: String(shop.shop_id),
    accountLabel: asString(me.login_name),
    shopName: asString(shop.shop_name) ?? asString(shop.title) ?? `Etsy shop ${shop.shop_id}`,
    shopUrl: asString(shop.url),
    currency: asString(shop.currency_code),
    country: asString(shop.shop_location_country_iso),
    listingCount: asNumber(shop.listing_active_count),
    orderCount,
    soldCount: asNumber(shop.transaction_sold_count),
    reviewCount: asNumber(shop.review_count),
    reviewAverage: asNumber(shop.review_average),
    sellingLimitAmount: null,
    sellingLimitQuantity: null,
    sellingLimitCurrency: null,
    vacation: typeof shop.is_vacation === "boolean" ? shop.is_vacation : null,
    marketplace: "Etsy",
    fetchedAt: new Date().toISOString(),
    notes,
  };
}

type EbayTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
};

function ebayBasicAuth(): string {
  return Buffer.from(
    `${integrationEnv.ebay.clientId}:${integrationEnv.ebay.clientSecret}`,
  ).toString("base64");
}

async function ebayExchangeCode(code: string, origin: string): Promise<TokenSet> {
  const redirectUri = resolveRedirectUri("ebay", origin);
  if (!redirectUri) throw new IntegrationError("缺少 EBAY_REDIRECT_URI (RuName)");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });
  const json = await requestJson<EbayTokenResponse>(
    `${ebayBaseUrl()}/identity/v1/oauth2/token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${ebayBasicAuth()}`,
      },
      body: body.toString(),
    },
    "eBay 换取令牌",
  );
  if (!json.access_token) throw new IntegrationError("eBay 未返回 access_token");
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: new Date(Date.now() + (json.expires_in ?? 7200) * 1000),
    scopes: (json.scope ?? EBAY_SCOPES.join(" ")).split(/\s+/).filter(Boolean),
    tokenType: json.token_type ?? "Bearer",
  };
}

/** 刷新时只能申请当初已授予的 scope 子集，否则 eBay 返回 invalid_scope。 */
export function ebayRefreshScopes(grantedScopes?: string | null): string[] {
  const granted = (grantedScopes ?? "").split(/\s+/).filter(Boolean);
  return granted.length > 0 ? granted : EBAY_SCOPES;
}

async function ebayRefresh(refreshToken: string, grantedScopes?: string | null): Promise<TokenSet> {
  const scopes = ebayRefreshScopes(grantedScopes);
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: scopes.join(" "),
  });
  const json = await requestJson<EbayTokenResponse>(
    `${ebayBaseUrl()}/identity/v1/oauth2/token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${ebayBasicAuth()}`,
      },
      body: body.toString(),
    },
    "eBay 刷新令牌",
  );
  if (!json.access_token) throw new IntegrationError("eBay 刷新未返回 access_token");
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? refreshToken,
    expiresAt: new Date(Date.now() + (json.expires_in ?? 7200) * 1000),
    scopes: (json.scope ?? scopes.join(" ")).split(/\s+/).filter(Boolean),
    tokenType: json.token_type ?? "Bearer",
  };
}

async function ebayGet<T>(
  path: string,
  accessToken: string,
  baseUrl = ebayBaseUrl(),
): Promise<T> {
  return requestJson<T>(
    `${baseUrl}${path}`,
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "Accept-Language": "en-AU",
        "X-EBAY-C-MARKETPLACE-ID": integrationEnv.ebay.marketplaceId,
      },
    },
    "eBay 接口调用",
  );
}

type EbayIdentity = {
  userId?: string;
  username?: string;
  accountType?: string;
  registrationMarketplaceId?: string;
};

type EbayPrivilege = {
  sellingLimit?: {
    amount?: { value?: number | string; currency?: string };
    quantity?: number;
  };
};

async function ebayProfile(accessToken: string): Promise<StoreProfile> {
  const notes: string[] = [];
  const identity = await ebayGet<EbayIdentity>(
    "/commerce/identity/v1/user/",
    accessToken,
    ebayIdentityBaseUrl(),
  );
  const userId = asString(identity.userId);
  const username = asString(identity.username);
  if (!userId) {
    throw new IntegrationError(
      "eBay 未返回账号 ID；请确认应用已开通 commerce.identity.readonly 权限",
    );
  }

  let listingCount: number | null = null;
  let orderCount: number | null = null;
  let privilege: EbayPrivilege | null = null;

  try {
    const offers = await ebayGet<{ total?: number }>(
      "/sell/inventory/v1/offer?limit=1&filter=status%3APUBLISHED",
      accessToken,
    );
    listingCount = asNumber(offers.total);
  } catch {
    try {
      const offers = await ebayGet<{ total?: number }>(
        "/sell/inventory/v1/offer?limit=1",
        accessToken,
      );
      listingCount = asNumber(offers.total);
      notes.push("在售刊登数包含未发布的 Offer（平台未接受 PUBLISHED 过滤条件）。");
    } catch (fallbackError) {
      notes.push(`在售刊登数未读取（${(fallbackError as Error).message}）`);
    }
  }

  try {
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const filter = encodeURIComponent(`creationdate:[${since}..]`);
    const orders = await ebayGet<{ total?: number }>(
      `/sell/fulfillment/v1/order?limit=1&filter=${filter}`,
      accessToken,
    );
    orderCount = asNumber(orders.total);
  } catch (error) {
    notes.push(`近 90 天订单数未读取（${(error as Error).message}）`);
  }

  try {
    privilege = await ebayGet<EbayPrivilege>("/sell/account/v1/privilege", accessToken);
  } catch (error) {
    notes.push(`销售额度未读取（${(error as Error).message}）`);
  }

  const host = EBAY_MARKETPLACE_HOSTS[integrationEnv.ebay.marketplaceId] ?? "ebay.com";
  const limitAmount = privilege?.sellingLimit?.amount;

  return {
    platform: "ebay",
    accountId: userId,
    accountLabel: username,
    shopName: username ? `${username} · eBay` : `eBay 账号 ${userId}`,
    shopUrl: username ? `https://www.${host}/usr/${encodeURIComponent(username)}` : null,
    currency: asString(limitAmount?.currency),
    country: asString(identity.registrationMarketplaceId),
    listingCount,
    orderCount,
    soldCount: null,
    reviewCount: null,
    reviewAverage: null,
    sellingLimitAmount: asNumber(limitAmount?.value),
    sellingLimitQuantity: asNumber(privilege?.sellingLimit?.quantity),
    sellingLimitCurrency: asString(limitAmount?.currency),
    vacation: null,
    marketplace: integrationEnv.ebay.marketplaceId,
    fetchedAt: new Date().toISOString(),
    notes,
  };
}

export async function exchangeAuthorizationCode(options: {
  platform: IntegrationPlatform;
  code: string;
  codeVerifier?: string;
  origin: string;
}): Promise<TokenSet> {
  if (options.platform === "etsy") {
    if (!options.codeVerifier) throw new IntegrationError("Etsy 授权缺少 PKCE verifier");
    return etsyExchangeCode(options.code, options.codeVerifier, options.origin);
  }
  return ebayExchangeCode(options.code, options.origin);
}

export async function refreshAccessToken(
  platform: IntegrationPlatform,
  refreshToken: string,
  grantedScopes?: string | null,
): Promise<TokenSet> {
  return platform === "etsy" ? etsyRefresh(refreshToken) : ebayRefresh(refreshToken, grantedScopes);
}

export async function fetchStoreProfile(
  platform: IntegrationPlatform,
  accessToken: string,
): Promise<StoreProfile> {
  return platform === "etsy" ? etsyProfile(accessToken) : ebayProfile(accessToken);
}
