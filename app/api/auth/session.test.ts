import { beforeAll, describe, expect, it } from "vitest";
import * as jose from "jose";

beforeAll(() => {
  process.env.APP_SECRET = "test-secret-that-is-long-enough-for-hs256";
  process.env.DATABASE_URL = "mysql://unused:unused@127.0.0.1:3306/unused";
});

describe("session token", () => {
  it("expires in the future and preserves the session version", async () => {
    const { signSessionToken, verifySessionToken } = await import("./session");
    const token = await signSessionToken({ userId: 7, sessionVersion: 3 });
    const decoded = jose.decodeJwt(token);
    expect(decoded.exp).toBeGreaterThan(Math.floor(Date.now() / 1000) + 60);
    await expect(verifySessionToken(token)).resolves.toEqual({
      userId: 7,
      sessionVersion: 3,
    });
  });

  it("rejects a modified token", async () => {
    const { signSessionToken, verifySessionToken } = await import("./session");
    const token = await signSessionToken({ userId: 7, sessionVersion: 3 });
    await expect(
      verifySessionToken(`${token.slice(0, -4)}AAAA`)
    ).resolves.toBeNull();
  });
});
