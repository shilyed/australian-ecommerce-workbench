import type { CookieOptions } from "hono/utils/cookie";
import { env } from "./env";

function isHttps(headers: Headers): boolean {
  if (env.appOrigin.startsWith("https://")) return true;
  const forwardedProto = headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  if (forwardedProto) return forwardedProto === "https";
  return false;
}

export function getSessionCookieOptions(headers: Headers): CookieOptions {
  const secure = isHttps(headers);

  return {
    httpOnly: true,
    path: "/",
    sameSite: "Lax",
    secure,
  };
}
