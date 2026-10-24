import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { can } from "../../../api/modules/workbench/permissions";
import SourcingPage from "./SourcingPage";
import { CandidateForm, OperationForm, SupplierForm } from "./SourcingForms";
import {
  candidateInput,
  canManageSourcing,
  complianceInput,
  conversionInput,
  filterCandidates,
  sourcingSummary,
  statusInput,
  supplierInput,
  type Candidate,
  type SourcingActor,
  type Supplier,
} from "./sourcing-model";

const fixture = vi.hoisted(() => {
  const candidates: Candidate[] = [];
  const suppliers: Supplier[] = [];
  const currentUser: SourcingActor = {
    role: "admin",
    businessRole: "admin",
    status: "active",
  };
  return {
    candidates,
    suppliers,
    currentUser,
    loading: false,
    error: null as Error | null,
    available: true,
    pending: "",
  };
});

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    data: fixture.available ? fixture : undefined,
    isLoading: fixture.loading,
    isFetching: false,
    error: fixture.error,
    refresh: vi.fn(),
    refetch: vi.fn(),
  }),
}));
vi.mock("@/providers/trpc", () => {
  const action = (name: string) => ({
    useMutation: () => ({
      mutate: vi.fn(),
      reset: vi.fn(),
      error: null,
      isPending: fixture.pending === name,
    }),
  });
  return {
    trpc: {
      workbench: {
        createSupplier: action("supplier"),
        createCandidate: action("candidate"),
        updateCandidateStatus: action("status"),
        setCandidateCompliance: action("compliance"),
        convertCandidate: action("convert"),
      },
    },
  };
});

const supplier: Supplier = {
  id: 1,
  name: "测试陶瓷供应商",
  shopUrl: "https://example.com/supplier",
  contactName: "测试联系人",
  contactInfo: "仅用于测试",
  notes: "核对交期",
  createdAt: new Date("2026-10-20T00:00:00Z"),
  updatedAt: new Date("2026-10-22T00:00:00Z"),
};

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: 7,
    name: "测试青花陶瓷杯",
    sourceUrl: "https://detail.1688.com/offer/123456.html",
    supplierId: supplier.id,
    spec: "蓝色 / 350mL",
    currency: "CNY",
    quote: "18.80",
    moq: null,
    leadTimeDays: null,
    weight: null,
    weightUnit: "g",
    dimensions: null,
    packaging: null,
    referencePrice: null,
    sampleCost: null,
    status: "candidate",
    sampleScore: null,
    sampleReview: null,
    decisionNote: null,
    etsyStatus: "pending",
    ebayStatus: "pending",
    complianceBasis: null,
    complianceCheckedAt: null,
    confirmedById: null,
    attachmentKeys: null,
    convertedSkuId: null,
    operatorId: 1,
    createdAt: new Date("2026-10-20T00:00:00Z"),
    updatedAt: new Date("2026-10-22T00:00:00Z"),
    supplier,
    convertedSku: null,
    ...overrides,
  };
}

const render = (url = "/sourcing") =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={[url]}>
      <SourcingPage />
    </MemoryRouter>
  );
const formProps = {
  onSubmit: vi.fn(),
  onChange: vi.fn(),
  onCancel: vi.fn(),
  pending: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  fixture.candidates.splice(
    0,
    fixture.candidates.length,
    candidate(),
    candidate({
      id: 8,
      name: "样品测试杯",
      spec: "白色",
      status: "sample_evaluation",
      sampleScore: 0,
    }),
    candidate({
      id: 9,
      name: "已采用测试杯",
      status: "adopted",
      convertedSkuId: 90,
    })
  );
  fixture.suppliers.splice(0, fixture.suppliers.length, supplier);
  Object.assign(fixture.currentUser, {
    role: "admin",
    businessRole: "admin",
    status: "active",
  });
  fixture.loading = false;
  fixture.error = null;
  fixture.available = true;
  fixture.pending = "";
});

