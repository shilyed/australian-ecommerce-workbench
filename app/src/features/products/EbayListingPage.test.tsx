import type { User } from "@db/schema";
import type { MarketplaceOptions } from "../../../api/marketplaces/types";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import EbayListingPage from "./EbayListingPage";
import {
  draftFromForm,
  formFromDraft,
  missingRequiredAspects,
  readinessIssues,
} from "./ebay-form";

const fixture = vi.hoisted(() => {
  const user: Pick<User, "role" | "businessRole" | "status"> = {
    role: "admin",
    businessRole: "admin",
    status: "active",
  };
  const options: MarketplaceOptions & { missingScopes: string[] } = {
    fulfillmentPolicies: {
      items: [{ id: "f1", name: "标准运费" }],
      error: null,
    },
    paymentPolicies: { items: [{ id: "p1", name: "在线付款" }], error: null },
    returnPolicies: { items: [{ id: "r1", name: "30 天退货" }], error: null },
    locations: { items: [{ id: "warehouse", name: "澳洲仓库" }], error: null },
    aspects: {
      items: [
        {
          name: "Brand",
          required: true,
          recommended: false,
          mode: "FREE_TEXT",
          multiple: false,
          values: [],
        },
      ],
      error: null,
    },
    categories: { items: [], error: null },
    missingScopes: [],
  };
  return {
    user,
    options,
    pending: "",
    listQuery: vi.fn(),
    detailQuery: vi.fn(),
    optionsQuery: vi.fn(),
    refreshGet: vi.fn(),
    refreshList: vi.fn(),
  };
});

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: fixture.user }) }));
vi.mock("@/providers/trpc", () => {
  const action = (name: string) => ({
    useMutation: () => ({
      mutate: vi.fn(),
      isPending: fixture.pending === name,
    }),
  });
  return {
    trpc: {
      useUtils: () => ({
        marketplace: {
          get: { invalidate: fixture.refreshGet },
          list: { invalidate: fixture.refreshList },
        },
      }),
      marketplace: {
        list: { useQuery: fixture.listQuery },
        get: { useQuery: fixture.detailQuery },
        getOptions: { useQuery: fixture.optionsQuery },
        saveDraft: action("save"),
        push: action("push"),
        publish: action("publish"),
        unpublish: action("unpublish"),
      },
    },
  };
});

const payload = {
  ebaySku: "TEST-4",
  title: "Insulated Tumbler",
  description: "<p>Stainless steel tumbler.</p>",
  categoryId: "20625",
  condition: "NEW" as const,
  priceAud: 29.9,
  quantity: 3,
  imageUrls: ["https://example.com/tumbler.jpg"],
  aspects: { Brand: ["Unbranded"] },
  packageWeightG: 420,
  packageLengthCm: 12,
  packageWidthCm: 12,
  packageHeightCm: 22,
  fulfillmentPolicyId: "f1",
  paymentPolicyId: "p1",
  returnPolicyId: "r1",
  merchantLocationKey: "warehouse",
};

const listing = {
  id: 7,
  skuId: 4,
  platform: "ebay",
  storeConnectionId: 1,
  status: "ready",
  platformSku: "TEST-4",
  localPayload: payload,
  lastPushedPayload: payload,
  hasUnpushedChanges: false,
  externalOfferId: "offer-1",
  externalListingId: null as string | null,
  listingUrl: null as string | null,
  lastPushedAt: new Date("2026-10-22T00:00:00Z"),
  lastError: null as string | null,
};
const detail = {
  listing,
  sku: { id: 4, code: "TEST-4", name: "保温杯", productName: "不锈钢保温杯" },
  store: { id: 1, shopName: "澳洲测试店" },
  canWriteToPlatform: true,
  marketplaceId: "EBAY_AU",
};

function render(url = "/products/4/marketplaces/ebay") {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/products/:skuId/marketplaces/ebay"
          element={<EbayListingPage />}
        />
      </Routes>
    </MemoryRouter>
  );
}

