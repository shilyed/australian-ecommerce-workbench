export type MarketplacePlatform = "ebay" | "etsy" | "amazon";

export type ValidationIssue = { path: string; message: string };

export type ValidationResult<T> =
  | { ok: true; data: T; issues: [] }
  | { ok: false; issues: ValidationIssue[] };

export type PolicyOption = { id: string; name: string; description?: string | null };

export type AspectOption = {
  name: string;
  required: boolean;
  recommended: boolean;
  mode: "FREE_TEXT" | "SELECTION_ONLY";
  multiple: boolean;
  values: string[];
};

export type CategorySuggestion = { id: string; name: string; path: string };

export type OptionsSection<T> = { items: T[]; error: string | null };

export type MarketplaceOptions = {
  fulfillmentPolicies: OptionsSection<PolicyOption>;
  paymentPolicies: OptionsSection<PolicyOption>;
  returnPolicies: OptionsSection<PolicyOption>;
  locations: OptionsSection<PolicyOption>;
  aspects: OptionsSection<AspectOption>;
  categories: OptionsSection<CategorySuggestion>;
};

export type PushResult = { offerId: string; inventoryWritten: true };
export type PublishResult = { listingId: string; warnings: string[] };

/** 每个市场一个适配器；工作台只依赖这个接口，不直接拼平台请求。 */
export interface MarketplaceAdapter<TPayload> {
  validate(raw: unknown): ValidationResult<TPayload>;
  createOrUpdate(payload: TPayload, existingOfferId: string | null): Promise<PushResult>;
  publish(offerId: string): Promise<PublishResult>;
  unpublish(offerId: string): Promise<PublishResult>;
  fetchOptions(input: { categoryId?: string; categoryQuery?: string }): Promise<MarketplaceOptions>;
}
