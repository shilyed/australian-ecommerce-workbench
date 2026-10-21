import "dotenv/config";
import path from "node:path";

function required(name: string): string {
  const value = process.env[name];
  if (!value && process.env.NODE_ENV === "production") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value ?? "";
}

const appSecret = required("APP_SECRET");
if (process.env.NODE_ENV === "production" && appSecret.length < 32) {
  throw new Error("APP_SECRET 至少需要 32 个字符，请使用随机密钥");
}

export const env = {
  appSecret,
  isProduction: process.env.NODE_ENV === "production",
  databaseUrl: required("DATABASE_URL"),
  /** 公网访问地址，例如 https://workbench.example.com。留空时回退到请求头推导的 origin。 */
  appOrigin: (process.env.APP_ORIGIN ?? "").replace(/\/+$/, ""),
  /** 首次启动创建管理员；账号表已有数据后不会再使用。 */
  adminEmail: process.env.ADMIN_EMAIL ?? "",
  adminPassword: process.env.ADMIN_PASSWORD ?? "",
  adminName: process.env.ADMIN_NAME ?? "管理员",
  /** 自托管附件目录；容器中建议挂载持久卷。 */
  storageDir:
    process.env.STORAGE_DIR ?? path.resolve(process.cwd(), "data/uploads"),
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
    environment:
      (process.env.EBAY_ENVIRONMENT ?? "production").toLowerCase() === "sandbox"
        ? "sandbox"
        : "production",
    /** eBay 把回调地址叫 RuName（Redirect URL name），不是原始 URL。 */
    redirectUri: process.env.EBAY_REDIRECT_URI ?? "",
    marketplaceId: process.env.EBAY_MARKETPLACE_ID ?? "EBAY_AU",
    /** eBay 强制要求的生产应用用户数据删除通知端点及其验证令牌。 */
    deletionEndpoint: process.env.EBAY_DELETION_ENDPOINT ?? "",
    verificationToken: process.env.EBAY_VERIFICATION_TOKEN ?? "",
  },
} as const;
