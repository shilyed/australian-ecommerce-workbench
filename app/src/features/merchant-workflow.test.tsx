import { type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import OverviewPage from "./overview/OverviewPage";
import OrdersPage from "./orders/OrdersPage";
import FulfillmentPage from "./fulfillment/FulfillmentPage";
import CatalogPage from "./catalog/CatalogPage";
import PurchasingPage from "./purchasing/PurchasingPage";
import FinancePage from "./finance/FinancePage";

const fixture = vi.hoisted(() => {
  const sku = {
    id: 4,
    code: "TEST-4",
    name: "Test item",
    spec: "Blue",
    alertThreshold: 2,
    status: "active",
  };
  return {
    currentUser: { id: 1 },
    permissions: { finance: false, settings: false },
    members: [{ id: 1, name: "Owner", status: "active" }],
    stores: [],
    suppliers: [],
    listings: [],
    purchaseOrders: [],
    report: [],
    costs: [],
    exchangeRates: [],
    settlements: [],
    tasks: [],
    skus: [sku],
    inventory: [
      {
        sku,
        position: { qualifiedQty: 5, reservedQty: 5, shortageQty: 2 },
        lots: [],
        ledger: [],
      },
    ],
    orders: [
      {
        id: 42,
        orderNo: "TEST-42",
        externalOrderId: "external-42",
        externalShopId: "shop",
        platform: "etsy",
        destinationCountry: "AU",
        currency: "AUD",
        total: "50",
        subtotal: "50",
        shippingPaid: "0",
        discount: "0",
        rawStatus: "paid",
        paymentStatus: "paid",
        internalStatus: "picking",
        fulfillmentStatus: "unshipped",
        afterSalesStatus: "none",
        orderedAt: new Date(),
        shipBy: null,
        internalShipBy: null,
        owner: null,
        lines: [
          {
            id: 7,
            title: "Test item",
            skuId: 4,
            sku,
            quantity: 5,
            allocatedQty: 5,
            shippedQty: 0,
            shortageQty: 0,
          },
        ],
        shipments: [
          { status: "draft", lines: [{ salesOrderLineId: 7, quantity: 1 }] },
        ],
      },
    ],
    shipments: [
      {
        id: 10,
        salesOrderId: 42,
        packageNo: "TEST-42-P01",
        status: "draft",
        order: { orderNo: "TEST-42" },
        lines: [{ salesOrderLineId: 7, quantity: 1 }],
        createdAt: new Date(),
        currency: "AUD",
        carrier: "Test carrier",
        service: "Standard",
      },
    ],
    afterSales: [
      {
        id: 20,
        salesOrderId: 42,
        type: "return_refund",
        status: "pending",
        refundStatus: "pending",
        returnStatus: "awaiting",
        currency: "AUD",
        amount: "10",
        order: { orderNo: "TEST-42" },
      },
    ],
  };
});

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    data: fixture,
    isLoading: false,
    error: null,
    refresh: vi.fn(),
    refetch: vi.fn(),
  }),
}));
vi.mock("@/providers/trpc", () => {
  const action = { useMutation: () => ({ mutate: vi.fn(), isPending: false }) };
  return {
    trpc: {
      workbench: {
        createOrder: action,
        assignOrder: action,
        cancelOrder: action,
        addNote: action,
        resolveOrderLines: action,
        createShipment: action,
        confirmDispatch: action,
        updateShipmentPlatformStatus: action,
        createAfterSales: action,
        updateAfterSales: action,
        createSku: action,
        linkListing: action,
        createPurchaseOrder: action,
        addPayment: action,
        postReceipt: action,
        closePurchaseRemainder: action,
        addExchangeRate: action,
        addCostEntry: action,
        verifyOrderProfit: action,
        reconcileSettlement: action,
      },
    },
  };
});

const render = (page: ReactElement, url: string) =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={[url]}>{page}</MemoryRouter>
  );