function expectButton(html: string, label: string, enabled: boolean) {
  const button = html.match(
    new RegExp(`<button\\b[^>]*>${label}</button>`)
  )?.[0];
  expect(button, label).toBeDefined();
  expect(button?.includes('disabled=""'), label).toBe(!enabled);
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(fixture.user, {
    role: "admin",
    businessRole: "admin",
    status: "active",
  });
  fixture.pending = "";
  Object.assign(listing, {
    status: "ready",
    localPayload: payload,
    hasUnpushedChanges: false,
    externalListingId: null,
    listingUrl: null,
    lastError: null,
  });
  detail.canWriteToPlatform = true;
  fixture.options.missingScopes = [];
  fixture.options.aspects.items = [
    {
      name: "Brand",
      required: true,
      recommended: false,
      mode: "FREE_TEXT",
      multiple: false,
      values: [],
    },
  ];
  fixture.options.aspects.error = null;
  fixture.options.fulfillmentPolicies = {
    items: [{ id: "f1", name: "标准运费" }],
    error: null,
  };
  fixture.listQuery.mockReturnValue({
    data: { listings: [listing] },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
  fixture.detailQuery.mockReturnValue({
    data: detail,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
  fixture.optionsQuery.mockReturnValue({
    data: fixture.options,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  });
});

describe("eBay listing page", () => {
  it("removes generic tutorials but retains the live-listing update warning", () => {
    expect(render()).not.toContain("管理员和运营可编辑、保存草稿");
    listing.status = "published";
    expect(render()).toContain("更新会立即修改在售商品");
  });
  it("loads the SKU listing before fetching its detail and renders every listing field", () => {
    const html = render();
    expect(fixture.listQuery).toHaveBeenCalledWith(
      { skuId: 4 },
      expect.objectContaining({ enabled: true })
    );
    expect(fixture.detailQuery).toHaveBeenCalledWith(
      { listingId: 7 },
      expect.objectContaining({ enabled: true })
    );
    expect(fixture.optionsQuery).toHaveBeenCalledWith(
      { storeConnectionId: 1, categoryId: "20625", categoryQuery: undefined },
      expect.objectContaining({ enabled: true })
    );
    for (const name of [
      "ebaySku",
      "title",
      "description",
      "condition",
      "categoryId",
      "priceAud",
      "quantity",
      "imageUrls",
      "packageWeightG",
      "packageLengthCm",
      "packageWidthCm",
      "packageHeightCm",
    ])
      expect(html).toContain(`name="${name}"`);
    for (const label of [
      "运费政策",
      "付款政策",
      "退货政策",
      "发货地点",
      "类目必填属性",
      "Brand",
    ])
      expect(html).toContain(label);
    expect(html).toContain('maxLength="80"');
    expect(html).toContain(" / 80 字符");
    expect(html).toContain('href="/products/4"');
    expect(html).not.toContain("<p>Stainless steel tumbler.</p>");
    expectButton(html, "保存草稿", true);
    expectButton(html, "更新到 eBay", true);
    expectButton(html, "核对并发布", true);
    expectButton(html, "下架", false);
  });

  it("allows operations to save drafts but not perform platform writes", () => {
    Object.assign(fixture.user, { role: "user", businessRole: "operations" });
    const html = render();
    expect(html).not.toMatch(/<fieldset[^>]*disabled=/);
    expectButton(html, "保存草稿", true);
    expectButton(html, "更新到 eBay", false);
    expectButton(html, "核对并发布", false);
    expectButton(html, "下架", false);
  });

  it.each(["fulfillment", "finance"] as const)(
    "keeps %s members read-only without calling editor-only options",
    businessRole => {
      Object.assign(fixture.user, { role: "user", businessRole });
      const html = render();
      expect(html).toMatch(/<fieldset[^>]*disabled=""/);
      expectButton(html, "保存草稿", false);
      expectButton(html, "更新到 eBay", false);
      expectButton(html, "核对并发布", false);
      expectButton(html, "下架", false);
      expect(fixture.optionsQuery).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ enabled: false })
      );
    }
  );

  it("does not let disabled administrators save or write to eBay", () => {
    fixture.user.status = "disabled";
    const html = render();
    expect(html).toMatch(/<fieldset[^>]*disabled=""/);
    expectButton(html, "保存草稿", false);
    expectButton(html, "更新到 eBay", false);
  });

  it("requires saved changes to be pushed before publication", () => {
    listing.hasUnpushedChanges = true;
    const html = render();
    expect(html).toContain("尚未推送到 eBay");
    expectButton(html, "更新到 eBay", true);
    expectButton(html, "核对并发布", false);
  });

  it("shows missing fields and required category aspects and blocks platform writes", () => {
    listing.localPayload = { ...payload, description: "", imageUrls: [] };
    fixture.options.aspects.items.push({
      name: "Colour",
      required: true,
      recommended: false,
      mode: "FREE_TEXT",
      multiple: false,
      values: [],
    });
    const html = render();
    expect(html).toContain("至少 1 张图片");
    expect(html).toContain("类目必填属性：Colour");
    expectButton(html, "保存草稿", true);
    expectButton(html, "更新到 eBay", false);
    expectButton(html, "核对并发布", false);
  });

  it("explains missing scopes and retains local draft access", () => {
    detail.canWriteToPlatform = false;
    fixture.options.missingScopes = [
      "https://api.ebay.com/oauth/api_scope/sell.inventory",
    ];
    const html = render();
    expect(html).toContain("设置 → 店铺连接");
    expect(html).toContain("重新授权 eBay");
    expect(html).toContain("sell.inventory");
    expectButton(html, "保存草稿", true);
    expectButton(html, "更新到 eBay", false);
    expectButton(html, "核对并发布", false);
  });

  it("surfaces partial option failures without losing an already saved policy", () => {
    fixture.options.fulfillmentPolicies = {
      items: [],
      error: "读取运费政策失败（HTTP 403）",
    };
    const html = render();
    expect(html).toContain("读取运费政策失败（HTTP 403）");
    expect(html).toContain("已保存：f1（当前列表未返回）");
    expect(html).toContain('value="f1" selected=""');
  });

  it("blocks updates while required category metadata is unavailable", () => {
    fixture.options.aspects.error = "类目属性权限不足";
    const html = render();
    expect(html).toContain("类目属性权限不足");
    expectButton(html, "更新到 eBay", false);
    expectButton(html, "核对并发布", false);
  });

  it("shows a live listing link and error, allows withdrawal and prevents duplicate publication", () => {
    Object.assign(listing, {
      status: "published",
      externalListingId: "1234567890",
      listingUrl: "https://www.ebay.com.au/itm/1234567890",
      lastError: "eBay 提示：请检查图片",
    });
    const html = render();
    expect(html).toContain('href="https://www.ebay.com.au/itm/1234567890"');
    expect(html).toContain("eBay 提示：请检查图片");
    expectButton(html, "核对并发布", false);
    expectButton(html, "下架", true);
  });

  it("keeps draft data visible but blocks platform writes after a failed refresh", () => {
    fixture.detailQuery.mockReturnValue({
      data: detail,
      isLoading: false,
      error: new Error("连接中断"),
      refetch: vi.fn(),
    });
    const html = render();
    expect(html).toContain("读取最新状态失败：连接中断");
    expect(html).toContain('value="TEST-4"');
    expectButton(html, "更新到 eBay", false);
    expectButton(html, "核对并发布", false);
  });

  it("disables editing and all actions while an operation is pending", () => {
    fixture.pending = "push";
    const html = render();
    expect(html).toMatch(/<fieldset[^>]*disabled=""/);
    expectButton(html, "保存草稿", false);
    expectButton(html, "更新中…", false);
    expectButton(html, "核对并发布", false);
    expectButton(html, "下架", false);
  });

  it("rejects invalid route IDs without requesting a listing", () => {
    const html = render("/products/not-a-number/marketplaces/ebay");
    expect(html).toContain("商品编号无效");
    expect(fixture.listQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ enabled: false })
    );
  });

  it("sends missing listings back to the master product instead of creating one silently", () => {
    fixture.listQuery.mockReturnValue({
      data: { listings: [] },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    const html = render();
    expect(html).toContain("尚未创建 eBay 详情");
    expect(html).toContain('href="/products/4"');
    expect(fixture.detailQuery).toHaveBeenCalledWith(
      { listingId: 0 },
      expect.objectContaining({ enabled: false })
    );
  });

  it("shows a retry action when loading the listing fails", () => {
    fixture.detailQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("刊登不存在"),
      refetch: vi.fn(),
    });
    const html = render();
    expect(html).toContain("eBay 详情加载失败");
    expect(html).toContain("刊登不存在");
    expectButton(html, "重试", true);
  });
});

describe("reused eBay form conversions", () => {
  it("round-trips all fields and retains empty numbers in incomplete drafts", () => {
    expect(draftFromForm(formFromDraft(payload))).toEqual(payload);
    const incomplete = draftFromForm(formFromDraft({}));
    expect(incomplete.priceAud).toBeNull();
    expect(incomplete.quantity).toBeNull();
    expect(incomplete.packageWeightG).toBeNull();
    expect(readinessIssues(incomplete)).toContain("eBay SKU");
  });

  it("splits image lines and aspect values and reports missing required aspects", () => {
    const form = formFromDraft(payload);
    form.imageUrls =
      "https://example.com/a.jpg\r\n \nhttps://example.com/b.jpg";
    form.aspects = [
      { name: " Material ", values: "Steel; Plastic； " },
      { name: "", values: "" },
    ];
    const draft = draftFromForm(form);
    expect(draft.imageUrls).toEqual([
      "https://example.com/a.jpg",
      "https://example.com/b.jpg",
    ]);
    expect(draft.aspects).toEqual({ Material: ["Steel", "Plastic"] });
    expect(missingRequiredAspects(draft, ["material", "Brand"])).toEqual([
      "Brand",
    ]);
  });
});
