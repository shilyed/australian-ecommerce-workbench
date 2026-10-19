export type IntegrationPlatform = "etsy" | "ebay";

export type StoreProfile = {
  platform: IntegrationPlatform;
  /** 平台侧稳定账号标识：Etsy user_id / eBay userId，用于去重。 */
  accountId: string;
  accountLabel: string | null;
  shopName: string;
  shopUrl: string | null;
  currency: string | null;
  country: string | null;
  listingCount: number | null;
  orderCount: number | null;
  soldCount: number | null;
  reviewCount: number | null;
  reviewAverage: number | null;
  sellingLimitAmount: number | null;
  sellingLimitQuantity: number | null;
  sellingLimitCurrency: string | null;
  vacation: boolean | null;
  marketplace: string | null;
  fetchedAt: string;
  /** 部分指标读取失败时的真实说明，前端原样展示，不伪装成功。 */
  notes: string[];
};

export type TokenSet = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
  scopes: string[];
  tokenType: string;
};

export type ProviderInfo = {
  platform: IntegrationPlatform;
  configured: boolean;
  missing: string[];
  redirectUri: string | null;
  scopes: string[];
  docsUrl: string;
  notes: string[];
};

export class IntegrationError extends Error {
  readonly status?: number;
  readonly detail?: string;

  constructor(message: string, status?: number, detail?: string) {
    super(message);
    this.name = "IntegrationError";
    this.status = status;
    this.detail = detail;
  }
}