describe("merchant workspace page wiring", () => {
  it("links daily work to the correct queues without inventing profit", () => {
    const html = render(<OverviewPage />, "/");
    expect(html).toContain('href="/orders?queue=to_ship"');
    expect(html).toContain('href="/procurement?view=receiving"');
    expect(html).toContain("暂无已核实数据");
  });
  it("keeps the order list primary and continues the selected order into shipping", () => {
    const html = render(<OrdersPage />, "/orders?queue=to_ship&focus=42");
    expect(html).toContain("TEST-42");
    expect(html).toContain('href="/shipping?order=42"');
    expect(html).not.toContain('name="externalOrderId"');
  });
  it("prefills every remaining item, excluding quantities already in package drafts", () => {
    const html = render(
      <FulfillmentPage mode="shipping" />,
      "/shipping?order=42"
    );
    expect(html).toMatch(
      /<input(?=[^>]*name="quantity-7")(?=[^>]*max="4")(?=[^>]*value="4")[^>]*>/
    );
    expect(html).toContain("TEST-42-P01");
    expect(html).not.toContain("创建售后事件");
  });
  it("never substitutes another order when a context link is unavailable", () => {
    const html = render(
      <FulfillmentPage mode="shipping" />,
      "/shipping?order=999"
    );
    expect(html).toContain("这笔订单当前不能新建包裹");
    expect(html).not.toContain("TEST-42-P01");
    expect(html).not.toContain('name="quantity-7"');
  });
  it("gives after-sales its own order context without shipping forms", () => {
    const html = render(
      <FulfillmentPage mode="after-sales" />,
      "/after-sales?order=42"
    );
    expect(html).toContain("核对处理进展");
    expect(html).not.toContain('name="carrier"');
    expect(html).toContain('value="42" selected=""');
  });
  it("connects stock shortages to purchasing with the item and uncovered quantity", () => {
    const html = render(<CatalogPage />, "/inventory?risk=shortage");
    expect(html).toContain('href="/procurement?sku=4&amp;quantity=2"');
    expect(html).toContain("采购在途");
  });
  it("prefills the replenishment item, specification and quantity in purchasing", () => {
    const html = render(<PurchasingPage />, "/procurement?sku=4&quantity=2");
    expect(html).toContain('value="4" selected=""');
    expect(html).toMatch(/name="supplierSpec"[^>]*value="Blue"/);
    expect(html).toMatch(/name="quantity"[^>]*value="2"/);
  });
  it("keeps default stock, purchasing, and shipping views list-first", () => {
    const stock = render(<CatalogPage />, "/inventory");
    expect(stock).toContain("库存与补货");
    expect(stock).not.toContain('name="hsCode"');
    const purchasing = render(<PurchasingPage />, "/procurement");
    expect(purchasing).toContain("暂无符合条件的采购单");
    expect(purchasing).not.toContain('name="internalNo"');
    const shipping = render(<FulfillmentPage mode="shipping" />, "/shipping");
    expect(shipping).toContain("TEST-42-P01");
    expect(shipping).not.toContain('name="carrier"');
  });
  it("preserves finance permissions and never invents an empty financial trend", () => {
    expect(render(<FinancePage />, "/finance")).toContain("当前角色无财务权限");
    fixture.permissions.finance = true;
    try {
      const html = render(<FinancePage />, "/finance");
      expect(html).toContain("暂无订单财务数据");
      expect(html).not.toContain('name="rate"');
      expect(html).not.toContain("recharts-responsive-container");
    } finally {
      fixture.permissions.finance = false;
    }
  });
  it("keeps daily action links and values without repetitive tutorials", () => {
    const html = render(<OverviewPage />, "/");
    expect(html).toContain('href="/orders?queue=blocked"');
    expect(html).toContain("已核实贡献利润");
    expect(html).not.toContain("先看生意");
    expect(html).not.toContain("已付款且无缺货或商品匹配问题");
    expect(html).not.toContain("先处理卡住订单的问题");
  });
});
