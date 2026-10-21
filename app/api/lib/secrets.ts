import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import * as jose from "jose";
import { env } from "./env";

/**
 * 平台令牌加密：AES-256-GCM。密钥由 APP_SECRET 派生，因此轮换 APP_SECRET
 * 会使既有店铺凭证失效（需要重新授权），这是预期的安全取舍。
 */
const TOKEN_KEY = createHash("sha256").update(`aew/store-token/v1:${env.appSecret}`).digest();
const STATE_KEY = createHash("sha256").update(`aew/oauth-state/v1:${env.appSecret}`).digest();
const STATE_TTL = "30m";

function b64url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", TOKEN_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${b64url(iv)}.${b64url(tag)}.${b64url(encrypted)}`;
}

export function decryptSecret(payload: string): string {
  const [version, ivRaw, tagRaw, dataRaw] = payload.split(".");
  if (version !== "v1" || !ivRaw || !tagRaw || !dataRaw) {
    throw new Error("Unsupported secret payload");
  }
  const decipher = createDecipheriv("aes-256-gcm", TOKEN_KEY, Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataRaw, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export type OAuthState = {
  userId: number;
  platform: "etsy" | "ebay";
  codeVerifier?: string;
  returnTo?: string;
};

/** OAuth state 使用 JWE（加密 + 签名），避免 PKCE verifier 暴露在浏览器历史里。 */
export async function sealOAuthState(state: OAuthState): Promise<string> {
  return new jose.EncryptJWT({ ...state })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(STATE_TTL)
    .encrypt(STATE_KEY);
}

export async function openOAuthState(token: string): Promise<OAuthState> {
  const { payload } = await jose.jwtDecrypt(token, STATE_KEY, { maxTokenAge: STATE_TTL });
  const userId = Number(payload.userId);
  const platform = payload.platform;
  if (!Number.isFinite(userId) || (platform !== "etsy" && platform !== "ebay")) {
    throw new Error("Invalid OAuth state payload");
  }
  return {
    userId,
    platform,
    codeVerifier: typeof payload.codeVerifier === "string" ? payload.codeVerifier : undefined,
    returnTo: typeof payload.returnTo === "string" ? payload.returnTo : undefined,
  };
}

/** PKCE (RFC 7636)：Etsy 强制要求；eBay 也支持但非必需。 */
export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/** 只允许站内相对路径，防止 open redirect。 */
export function safeReturnPath(input: string | null | undefined, fallback = "/settings"): string {
  if (!input) return fallback;
  if (!input.startsWith("/") || input.startsWith("//")) return fallback;
  return input;
}

/** 固定时间比较，供 webhook/回调校验复用。 */
export function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** 生成稳定的短匿名标识，仅用于日志/审计，不含任何凭证。 */
export function anonymizedFingerprint(value: string): string {
  return createHmac("sha256", STATE_KEY).update(value).digest("hex").slice(0, 12);
}
