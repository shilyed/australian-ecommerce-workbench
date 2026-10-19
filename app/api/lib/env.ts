import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value && process.env.NODE_ENV === "production") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value ?? "";
}

export const env = {
  appId: required("APP_ID"),
  appSecret: required("APP_SECRET"),
  isProduction: process.env.NODE_ENV === "production",
  databaseUrl: required("DATABASE_URL"),
  kimiAuthUrl: required("KIMI_AUTH_URL"),
  kimiOpenUrl: required("KIMI_OPEN_URL"),
  ownerUnionId: process.env.OWNER_UNION_ID ?? "",
  /** 公网访问地址，例如 https://workbench.example.com。留空时回退到请求头推导的 origin。 */
  appOrigin: (process.env.APP_ORIGIN ?? "").replace(/\/+$/, ""),
};

export const integrationEnv = {
  etsy: {
    clientId: process.env.ETSY_CLIENT_ID ?? "",
    clientSecret: process.env.ETSY_CLIENT_SECRET ?? "",
    /** 可选：固定绑定某个 Etsy shop_id；留空则自动读取授权账号名下的店铺。 */
    shopId: process.env.ETSY_SHOP_ID ?? "",
    redirectUri: process.env.ETSY_REDIRECT_URI ?? "",
  },
  ebay: {
    clientId: process.env.EBAY_CLIENT_ID ?? "",
    clientSecret: process.env.EBAY_CLIENT_SECRET ?? "",
    /** production | sandbox */
    environment: (process.env.EBAY_ENVIRONMENT ?? "production").toLowerCase() === "sandbox" ? "sandbox" : "production",
    /** eBay 把回调地址叫 RuName（Redirect URL name），不是原始 URL。 */
    redirectUri: process.env.EBAY_REDIRECT_URI ?? "",
    marketplaceId: process.env.EBAY_MARKETPLACE_ID ?? "EBAY_AU",
  },
} as const;
