import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

describe("provider readiness", () => {
  it("reports missing Etsy credentials instead of pretending to be ready", async () => {
    delete process.env.ETSY_CLIENT_ID;
    vi.resetModules();
    const { describeProvider } = await import("./providers");
    const info = describeProvider("etsy", "https://workbench.example.com");
    expect(info.configured).toBe(false);
    expect(info.missing).toContain("ETSY_CLIENT_ID");
    expect(info.redirectUri).toBe(
      "https://workbench.example.com/api/integrations/etsy/callback",
    );
  });

  it("requires the eBay RuName before allowing a connection", async () => {
    process.env.EBAY_CLIENT_ID = "client-id";
    process.env.EBAY_CLIENT_SECRET = "client-secret";
    delete process.env.EBAY_REDIRECT_URI;
    vi.resetModules();
    const { describeProvider } = await import("./providers");
    const info = describeProvider("ebay", "https://workbench.example.com");
    expect(info.configured).toBe(false);
    expect(info.missing.join(" ")).toContain("RuName");
  });
});

describe("authorize URL", () => {
  it("builds an Etsy PKCE authorize URL with the expected scopes", async () => {
    process.env.ETSY_CLIENT_ID = "etsy-keystring";
    vi.resetModules();
    const { buildAuthorizeUrl } = await import("./providers");
    const url = new URL(
      buildAuthorizeUrl({
        platform: "etsy",
        state: "signed-state",
        codeChallenge: "challenge-value",
        origin: "https://workbench.example.com",
      }),
    );
    expect(`${url.origin}${url.pathname}`).toBe("https://www.etsy.com/oauth/connect");
    expect(url.searchParams.get("client_id")).toBe("etsy-keystring");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe("challenge-value");
    expect(url.searchParams.get("scope")).toContain("transactions_r");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://workbench.example.com/api/integrations/etsy/callback",
    );
  });

  it("builds a sandbox eBay authorize URL using the RuName", async () => {
    process.env.EBAY_CLIENT_ID = "ebay-client";
    process.env.EBAY_CLIENT_SECRET = "ebay-secret";
    process.env.EBAY_REDIRECT_URI = "My-RuName";
    process.env.EBAY_ENVIRONMENT = "sandbox";
    vi.resetModules();
    const { buildAuthorizeUrl } = await import("./providers");
    const url = new URL(
      buildAuthorizeUrl({
        platform: "ebay",
        state: "signed-state",
        origin: "https://workbench.example.com",
      }),
    );
    expect(url.host).toBe("auth.sandbox.ebay.com");
    expect(url.searchParams.get("redirect_uri")).toBe("My-RuName");
    expect(url.searchParams.get("scope")).toContain("commerce.identity.readonly");
  });

  it("refuses to build an eBay URL without a RuName", async () => {
    process.env.EBAY_CLIENT_ID = "ebay-client";
    process.env.EBAY_CLIENT_SECRET = "ebay-secret";
    delete process.env.EBAY_REDIRECT_URI;
    vi.resetModules();
    const { buildAuthorizeUrl } = await import("./providers");
    expect(() =>
      buildAuthorizeUrl({
        platform: "ebay",
        state: "signed-state",
        origin: "https://workbench.example.com",
      }),
    ).toThrow(/回调地址/);
  });
});
