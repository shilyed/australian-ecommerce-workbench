import { describe, expect, it } from "vitest";
import {
  allocationTarget,
  incomingQuantity,
  isActiveOrder,
  matchesOrderQueue,
  nextOrderAction,
  parseOrderQueue,
  shipmentRemainder,
  shippingDeadline,
  sydneyDay,
  type WorkflowOrder,
} from "./merchant-workflow";

const order = (overrides: Partial<WorkflowOrder> = {}): WorkflowOrder => ({
  id: 42,
  paymentStatus: "paid",
  internalStatus: "picking",
  fulfillmentStatus: "unshipped",
  afterSalesStatus: "none",
  shipBy: null,
  internalShipBy: null,
  lines: [{ id: 7, allocatedQty: 5, shippedQty: 0 }],
  shipments: [],
  ...overrides,
});

describe("merchant order queues", () => {
  it("defaults missing or unknown queues to ready to ship", () => {
    expect(parseOrderQueue(null)).toBe("to_ship");
    expect(parseOrderQueue("not-a-queue")).toBe("to_ship");
    expect(parseOrderQueue("blocked")).toBe("blocked");
  });
  it("includes only actionable paid orders in the shipping queue", () => {
    expect(matchesOrderQueue(order(), "to_ship")).toBe(true);
    for (const paymentStatus of [
      "unpaid",
      "unknown",
      "refunded",
      "partial_refund",
    ]) {
      expect(matchesOrderQueue(order({ paymentStatus }), "to_ship")).toBe(
        false
      );
    }
    for (const internalStatus of [
      "matching",
      "shortage",
      "fulfilled",
      "out_of_scope",
    ]) {
      expect(matchesOrderQueue(order({ internalStatus }), "to_ship")).toBe(
        false
      );
    }
    expect(
      matchesOrderQueue(order({ fulfillmentStatus: "full" }), "to_ship")
    ).toBe(false);
  });
  it("keeps partially shipped orders actionable without hiding shipment history", () => {
    const partial = order({ fulfillmentStatus: "partial" });
    expect(matchesOrderQueue(partial, "to_ship")).toBe(true);
    expect(matchesOrderQueue(partial, "shipped")).toBe(true);
  });
  it("separates blocked, after-sales and historical orders", () => {
    expect(
      matchesOrderQueue(order({ internalStatus: "shortage" }), "blocked")
    ).toBe(true);
    expect(
      matchesOrderQueue(order({ internalStatus: "matching" }), "blocked")
    ).toBe(true);
    const completed = order({
      internalStatus: "fulfilled",
      afterSalesStatus: "open",
    });
    expect(isActiveOrder(completed)).toBe(false);
    expect(matchesOrderQueue(completed, "after_sales")).toBe(true);
    expect(matchesOrderQueue(completed, "all")).toBe(true);
  });
});

describe("contextual next action", () => {
  it("routes matching, shortage, dispatch and after-sales to their actual workspace", () => {
    expect(nextOrderAction(order({ internalStatus: "matching" })).to).toBe(
      "/orders?queue=blocked&focus=42"
    );
    expect(nextOrderAction(order({ internalStatus: "shortage" })).to).toBe(
      "/inventory?risk=shortage"
    );
    expect(nextOrderAction(order()).to).toBe("/shipping?order=42");
    expect(nextOrderAction(order({ afterSalesStatus: "open" })).to).toBe(
      "/after-sales?order=42"
    );
  });
  it("does not send unpaid or completed orders to shipping", () => {
    expect(nextOrderAction(order({ paymentStatus: "unpaid" })).label).toBe(
      "核对付款"
    );
    expect(nextOrderAction(order({ internalStatus: "fulfilled" })).to).toBe(
      "/orders?queue=all&focus=42"
    );
  });
  it("continues an existing draft instead of suggesting another package", () => {
    expect(
      nextOrderAction(order({ shipments: [{ status: "draft", lines: [] }] }))
        .label
    ).toBe("继续打包 / 交运");
  });
});

describe("package quantities", () => {
  it("preserves cumulative allocation when rechecking partially dispatched orders", () => {
    expect(allocationTarget(5, 3, 1)).toEqual({
      allocated: 4,
      shortage: 1,
      reserveDelta: 1,
    });
    expect(allocationTarget(5, 5, 10)).toEqual({
      allocated: 5,
      shortage: 0,
      reserveDelta: 0,
    });
    expect(allocationTarget(5, 3, -1)).toEqual({
      allocated: 3,
      shortage: 2,
      reserveDelta: 0,
    });
  });
  it("deducts shipped goods and drafts, but not dispatched packages twice", () => {
    const current = order({
      lines: [{ id: 7, allocatedQty: 8, shippedQty: 2 }],
      shipments: [
        {
          status: "draft",
          lines: [
            { salesOrderLineId: 7, quantity: 3 },
            { salesOrderLineId: 99, quantity: 10 },
          ],
        },
        { status: "dispatched", lines: [{ salesOrderLineId: 7, quantity: 2 }] },
      ],
    });
    expect(shipmentRemainder(current, current.lines[0])).toBe(3);
  });
  it("does not produce negative package defaults from inconsistent snapshots", () => {
    const current = order({
      lines: [{ id: 7, allocatedQty: 1, shippedQty: 2 }],
    });
    expect(shipmentRemainder(current, current.lines[0])).toBe(0);
  });
});

describe("procurement in transit", () => {
  it("counts only outstanding quantities from placed orders", () => {
    const line = { skuId: 4, quantity: 10, receivedQty: 3, closedQty: 2 };
    expect(
      incomingQuantity(
        [
          { flowStatus: "ordered", lines: [line, { ...line, skuId: 5 }] },
          { flowStatus: "draft", lines: [line] },
          { flowStatus: "closed", lines: [line] },
          { flowStatus: "cancelled", lines: [line] },
          { flowStatus: "ordered", lines: [{ ...line, quantity: 1 }] },
        ],
        4
      )
    ).toBe(5);
  });
  it("returns no incoming stock when there are no purchases", () => {
    expect(incomingQuantity([], 4)).toBe(0);
  });
});

describe("merchant dates", () => {
  it("uses the earlier internal or platform deadline, including a missing platform deadline", () => {
    const early = new Date("2026-10-18T23:00:00Z");
    const late = new Date("2026-10-19T03:00:00Z");
    expect(
      shippingDeadline(order({ shipBy: late, internalShipBy: early }))
    ).toEqual(early);
    expect(shippingDeadline(order({ internalShipBy: early }))).toEqual(early);
    expect(shippingDeadline(order())).toBeNull();
  });
  it("uses Sydney dates across daylight saving and midnight", () => {
    expect(sydneyDay(new Date("2026-10-18T13:30:00Z"))).toBe("2026-10-19");
    expect(sydneyDay(new Date("2026-06-18T13:30:00Z"))).toBe("2026-06-18");
  });
});
