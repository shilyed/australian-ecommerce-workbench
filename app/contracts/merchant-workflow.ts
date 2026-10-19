export const orderQueues = [
  { value: "to_ship", label: "待发货" },
  { value: "blocked", label: "缺货 / 待匹配" },
  { value: "shipped", label: "已发货" },
  { value: "after_sales", label: "售后" },
  { value: "all", label: "全部" },
] as const;

export type OrderQueue = (typeof orderQueues)[number]["value"];

interface OrderLine {
  id: number;
  allocatedQty: number;
  shippedQty: number;
}

export interface WorkflowOrder {
  id: number;
  paymentStatus: string;
  internalStatus: string;
  fulfillmentStatus: string;
  afterSalesStatus: string;
  shipBy: Date | null;
  internalShipBy: Date | null;
  lines: OrderLine[];
  shipments: {
    status: string;
    lines: { salesOrderLineId: number; quantity: number }[];
  }[];
}

export function isActiveOrder(order: WorkflowOrder) {
  return (
    !["fulfilled", "out_of_scope"].includes(order.internalStatus) &&
    order.fulfillmentStatus !== "full"
  );
}

export function matchesOrderQueue(order: WorkflowOrder, queue: OrderQueue) {
  switch (queue) {
    case "to_ship":
      return (
        isActiveOrder(order) &&
        order.paymentStatus === "paid" &&
        !["matching", "shortage"].includes(order.internalStatus)
      );
    case "blocked":
      return (
        isActiveOrder(order) &&
        ["matching", "shortage"].includes(order.internalStatus)
      );
    case "shipped":
      return (
        order.fulfillmentStatus === "full" ||
        order.fulfillmentStatus === "partial"
      );
    case "after_sales":
      return order.afterSalesStatus === "open";
    case "all":
      return true;
  }
}

export function parseOrderQueue(value: string | null): OrderQueue {
  return orderQueues.find(queue => queue.value === value)?.value ?? "to_ship";
}

export function shipmentRemainder(order: WorkflowOrder, line: OrderLine) {
  const drafted = order.shipments
    .filter(shipment => shipment.status === "draft")
    .flatMap(shipment => shipment.lines)
    .filter(item => item.salesOrderLineId === line.id)
    .reduce((sum, item) => sum + item.quantity, 0);
  return Math.max(0, line.allocatedQty - line.shippedQty - drafted);
}

export function allocationTarget(
  quantity: number,
  allocatedQty: number,
  availableQty: number
) {
  const allocated = Math.min(
    quantity,
    allocatedQty + Math.max(0, availableQty)
  );
  return {
    allocated,
    shortage: Math.max(0, quantity - allocated),
    reserveDelta: allocated - allocatedQty,
  };
}

export function nextOrderAction(order: WorkflowOrder) {
  if (order.afterSalesStatus === "open")
    return { label: "处理售后", to: `/after-sales?order=${order.id}` };
  if (!isActiveOrder(order))
    return { label: "查看记录", to: `/orders?queue=all&focus=${order.id}` };
  if (order.paymentStatus !== "paid")
    return { label: "核对付款", to: `/orders?queue=all&focus=${order.id}` };
  if (order.internalStatus === "matching")
    return { label: "匹配商品", to: `/orders?queue=blocked&focus=${order.id}` };
  if (order.internalStatus === "shortage")
    return { label: "查看缺货与在途", to: "/inventory?risk=shortage" };
  if (order.shipments.some(shipment => shipment.status === "draft")) {
    return { label: "继续打包 / 交运", to: `/shipping?order=${order.id}` };
  }
  return { label: "去发货", to: `/shipping?order=${order.id}` };
}

export function shippingDeadline(order: WorkflowOrder) {
  const deadlines = [order.shipBy, order.internalShipBy].filter(
    (value): value is Date => value !== null
  );
  return deadlines.length
    ? new Date(Math.min(...deadlines.map(date => date.getTime())))
    : null;
}

interface Purchase {
  flowStatus: string;
  lines: {
    skuId: number;
    quantity: number;
    receivedQty: number;
    closedQty: number;
  }[];
}

export function incomingQuantity(purchases: Purchase[], skuId: number) {
  return purchases
    .filter(purchase => purchase.flowStatus === "ordered")
    .flatMap(purchase => purchase.lines)
    .filter(line => line.skuId === skuId)
    .reduce(
      (sum, line) =>
        sum + Math.max(0, line.quantity - line.receivedQty - line.closedQty),
      0
    );
}

export function sydneyDay(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
