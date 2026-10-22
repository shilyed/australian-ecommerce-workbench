export const EBAY_CONDITION_OPTIONS = [
  { value: "NEW", label: "全新" },
  { value: "NEW_OTHER", label: "全新（无原包装）" },
  { value: "NEW_WITH_DEFECTS", label: "全新（有瑕疵）" },
  { value: "LIKE_NEW", label: "几乎全新" },
  { value: "USED_EXCELLENT", label: "二手 · 极好" },
  { value: "USED_VERY_GOOD", label: "二手 · 很好" },
  { value: "USED_GOOD", label: "二手 · 良好" },
  { value: "USED_ACCEPTABLE", label: "二手 · 可接受" },
  { value: "FOR_PARTS_OR_NOT_WORKING", label: "零件 / 不可用" },
] as const;

export type EbayCondition = (typeof EBAY_CONDITION_OPTIONS)[number]["value"];

/** 与后端 ebayDraftSchema 对齐的草稿结构。 */
export type EbayDraft = {
  ebaySku?: string;
  title?: string;
  description?: string;
  categoryId?: string;
  condition?: EbayCondition;
  priceAud?: number | null;
  quantity?: number | null;
  imageUrls?: string[];
  aspects?: Record<string, string[]>;
  packageWeightG?: number | null;
  packageLengthCm?: number | null;
  packageWidthCm?: number | null;
  packageHeightCm?: number | null;
  fulfillmentPolicyId?: string;
  paymentPolicyId?: string;
  returnPolicyId?: string;
  merchantLocationKey?: string;
};

export type AspectRow = { name: string; values: string };

/** 表单里全部用字符串，避免输入过程中被强制转换。 */
export type EbayForm = {
  ebaySku: string;
  title: string;
  description: string;
  categoryId: string;
  condition: EbayCondition;
  priceAud: string;
  quantity: string;
  imageUrls: string;
  aspects: AspectRow[];
  packageWeightG: string;
  packageLengthCm: string;
  packageWidthCm: string;
  packageHeightCm: string;
  fulfillmentPolicyId: string;
  paymentPolicyId: string;
  returnPolicyId: string;
  merchantLocationKey: string;
};

const numText = (value: number | null | undefined) =>
  value === null || value === undefined ? "" : String(value);

const toNumber = (value: string, integer = false) => {
  const text = value.trim();
  if (!text) return null;
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return integer ? Math.trunc(parsed) : parsed;
};

export function formFromDraft(draft: EbayDraft): EbayForm {
  return {
    ebaySku: draft.ebaySku ?? "",
    title: draft.title ?? "",
    description: draft.description ?? "",
    categoryId: draft.categoryId ?? "",
    condition: draft.condition ?? "NEW",
    priceAud: numText(draft.priceAud),
    quantity: numText(draft.quantity),
    imageUrls: (draft.imageUrls ?? []).join("\n"),
    aspects: Object.entries(draft.aspects ?? {}).map(([name, values]) => ({
      name,
      values: values.join("; "),
    })),
    packageWeightG: numText(draft.packageWeightG),
    packageLengthCm: numText(draft.packageLengthCm),
    packageWidthCm: numText(draft.packageWidthCm),
    packageHeightCm: numText(draft.packageHeightCm),
    fulfillmentPolicyId: draft.fulfillmentPolicyId ?? "",
    paymentPolicyId: draft.paymentPolicyId ?? "",
    returnPolicyId: draft.returnPolicyId ?? "",
    merchantLocationKey: draft.merchantLocationKey ?? "",
  };
}

export function draftFromForm(form: EbayForm): EbayDraft {
  const aspects: Record<string, string[]> = {};
  for (const row of form.aspects) {
    const name = row.name.trim();
    const values = row.values
      .split(/[;；]/)
      .map(value => value.trim())
      .filter(Boolean);
    if (name && values.length > 0) aspects[name] = values;
  }
  return {
    ebaySku: form.ebaySku.trim(),
    title: form.title.trim(),
    description: form.description,
    categoryId: form.categoryId.trim(),
    condition: form.condition,
    priceAud: toNumber(form.priceAud),
    quantity: toNumber(form.quantity, true),
    imageUrls: form.imageUrls
      .split(/\r?\n/)
      .map(url => url.trim())
      .filter(Boolean),
    aspects,
    packageWeightG: toNumber(form.packageWeightG),
    packageLengthCm: toNumber(form.packageLengthCm),
    packageWidthCm: toNumber(form.packageWidthCm),
    packageHeightCm: toNumber(form.packageHeightCm),
    fulfillmentPolicyId: form.fulfillmentPolicyId,
    paymentPolicyId: form.paymentPolicyId,
    returnPolicyId: form.returnPolicyId,
    merchantLocationKey: form.merchantLocationKey,
  };
}

/** 推送前在浏览器里先做一遍检查，减少无效请求；最终以服务端校验为准。 */
export function readinessIssues(draft: EbayDraft): string[] {
  const issues: string[] = [];
  if (!draft.ebaySku) issues.push("eBay SKU");
  else if (!/^[A-Za-z0-9._-]{1,50}$/.test(draft.ebaySku)) issues.push("eBay SKU 格式（字母、数字、._-，最多 50 位）");
  if (!draft.title) issues.push("标题");
  else if (draft.title.length > 80) issues.push("标题不超过 80 个字符");
  if (!draft.description?.trim()) issues.push("描述");
  if (!/^\d+$/.test(draft.categoryId ?? "")) issues.push("eBay 类目");
  if (!draft.priceAud || draft.priceAud <= 0) issues.push("售价");
  if (!draft.quantity || draft.quantity < 1) issues.push("可售数量");
  const images = draft.imageUrls ?? [];
  if (images.length === 0) issues.push("至少 1 张图片");
  if (images.length > 12) issues.push("图片最多 12 张");
  if (images.some(url => !url.startsWith("https://"))) issues.push("图片必须是 https:// 地址");
  if (!draft.packageWeightG) issues.push("包裹重量");
  if (!draft.packageLengthCm || !draft.packageWidthCm || !draft.packageHeightCm) issues.push("包裹尺寸");
  if (!draft.fulfillmentPolicyId) issues.push("运费政策");
  if (!draft.paymentPolicyId) issues.push("付款政策");
  if (!draft.returnPolicyId) issues.push("退货政策");
  if (!draft.merchantLocationKey) issues.push("发货地点");
  return issues;
}

export function missingRequiredAspects(draft: EbayDraft, required: string[]) {
  const names = new Set(Object.keys(draft.aspects ?? {}).map(name => name.toLowerCase()));
  return required.filter(name => !names.has(name.toLowerCase()));
}