describe("Nike-inspired sourcing workspace", () => {
  it("keeps the working list primary and creation forms out of the initial page", () => {
    const html = render();
    expect(html).toContain("测试青花陶瓷杯");
    expect(html).toContain("候选清单");
    expect(html).toContain("新增候选");
    expect(html).toContain('aria-label="搜索候选"');
    expect(html).toContain('href="https://detail.1688.com/offer/123456.html"');
    expect(html).not.toContain('name="quote"');
    expect(html).not.toContain('name="shopUrl"');
    expect(html).toContain("样品 0 / 100");
    expect(html).toContain("样品评分不是合规证明");
  });

  it("restores status, supplier, converted, and search filters from the URL", () => {
    const html = render("/sourcing?status=sample_evaluation&q=白色&supplier=1");
    expect(html).toContain("样品测试杯");
    expect(html).not.toContain("测试青花陶瓷杯");
    expect(html).toContain("显示 1 / 3 个候选");
    const converted = render("/sourcing?converted=1");
    expect(converted).toContain("已采用测试杯");
    expect(converted).not.toContain("样品测试杯");
  });

  it("makes suppliers browsable without showing candidate creation fields", () => {
    const html = render("/sourcing?view=suppliers");
    expect(html).toContain('aria-label="供应商清单"');
    expect(html).toContain("测试陶瓷供应商");
    expect(html).toContain("测试联系人");
    expect(html).not.toContain("测试青花陶瓷杯");
    expect(html).not.toContain('name="sourceUrl"');
  });

  it("distinguishes no matches, an initial workspace, and a failed load", () => {
    expect(render("/sourcing?q=does-not-exist")).toContain("没有找到匹配候选");
    fixture.candidates.length = 0;
    fixture.suppliers.length = 0;
    expect(render()).toContain("先登记供应商");
    fixture.available = false;
    fixture.error = new Error("读取失败，请稍后重试");
    const html = render();
    expect(html).toContain("选品数据加载失败");
    expect(html).toContain("读取失败，请稍后重试");
    expect(html).not.toContain("选品概览");
  });

  it("keeps stale data visible with an explicit refresh error", () => {
    fixture.error = new Error("网络中断");
    const html = render();
    expect(html).toContain("上次成功读取的数据");
    expect(html).toContain("测试青花陶瓷杯");
  });

  it("prevents read-only roles from starting creation", () => {
    Object.assign(fixture.currentUser, {
      role: "user",
      businessRole: "finance",
    });
    const html = render();
    expect(html).toContain("当前角色仅可浏览");
    const buttons = [
      ...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g),
    ].map(match => match[0]);
    expect(buttons.find(button => button.includes("新增候选"))).toContain(
      'disabled=""'
    );
    expect(buttons.find(button => button.includes("新增供应商"))).toContain(
      'disabled=""'
    );
  });
});

