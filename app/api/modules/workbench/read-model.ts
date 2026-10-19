import {
  afterSalesCases,
  auditLogs,
  channelListings,
  costAllocations,
  costEntries,
  exchangeRates,
  goodsReceiptLines,
  goodsReceipts,
  inventoryLedger,
  inventoryLots,
  inventoryPositions,
  notes,
  paymentRecords,
  productCandidates,
  purchaseOrderLines,
  purchaseOrders,
  salesOrderLines,
  salesOrders,
  settlements,
  shipmentLines,
  shipments,
  skus,
  storeConnections,
  storeCredentials,
  suppliers,
  syncJobs,
  tasks,
  users,
  type User,
} from "@db/schema";
import { asc, desc } from "drizzle-orm";
import type { StoreProfile } from "../../integrations/types";
import { getDb } from "../../queries/connection";
import { round2, round4, toNumber } from "./numbers";
import { can } from "./permissions";

function parseStoreProfile(raw: string | null): StoreProfile | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoreProfile;
  } catch {
    return null;
  }
}

export async function buildWorkspace(user: User) {
  const db = getDb();
  const financeAllowed = can(user, "finance", false);
  const [
    supplierRows,
    candidateRows,
    skuRows,
    listingRows,
    poRows,
    poLineRows,
    paymentRows,
    receiptRows,
    receiptLineRows,
    positionRows,
    lotRows,
    ledgerRows,
    orderRows,
    orderLineRows,
    shipmentRows,
    shipmentLineRows,
    afterSalesRows,
    exchangeRateRows,
    costRows,
    allocationRows,
    settlementRows,
    storeRows,
    syncRows,
    taskRows,
    noteRows,
    auditRows,
    userRows,
    credentialRows,
  ] = await Promise.all([
    db.select().from(suppliers).orderBy(desc(suppliers.updatedAt)),
    db
      .select()
      .from(productCandidates)
      .orderBy(desc(productCandidates.updatedAt)),
    db.select().from(skus).orderBy(desc(skus.updatedAt)),
    db.select().from(channelListings).orderBy(desc(channelListings.updatedAt)),
    db.select().from(purchaseOrders).orderBy(desc(purchaseOrders.updatedAt)),
    db.select().from(purchaseOrderLines),
    db.select().from(paymentRecords).orderBy(desc(paymentRecords.paidAt)),
    db.select().from(goodsReceipts).orderBy(desc(goodsReceipts.receivedAt)),
    db.select().from(goodsReceiptLines),
    db.select().from(inventoryPositions),
    db.select().from(inventoryLots).orderBy(asc(inventoryLots.receivedAt)),
    db.select().from(inventoryLedger).orderBy(desc(inventoryLedger.createdAt)),
    db.select().from(salesOrders).orderBy(desc(salesOrders.orderedAt)),
    db.select().from(salesOrderLines),
    db.select().from(shipments).orderBy(desc(shipments.createdAt)),
    db.select().from(shipmentLines),
    db.select().from(afterSalesCases).orderBy(desc(afterSalesCases.createdAt)),
    db.select().from(exchangeRates).orderBy(desc(exchangeRates.rateDate)),
    db.select().from(costEntries).orderBy(desc(costEntries.createdAt)),
    db.select().from(costAllocations),
    db.select().from(settlements).orderBy(desc(settlements.periodEnd)),
    db.select().from(storeConnections).orderBy(asc(storeConnections.platform)),
    db.select().from(syncJobs).orderBy(desc(syncJobs.createdAt)),
    db.select().from(tasks).orderBy(desc(tasks.updatedAt)),
    db.select().from(notes).orderBy(desc(notes.createdAt)),
    db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)),
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        businessRole: users.businessRole,
        status: users.status,
        role: users.role,
      })
      .from(users),
    db
      .select({ storeConnectionId: storeCredentials.storeConnectionId })
      .from(storeCredentials),
  ]);

  const purchaseOrdersJoined = poRows.map(po => ({
    ...po,
    supplier:
      supplierRows.find(supplier => supplier.id === po.supplierId) ?? null,
    lines: poLineRows
      .filter(line => line.purchaseOrderId === po.id)
      .map(line => ({
        ...(financeAllowed
          ? line
          : {
              ...line,
              unitPrice: null,
              discount: null,
              allocatedCostAud: null,
            }),
        sku: skuRows.find(sku => sku.id === line.skuId) ?? null,
      })),
    payments: financeAllowed
      ? paymentRows.filter(payment => payment.purchaseOrderId === po.id)
      : [],
    receipts: receiptRows
      .filter(receipt => receipt.purchaseOrderId === po.id)
      .map(receipt => ({
        ...receipt,
        lines: receiptLineRows.filter(
          line => line.goodsReceiptId === receipt.id
        ),
      })),
  }));

  const ordersJoined = orderRows.map(order => ({
    ...order,
    owner: userRows.find(member => member.id === order.ownerId) ?? null,
    lines: orderLineRows
      .filter(line => line.salesOrderId === order.id)
      .map(line => ({
        ...line,
        sku: skuRows.find(sku => sku.id === line.skuId) ?? null,
        listing:
          listingRows.find(listing => listing.id === line.listingId) ?? null,
      })),
    shipments: shipmentRows
      .filter(shipment => shipment.salesOrderId === order.id)
      .map(shipment => ({
        ...shipment,
        lines: shipmentLineRows.filter(line => line.shipmentId === shipment.id),
      })),
    afterSales: afterSalesRows.filter(item => item.salesOrderId === order.id),
    notes: noteRows.filter(
      note => note.businessType === "order" && note.businessId === order.id
    ),
  }));

  const inventoryRows = skuRows.map(sku => {
    const positions = positionRows.filter(
      position => position.skuId === sku.id
    );
    const main =
      positions.find(position => position.location === "MAIN") ??
      positions.at(0);
    return {
      sku,
      position: main ?? null,
      lots: lotRows.filter(lot => lot.skuId === sku.id),
      ledger: ledgerRows.filter(entry => entry.skuId === sku.id).slice(0, 20),
    };
  });

  const report = financeAllowed
    ? ordersJoined.map(order => {
        const confirmedRefunds = order.afterSales
          .filter(
            item => item.refundStatus === "confirmed" && item.currency === "AUD"
          )
          .reduce((sum, item) => sum + toNumber(item.amount), 0);
        const netSales = round2(
          toNumber(order.subtotal) +
            toNumber(order.shippingPaid) -
            toNumber(order.discount) -
            confirmedRefunds
        );
        const goodsCost = round2(
          ledgerRows
            .filter(
              entry =>
                entry.businessType === "order" &&
                entry.businessId === order.id &&
                entry.type === "shipment_outbound"
            )
            .reduce(
              (sum, entry) =>
                sum +
                Math.abs(entry.qualifiedDelta) * toNumber(entry.unitCostAud),
              0
            )
        );
        const orderCosts = costRows.filter(
          entry =>
            entry.businessType === "order" && entry.businessId === order.id
        );
        const expense = round2(
          orderCosts.reduce((sum, entry) => {
            const sign = entry.entryKind === "reversal" ? -1 : 1;
            return sum + sign * toNumber(entry.audAmount);
          }, 0)
        );
        const contribution = round2(netSales - goodsCost - expense);
        const margin = netSales > 0 ? round4(contribution / netSales) : null;
        const missingCost =
          order.lines.some(line => line.shippedQty > 0) && goodsCost === 0;
        const missingRate = orderCosts.some(entry => entry.audAmount === null);
        const estimated = orderCosts.some(
          entry => entry.entryKind === "estimate"
        );
        return {
          orderId: order.id,
          orderNo: order.orderNo,
          platform: order.platform,
          orderedAt: order.orderedAt,
          currency: order.currency,
          netSales,
          goodsCost,
          expense,
          contribution,
          margin,
          profitStatus:
            order.profitStatus === "verified"
              ? "verified"
              : missingCost || missingRate
                ? "incomplete"
                : estimated
                  ? "estimated"
                  : order.profitStatus,
          revisionReason: order.profitRevisionReason,
        };
      })
    : [];

  return {
    currentUser: user,
    permissions: {
      finance: financeAllowed,
      settings: can(user, "settings", true),
    },
    suppliers: supplierRows,
    candidates: candidateRows.map(candidate => ({
      ...candidate,
      supplier:
        supplierRows.find(supplier => supplier.id === candidate.supplierId) ??
        null,
      convertedSku:
        skuRows.find(sku => sku.id === candidate.convertedSkuId) ?? null,
    })),
    skus: skuRows,
    listings: listingRows.map(listing => ({
      ...listing,
      sku: skuRows.find(sku => sku.id === listing.skuId) ?? null,
    })),
    purchaseOrders: purchaseOrdersJoined,
    inventory: inventoryRows,
    inventoryLedger: ledgerRows.slice(0, 100),
    orders: ordersJoined,
    shipments: shipmentRows.map(shipment => ({
      ...shipment,
      order:
        orderRows.find(order => order.id === shipment.salesOrderId) ?? null,
      lines: shipmentLineRows.filter(line => line.shipmentId === shipment.id),
    })),
    afterSales: afterSalesRows.map(item => ({
      ...item,
      order: orderRows.find(order => order.id === item.salesOrderId) ?? null,
    })),
    exchangeRates: financeAllowed ? exchangeRateRows : [],
    costs: financeAllowed ? costRows : [],
    allocations: financeAllowed ? allocationRows : [],
    settlements: financeAllowed ? settlementRows : [],
    report,
    stores: storeRows.map(({ profileSummary, ...store }) => ({
      ...store,
      hasCredentials: credentialRows.some(
        row => row.storeConnectionId === store.id
      ),
      profile: parseStoreProfile(profileSummary),
    })),
    syncJobs: syncRows,
    tasks: taskRows.map(task => ({
      ...task,
      owner: userRows.find(member => member.id === task.ownerId) ?? null,
    })),
    notes: noteRows,
    auditLogs: auditRows.slice(0, 100),
    members: userRows,
  };
}
