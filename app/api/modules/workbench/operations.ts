import {
  auditLogs,
  exchangeRates,
  inventoryLedger,
  inventoryPositions,
  purchaseOrderLines,
  purchaseOrders,
  salesOrderLines,
  salesOrders,
  tasks,
} from "@db/schema";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "../../queries/connection";
type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
const now = () => new Date();

export async function audit(
  dbOrTx: Db | Tx,
  actorId: number | null,
  action: string,
  entityType: string,
  entityId: number | string,
  beforeJson?: unknown,
  afterJson?: unknown,
  reason?: string
) {
  await dbOrTx.insert(auditLogs).values({
    actorId,
    action,
    entityType,
    entityId: String(entityId),
    beforeJson,
    afterJson,
    reason,
  });
}

export async function openOrReopenTask(
  dbOrTx: Db | Tx,
  input: {
    stableKey: string;
    severity: "critical" | "high" | "medium" | "low";
    type: string;
    title: string;
    reason: string;
    businessType:
      "order" | "purchase" | "after_sales" | "store" | "sku" | "sync";
    businessId: number;
    ownerId?: number | null;
    dueAt?: Date | null;
  }
) {
  const existing = await dbOrTx
    .select()
    .from(tasks)
    .where(eq(tasks.stableKey, input.stableKey))
    .limit(1);
  const current = existing.at(0);
  if (!current) {
    await dbOrTx.insert(tasks).values({
      ...input,
      ownerId: input.ownerId ?? undefined,
      dueAt: input.dueAt ?? undefined,
      source: "auto",
    });
    return;
  }
  if (current.status === "closed") {
    await dbOrTx
      .update(tasks)
      .set({
        status: "open",
        severity: input.severity,
        reason: input.reason,
        dueAt: input.dueAt ?? undefined,
        reopenCount: current.reopenCount + 1,
        resolvedAt: null,
        closedAt: null,
      })
      .where(eq(tasks.id, current.id));
  }
}

export async function closeTask(dbOrTx: Db | Tx, stableKey: string) {
  await dbOrTx
    .update(tasks)
    .set({ status: "closed", resolvedAt: now(), closedAt: now() })
    .where(and(eq(tasks.stableKey, stableKey), eq(tasks.status, "open")));
}

async function ensurePosition(tx: Tx, skuId: number, location = "MAIN") {
  const existing = await tx
    .select()
    .from(inventoryPositions)
    .where(
      and(
        eq(inventoryPositions.skuId, skuId),
        eq(inventoryPositions.location, location)
      )
    )
    .limit(1)
    .for("update");
  if (existing.at(0)) return existing.at(0)!;
  await tx.insert(inventoryPositions).values({ skuId, location });
  const created = await tx
    .select()
    .from(inventoryPositions)
    .where(
      and(
        eq(inventoryPositions.skuId, skuId),
        eq(inventoryPositions.location, location)
      )
    )
    .limit(1)
    .for("update");
  return created.at(0)!;
}

export async function applyPositionDelta(
  tx: Tx,
  input: {
    skuId: number;
    location?: string;
    physicalDelta?: number;
    qualifiedDelta?: number;
    unqualifiedDelta?: number;
    reservedDelta?: number;
    shortageDelta?: number;
  }
) {
  const location = input.location ?? "MAIN";
  const position = await ensurePosition(tx, input.skuId, location);
  const next = {
    physicalQty: position.physicalQty + (input.physicalDelta ?? 0),
    qualifiedQty: position.qualifiedQty + (input.qualifiedDelta ?? 0),
    unqualifiedQty: position.unqualifiedQty + (input.unqualifiedDelta ?? 0),
    reservedQty: position.reservedQty + (input.reservedDelta ?? 0),
    shortageQty: Math.max(0, position.shortageQty + (input.shortageDelta ?? 0)),
  };
  if (
    next.physicalQty < 0 ||
    next.qualifiedQty < 0 ||
    next.unqualifiedQty < 0 ||
    next.reservedQty < 0
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "库存事务将导致负库存，已阻断",
    });
  }
  if (next.physicalQty !== next.qualifiedQty + next.unqualifiedQty) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "库存事务违反实物=合格+不可售约束",
    });
  }
  if (next.reservedQty > next.qualifiedQty) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "占用不得超过合格在库",
    });
  }
  await tx
    .update(inventoryPositions)
    .set(next)
    .where(eq(inventoryPositions.id, position.id));
  return next;
}

export async function latestRate(
  dbOrTx: Db | Tx,
  baseCurrency: "CNY" | "USD" | "AUD"
) {
  if (baseCurrency === "AUD") return null;
  const rows = await dbOrTx
    .select()
    .from(exchangeRates)
    .where(eq(exchangeRates.baseCurrency, baseCurrency))
    .orderBy(desc(exchangeRates.rateDate), desc(exchangeRates.id))
    .limit(1);
  return rows.at(0) ?? null;
}