describe("sourcing form and mutation compatibility", () => {
  it("renders all existing candidate fields with native validation and no prefilled business data", () => {
    const html = renderToStaticMarkup(
      <CandidateForm {...formProps} suppliers={[supplier]} />
    );
    for (const name of [
      "name",
      "sourceUrl",
      "supplierId",
      "spec",
      "quote",
      "referencePrice",
      "moq",
      "leadTimeDays",
      "notes",
    ]) {
      expect(html).toContain(`name="${name}"`);
    }
    expect(html).toContain('type="url"');
    expect(html).toContain('step="0.01"');
    expect(html).toMatch(/<option(?=[^>]*value="")(?=[^>]*selected="")[^>]*>/);
    expect(html).toContain("创建候选不会自动采购或上架");
  });

  it("shows save errors and disables fields and actions while pending", () => {
    const html = renderToStaticMarkup(
      <SupplierForm {...formProps} pending error="供应商保存失败" />
    );
    expect(html).toMatch(/<fieldset[^>]*disabled=""/);
    expect(html).toContain('role="alert"');
    expect(html).toContain("供应商保存失败");
    expect(html).toContain("保存中");
    for (const name of [
      "name",
      "shopUrl",
      "contactName",
      "contactInfo",
      "notes",
    ])
      expect(html).toContain(`name="${name}"`);
  });

  it("uses explicit decision forms instead of treating platform judgment as platform approval", () => {
    const html = renderToStaticMarkup(
      <OperationForm
        {...formProps}
        operation={{
          kind: "compliance",
          candidate: candidate(),
          platform: "etsy",
        }}
      />
    );
    expect(html).toContain('name="basis"');
    expect(html).toContain('minLength="3"');
    expect(html).toContain("不代表平台审核通过");
    const convert = renderToStaticMarkup(
      <OperationForm
        {...formProps}
        operation={{ kind: "convert", candidate: candidate() }}
      />
    );
    expect(convert).toContain('name="skuCode"');
    expect(convert).toContain('value="AU-0007"');
    expect(convert).toContain('name="decisionNote"');
    expect(convert).toContain("不会自动采购");
  });

  it("preserves creation payloads including optional and zero-valued prices", () => {
    const form = new FormData();
    Object.entries({
      name: " 测试商品 ",
      sourceUrl: "https://example.com/item",
      supplierId: "1",
      spec: "白色",
      quote: "0",
      referencePrice: "0",
      notes: "保留备注",
    }).forEach(([key, value]) => form.set(key, value));
    expect(candidateInput(form)).toEqual({
      name: "测试商品",
      sourceUrl: "https://example.com/item",
      supplierId: 1,
      spec: "白色",
      quote: "0",
      referencePrice: "0",
      moq: undefined,
      leadTimeDays: undefined,
      notes: "保留备注",
    });
    const supplierForm = new FormData();
    supplierForm.set("name", "测试供应商");
    supplierForm.set("notes", "异常记录");
    expect(supplierInput(supplierForm)).toEqual({
      name: "测试供应商",
      shopUrl: "",
      contactName: "",
      contactInfo: "",
      notes: "异常记录",
    });
  });

  it("preserves status progression, sample evidence, platform isolation, and conversion inputs", () => {
    const form = new FormData();
    form.set("decisionNote", "负责人确认");
    form.set("basis", "已核对产品安全资料");
    form.set("skuCode", "TEST-007");
    const row = candidate({ sampleScore: 0, sampleReview: "保留原评估" });
    expect(statusInput(row, form)).toEqual({
      id: 7,
      status: "sample_evaluation",
      sampleScore: 0,
      sampleReview: "保留原评估",
      decisionNote: "负责人确认",
    });
    expect(
      statusInput(candidate({ status: "sample_evaluation" }), form).status
    ).toBe("pending_decision");
    expect(complianceInput(row, "ebay", form)).toEqual({
      id: 7,
      platform: "ebay",
      conclusion: "approved",
      basis: "已核对产品安全资料",
    });
    expect(conversionInput(row, form)).toEqual({
      candidateId: 7,
      skuCode: "TEST-007",
      decisionNote: "负责人确认",
    });
  });
});

describe("sourcing filters, counts, and roles", () => {
  it("filters exact supplier IDs and searches specifications without changing source order", () => {
    const rows = fixture.candidates;
    const result = filterCandidates(rows, {
      query: "  350ML  ",
      status: "all",
      supplierId: 1,
      convertedOnly: false,
    });
    expect(result.map(item => item.id)).toEqual([7, 9]);
    expect(rows.map(item => item.id)).toEqual([7, 8, 9]);
    expect(
      filterCandidates(rows, {
        query: "",
        status: "all",
        supplierId: 999,
        convertedOnly: false,
      })
    ).toEqual([]);
  });

  it("counts actual converted IDs and uses the latest recorded compliance check", () => {
    const latest = new Date("2026-10-24T00:00:00Z");
    const result = sourcingSummary([
      candidate({ complianceCheckedAt: new Date("2026-10-20T00:00:00Z") }),
      candidate({
        id: 8,
        status: "sample_evaluation",
        complianceCheckedAt: latest,
      }),
      candidate({ id: 9, status: "pending_decision", convertedSkuId: 90 }),
    ]);
    expect(result).toEqual({
      total: 3,
      evaluating: 1,
      deciding: 1,
      converted: 1,
      lastChecked: latest,
    });
  });

  it("matches existing backend write-role rules and excludes disabled users", () => {
    const roles = ["admin", "operations", "fulfillment", "finance"] as const;
    for (const businessRole of roles) {
      const user: SourcingActor = {
        role: "user",
        businessRole,
        status: "active",
      };
      expect(canManageSourcing(user)).toBe(can(user, "sourcing", true));
    }
    expect(
      canManageSourcing({
        role: "admin",
        businessRole: "admin",
        status: "disabled",
      })
    ).toBe(false);
  });
});
