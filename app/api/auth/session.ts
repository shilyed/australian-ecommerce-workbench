import * as jose from "jose";
import { env } from "../lib/env";
import { Session } from "@contracts/constants";

const JWT_ALG = "HS256";
const JWT_ISSUER = "australian-ecommerce-workbench";
const JWT_AUDIENCE = "workbench-web";

export type SessionPayload = {
  userId: number;
  sessionVersion: number;
};

function sessionSecret(): Uint8Array {
  return new TextEncoder().encode(env.appSecret);
}

export async function signSessionToken(
  payload: SessionPayload
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new jose.SignJWT({
    userId: payload.userId,
    sessionVersion: payload.sessionVersion,
  })
    .setProtectedHeader({ alg: JWT_ALG })
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setSubject(String(payload.userId))
    .setIssuedAt(now)
    .setExpirationTime(now + Math.floor(Session.maxAgeMs / 1000))
    .sign(sessionSecret());
}

export async function verifySessionToken(
  token: string
): Promise<SessionPayload | null> {
  if (!token) return null;

  try {
    const { payload } = await jose.jwtVerify(token, sessionSecret(), {
      algorithms: [JWT_ALG],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    const userId = Number(payload.userId ?? payload.sub);
    const sessionVersion = Number(payload.sessionVersion);
    if (
      !Number.isInteger(userId) ||
      userId <= 0 ||
      !Number.isInteger(sessionVersion) ||
      sessionVersion < 0
    ) {
      return null;
    }
    return { userId, sessionVersion };
  } catch {
    return null;
  }
}
