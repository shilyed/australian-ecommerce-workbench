import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
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

  it("requests only supported production user scopes, not a Taxonomy user scope", async () => {
    process.env.EBAY_CLIENT_ID = "ebay-client";
    process.env.EBAY_CLIENT_SECRET = "ebay-secret";
    process.env.EBAY_REDIRECT_URI = "My-RuName";
    process.env.EBAY_ENVIRONMENT = "production";
    vi.resetModules();
    const { buildAuthorizeUrl } = await import("./providers");
    const url = new URL(buildAuthorizeUrl({
      platform: "ebay",
      state: "signed-state",
      origin: "https://workbench.example.com",
    }));
    expect(url.host).toBe("auth.ebay.com");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual([
      "https://api.ebay.com/oauth/api_scope",
      "https://api.ebay.com/oauth/api_scope/sell.inventory",
      "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
      "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
      "https://api.ebay.com/oauth/api_scope/commerce.identity.readonly",
    ]);
  });

  it("preserves previously granted readonly scopes when refreshing an old seller token", async () => {
    vi.resetModules();
    const { ebayRefreshScopes } = await import("./providers");
    const granted = "https://api.ebay.com/oauth/api_scope https://api.ebay.com/oauth/api_scope/sell.inventory.readonly";
    expect(ebayRefreshScopes(granted)).toEqual(granted.split(" "));
    expect(ebayRefreshScopes()).not.toContain("https://api.ebay.com/oauth/api_scope/commerce.taxonomy.readonly");
  });
});

describe("eBay application access tokens", () => {
  beforeEach(() => {
    process.env.EBAY_CLIENT_ID = "ebay-app";
    process.env.EBAY_CLIENT_SECRET = "ebay-secret";
    process.env.EBAY_ENVIRONMENT = "production";
    vi.resetModules();
  });

  const tokenResponse = (accessToken: string, expiresIn = 7200) => new Response(
    JSON.stringify({ access_token: accessToken, expires_in: expiresIn }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );

  it("uses client credentials and the base scope for Taxonomy", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(tokenResponse("app-token"));
    vi.stubGlobal("fetch", fetchMock);
    const { getEbayApplicationAccessToken } = await import("./providers");

    await expect(getEbayApplicationAccessToken()).resolves.toBe("app-token");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.ebay.com/identity/v1/oauth2/token",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from("ebay-app:ebay-secret").toString("base64")}`,
        },
      }),
    );
    const body = new URLSearchParams(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.get("grant_type")).toBe("client_credentials");
    expect(body.get("scope")).toBe("https://api.ebay.com/oauth/api_scope");
    expect(body.has("refresh_token")).toBe(false);
  });

  it("coalesces concurrent requests, caches tokens, and renews at the expiry margin", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-22T00:00:00Z"));
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(tokenResponse("first-app-token", 120))
      .mockResolvedValueOnce(tokenResponse("second-app-token", 120));
    vi.stubGlobal("fetch", fetchMock);
    const { getEbayApplicationAccessToken } = await import("./providers");

    await expect(Promise.all([
      getEbayApplicationAccessToken(),
      getEbayApplicationAccessToken(),
    ])).resolves.toEqual(["first-app-token", "first-app-token"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(59_999);
    await expect(getEbayApplicationAccessToken()).resolves.toBe("first-app-token");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    await expect(Promise.all([
      getEbayApplicationAccessToken(),
      getEbayApplicationAccessToken(),
    ])).resolves.toEqual(["second-app-token", "second-app-token"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses the sandbox token endpoint for sandbox credentials", async () => {
    process.env.EBAY_ENVIRONMENT = "sandbox";
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(tokenResponse("sandbox-app-token"));
    vi.stubGlobal("fetch", fetchMock);
    const { getEbayApplicationAccessToken } = await import("./providers");

    await expect(getEbayApplicationAccessToken()).resolves.toBe("sandbox-app-token");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.sandbox.ebay.com/identity/v1/oauth2/token");
  });

  it.each(["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET"])("rejects a missing %s without making a request", async variable => {
    delete process.env[variable];
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const { getEbayApplicationAccessToken } = await import("./providers");

    await expect(getEbayApplicationAccessToken()).rejects.toThrow(/缺少 eBay 应用凭证/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { access_token: "", expires_in: 7200 },
    { access_token: "app-token" },
    { access_token: "app-token", expires_in: 0 },
  ])("rejects malformed token response %j instead of caching it", async response => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(response), { status: 200 }))
      .mockResolvedValueOnce(tokenResponse("valid-app-token"));
    vi.stubGlobal("fetch", fetchMock);
    const { getEbayApplicationAccessToken } = await import("./providers");

    await expect(getEbayApplicationAccessToken()).rejects.toThrow(/未返回有效的应用/);
    await expect(getEbayApplicationAccessToken()).resolves.toBe("valid-app-token");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces token endpoint errors and lets the next request retry", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: "invalid_client",
        error_description: "Client authentication failed",
      }), { status: 401 }))
      .mockResolvedValueOnce(tokenResponse("retry-app-token"));
    vi.stubGlobal("fetch", fetchMock);
    const { getEbayApplicationAccessToken } = await import("./providers");

    await expect(getEbayApplicationAccessToken()).rejects.toThrow(/HTTP 401.*Client authentication failed/);
    await expect(getEbayApplicationAccessToken()).resolves.toBe("retry-app-token");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