export async function recalcPurchaseStatus(tx: Tx, purchaseOrderId: number) {
  const lines = await tx
    .select()
    .from(purchaseOrderLines)
    .where(eq(purchaseOrderLines.purchaseOrderId, purchaseOrderId));
  const ordered = lines.reduce((sum, line) => sum + line.quantity, 0);
  const received = lines.reduce((sum, line) => sum + line.receivedQty, 0);
  const closed = lines.reduce((sum, line) => sum + line.closedQty, 0);
  const receiveStatus =
    received === 0 ? "none" : received + closed >= ordered ? "full" : "partial";
  await tx
    .update(purchaseOrders)
    .set({ receiveStatus })
    .where(eq(purchaseOrders.id, purchaseOrderId));
}

export async function allocateOrder(tx: Tx, orderId: number, actorId: number) {
  const orderRows = await tx
    .select()
    .from(salesOrders)
    .where(eq(salesOrders.id, orderId))
    .limit(1)
    .for("update");
  const order = orderRows.at(0);
  if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "订单不存在" });
  if (
    order.destinationCountry &&
    order.destinationCountry.toUpperCase() !== "AU" &&
    order.destinationCountry !== "澳大利亚"
  ) {
    await tx
      .update(salesOrders)
      .set({ internalStatus: "out_of_scope" })
      .where(eq(salesOrders.id, orderId));
    await openOrReopenTask(tx, {
      stableKey: `order:${orderId}:out-of-scope`,
      severity: "high",
      type: "out_of_scope",
      title: `订单 ${order.orderNo} 超出澳洲试点范围`,
      reason: "收货国家不是澳洲，已保留记录并阻断自动履约。",
      businessType: "order",
      businessId: orderId,
      ownerId: order.ownerId,
      dueAt: order.shipBy,
    });
    return { allocated: 0, shortage: 0 };
  }
  if (order.paymentStatus !== "paid") {
    await tx
      .update(salesOrders)
      .set({ internalStatus: "pending" })
      .where(eq(salesOrders.id, orderId));
    return { allocated: 0, shortage: 0 };
  }

  const lines = await tx
    .select()
    .from(salesOrderLines)
    .where(eq(salesOrderLines.salesOrderId, orderId))
    .orderBy(asc(salesOrderLines.id));
  let anyUnmatched = false;
  let anyShortage = false;

  for (const line of lines) {
    if (!line.skuId) {
      anyUnmatched = true;
      if (line.shortageQty !== line.quantity) {
        await tx
          .update(salesOrderLines)
          .set({ shortageQty: line.quantity })
          .where(eq(salesOrderLines.id, line.id));
      }
      await openOrReopenTask(tx, {
        stableKey: `order-line:${line.id}:unmatched`,
        severity: "high",
        type: "sku_unmatched",
        title: `订单 ${order.orderNo} 存在未匹配 SKU`,
        reason: `行项目「${line.title}」缺少平台刊登到内部 SKU 的映射，已禁止正常发货。`,
        businessType: "order",
        businessId: orderId,
        ownerId: order.ownerId,
        dueAt: order.shipBy ?? order.internalShipBy,
      });
      continue;
    }

    await closeTask(tx, `order-line:${line.id}:unmatched`);
    const position = await ensurePosition(tx, line.skuId, "MAIN");
    const available = Math.max(0, position.qualifiedQty - position.reservedQty);
    const {
      allocated: targetAllocated,
      shortage: targetShortage,
      reserveDelta,
    } = allocationTarget(line.quantity, line.allocatedQty, available);
    const shortageDelta = targetShortage - line.shortageQty;

    if (reserveDelta !== 0 || shortageDelta !== 0) {
      await applyPositionDelta(tx, {
        skuId: line.skuId,
        reservedDelta: reserveDelta,
        shortageDelta,
      });
      if (reserveDelta > 0) {
        await tx.insert(inventoryLedger).values({
          skuId: line.skuId,
          type: "order_reservation",
          reservedDelta: reserveDelta,
          businessType: "order_line",
          businessId: line.id,
          idempotencyKey: `order-line:${line.id}:reserve:${line.allocatedQty}->${targetAllocated}`,
          actorId,
          reason: "已付款订单按行占用库存",
        });
      }
      await tx
        .update(salesOrderLines)
        .set({ allocatedQty: targetAllocated, shortageQty: targetShortage })
        .where(eq(salesOrderLines.id, line.id));
    }
    if (targetShortage > 0) {
      anyShortage = true;
      await openOrReopenTask(tx, {
        stableKey: `order-line:${line.id}:shortage`,
        severity: "high",
        type: "stock_shortage",
        title: `订单 ${order.orderNo} 缺货 ${targetShortage} 件`,
        reason: `SKU 可售不足，缺口 ${targetShortage}；系统未制造负库存。`,
        businessType: "order",
        businessId: orderId,
        ownerId: order.ownerId,
        dueAt: order.shipBy ?? order.internalShipBy,
      });
    } else {
      await closeTask(tx, `order-line:${line.id}:shortage`);
    }
  }

  const internalStatus = anyUnmatched
    ? "matching"
    : anyShortage
      ? "shortage"
      : order.fulfillmentStatus === "full"
        ? "fulfilled"
        : "picking";
  await tx
    .update(salesOrders)
    .set({ internalStatus })
    .where(eq(salesOrders.id, orderId));
  return { allocated: 1, shortage: anyShortage ? 1 : 0 };
}
import { allocationTarget } from "@contracts/merchant-workflow";
