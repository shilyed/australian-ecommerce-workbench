import { z } from "zod";
import type { ValidationIssue, ValidationResult } from "../types";

export const EBAY_CONDITIONS = [
  "NEW",
  "NEW_OTHER",
  "NEW_WITH_DEFECTS",
  "LIKE_NEW",
  "USED_EXCELLENT",
  "USED_VERY_GOOD",
  "USED_GOOD",
  "USED_ACCEPTABLE",
  "FOR_PARTS_OR_NOT_WORKING",
] as const;

const httpsUrl = z
  .string()
  .trim()
  .refine(value => {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, "图片必须是公开可访问的 https:// 地址");

const aspectsSchema = z.record(
  z.string().trim().min(1, "属性名不能为空").max(65),
  z.array(z.string().trim().min(1).max(65)).min(1, "属性至少要有一个值")
);

/** 推送到 eBay 前必须通过的完整校验。 */
export const ebayListingSchema = z.object({
  ebaySku: z
    .string()
    .trim()
    .min(1, "eBay SKU 不能为空")
    .max(50, "eBay SKU 最多 50 个字符")
    .regex(/^[A-Za-z0-9._-]+$/, "eBay SKU 只能包含字母、数字、点、下划线和短横线"),
  title: z.string().trim().min(1, "标题不能为空").max(80, "eBay 标题最多 80 个字符"),
  description: z.string().trim().min(1, "描述不能为空").max(500_000),
  categoryId: z.string().trim().regex(/^\d+$/, "请选择 eBay 叶子类目（数字 ID）"),
  condition: z.enum(EBAY_CONDITIONS, "请选择商品成色"),
  priceAud: z.number("请填写售价").positive("售价必须大于 0").max(1_000_000),
  quantity: z
    .number("请填写可售数量")
    .int("可售数量必须是整数")
    .min(1, "可售数量至少为 1")
    .max(999_999),
  imageUrls: z.array(httpsUrl).min(1, "至少需要 1 张图片").max(12, "eBay 最多 12 张图片"),
  aspects: aspectsSchema,
  packageWeightG: z.number("请填写包裹重量").positive("包裹重量必须大于 0"),
  packageLengthCm: z.number("请填写包裹长度").positive("包裹长度必须大于 0"),
  packageWidthCm: z.number("请填写包裹宽度").positive("包裹宽度必须大于 0"),
  packageHeightCm: z.number("请填写包裹高度").positive("包裹高度必须大于 0"),
  fulfillmentPolicyId: z.string().trim().min(1, "请选择运费政策"),
  paymentPolicyId: z.string().trim().min(1, "请选择付款政策"),
  returnPolicyId: z.string().trim().min(1, "请选择退货政策"),
  merchantLocationKey: z.string().trim().min(1, "请选择发货地点"),
});

export type EbayListingPayload = z.infer<typeof ebayListingSchema>;

/** 本地草稿允许不完整，但字段类型必须正确，避免把脏数据写进数据库。 */
export const ebayDraftSchema = z.object({
  ebaySku: z.string().max(255).optional(),
  title: z.string().max(255).optional(),
  description: z.string().max(500_000).optional(),
  categoryId: z.string().max(32).optional(),
  condition: z.enum(EBAY_CONDITIONS).optional(),
  priceAud: z.number().nonnegative().nullable().optional(),
  quantity: z.number().int().nonnegative().nullable().optional(),
  imageUrls: z.array(z.string().max(2048)).max(24).optional(),
  aspects: z.record(z.string().max(65), z.array(z.string().max(65))).optional(),
  packageWeightG: z.number().nonnegative().nullable().optional(),
  packageLengthCm: z.number().nonnegative().nullable().optional(),
  packageWidthCm: z.number().nonnegative().nullable().optional(),
  packageHeightCm: z.number().nonnegative().nullable().optional(),
  fulfillmentPolicyId: z.string().max(64).optional(),
  paymentPolicyId: z.string().max(64).optional(),
  returnPolicyId: z.string().max(64).optional(),
  merchantLocationKey: z.string().max(64).optional(),
});

export type EbayDraftPayload = z.infer<typeof ebayDraftSchema>;

/** 去掉空属性名、空值，避免空字符串让完整校验误报。 */
export function cleanDraft(draft: EbayDraftPayload): EbayDraftPayload {
  const aspects: Record<string, string[]> = {};
  for (const [name, values] of Object.entries(draft.aspects ?? {})) {
    const key = name.trim();
    const cleaned = values.map(value => value.trim()).filter(Boolean);
    if (key && cleaned.length > 0) aspects[key] = cleaned;
  }
  return {
    ...draft,
    imageUrls: (draft.imageUrls ?? []).map(url => url.trim()).filter(Boolean),
    aspects,
  };
}

export function validateEbayListing(raw: unknown): ValidationResult<EbayListingPayload> {
  const parsed = ebayListingSchema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data, issues: [] };
  const issues: ValidationIssue[] = parsed.error.issues.map(issue => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
  return { ok: false, issues };
}
