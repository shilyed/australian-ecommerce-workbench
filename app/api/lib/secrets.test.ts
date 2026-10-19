import { describe, expect, it } from "vitest";
import {
  constantTimeEqual,
  createPkcePair,
  decryptSecret,
  encryptSecret,
  openOAuthState,
  safeReturnPath,
  sealOAuthState,
} from "./secrets";

describe("secret encryption", () => {
  it("round-trips a token without leaking plaintext", () => {
    const token = "etsy-access-token-1234567890";
    const encrypted = encryptSecret(token);
    expect(encrypted).not.toContain(token);
    expect(encrypted.startsWith("v1.")).toBe(true);
    expect(decryptSecret(encrypted)).toBe(token);
  });

  it("produces a different ciphertext for the same plaintext", () => {
    expect(encryptSecret("same-value")).not.toBe(encryptSecret("same-value"));
  });

  it("rejects tampered payloads", () => {
    const encrypted = encryptSecret("refresh-token");
    const parts = encrypted.split(".");
    const data = parts[3];
    const tampered = `${parts[0]}.${parts[1]}.${parts[2]}.${data.slice(0, -2)}AA`;
    expect(() => decryptSecret(tampered)).toThrow();
  });
});

describe("OAuth state", () => {
  it("round-trips the signed state payload", async () => {
    const state = await sealOAuthState({
      userId: 42,
      platform: "etsy",
      codeVerifier: "verifier-value",
      returnTo: "/settings",
    });
    const opened = await openOAuthState(state);
    expect(opened.userId).toBe(42);
    expect(opened.platform).toBe("etsy");
    expect(opened.codeVerifier).toBe("verifier-value");
    expect(opened.returnTo).toBe("/settings");
  });

  it("rejects tampered state tokens", async () => {
    const state = await sealOAuthState({ userId: 1, platform: "ebay" });
    await expect(openOAuthState(`${state.slice(0, -4)}AAAA`)).rejects.toThrow();
  });
});

describe("PKCE", () => {
  it("creates an S256 challenge derived from the verifier", async () => {
    const { createHash } = await import("node:crypto");
    const pair = createPkcePair();
    expect(pair.verifier.length).toBeGreaterThanOrEqual(43);
    expect(pair.challenge).toBe(
      createHash("sha256").update(pair.verifier).digest("base64url"),
    );
  });
});

describe("safeReturnPath", () => {
  it("keeps internal paths and rejects external ones", () => {
    expect(safeReturnPath("/settings?tab=1")).toBe("/settings?tab=1");
    expect(safeReturnPath("https://evil.example.com")).toBe("/settings");
    expect(safeReturnPath("//evil.example.com")).toBe("/settings");
    expect(safeReturnPath(null)).toBe("/settings");
    expect(safeReturnPath("", "/dashboard")).toBe("/dashboard");
  });
});

describe("constantTimeEqual", () => {
  it("compares strings without throwing on length mismatch", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
  });
});
