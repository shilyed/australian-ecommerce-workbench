import { eq } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import {
  afterSalesCases,
  channelListings,
  costAllocations,
  costEntries,
  exchangeRates,
  goodsReceiptLines,
  goodsReceipts,
  inventoryLedger,
  inventoryLots,
  inventoryPositions,
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
  suppliers,
  tasks,
} from "./schema";

async function seed() {
  const db = getDb();
  console.log("Seeding workbench pilot data...");

  const existing = await db.select().from(suppliers).limit(1);
  if (existing.length > 0) {
    console.log("Pilot data already exists; skipped.");
    process.exit(0);
  }

  const operatorId = 1;
  const [{ id: supplierId }] = await db
    .insert(suppliers)
    .values({
      name: "义乌澄光家居用品厂",
      shopUrl: "https://shop1488.example.1688.com",
      contactName: "陈经理",
      contactInfo: "仅内部可见：1688 旺旺 chenguang",
      notes: "历史样品 3 次，平均交期 6 天；残次需 48 小时内拍照反馈。",
    })
    .$returningId();

  const [{ id: candidateId }] = await db
    .insert(productCandidates)
    .values({
      name: "澳洲极简陶瓷香薰杯",
      sourceUrl: "https://detail.1688.com/offer/demo-aroma-cup.html",
      supplierId,
      spec: "米白 / 280ml / 无香芯",
      quote: "50.00",
      moq: 2,
      leadTimeDays: 7,
      weight: "420",
      dimensions: "9×9×10 cm",
      packaging: "蜂窝纸+独立纸盒",
      referencePrice: "40.00",
      status: "pending_decision",
      sampleScore: 86,
      sampleReview: "釉面一致，包装抗压良好；图片与实物色差可接受。评分不是合规证明。",
      etsyStatus: "pending",
      ebayStatus: "assess",
      complianceBasis: "eBay：普通家居用品可继续评估。Etsy：1688 现货不得默认按原创/手工刊登，需业务负责人确认定位。",
      operatorId,
    })
    .$returningId();

  const [{ id: skuId }] = await db
    .insert(skus)
    .values({
      code: "AU-CUP-001",
      name: "极简陶瓷香薰杯 米白 280ml",
      productName: "极简陶瓷香薰杯",
      spec: "米白 / 280ml",
      weight: "420",
      dimensions: "9×9×10 cm",
      supplierSku: "CG-CUP-280-W",
      declarationNameEn: "Ceramic aroma cup",
      material: "Ceramic",
      originCountry: "CN",
      hsCode: "691200",
      alertThreshold: 1,
    })
    .$returningId();

  const [{ id: shortageSkuId }] = await db
    .insert(skus)
    .values({
      code: "AU-TRAY-002",
      name: "折叠收纳托盘 灰色 M",
      productName: "折叠收纳托盘",
      spec: "灰色 / M",
      weight: "260",
      dimensions: "30×20×5 cm",
      supplierSku: "CG-TRAY-M-G",
      declarationNameEn: "Foldable storage tray",
      material: "Felt",
      originCountry: "CN",
      hsCode: "630790",
      alertThreshold: 2,
    })
    .$returningId();

  await db.insert(inventoryPositions).values([
    { skuId, physicalQty: 1, qualifiedQty: 1, unqualifiedQty: 0, reservedQty: 0, shortageQty: 0 },
    { skuId: shortageSkuId, physicalQty: 6, qualifiedQty: 5, unqualifiedQty: 1, reservedQty: 1, shortageQty: 1 },
  ]);

  await db.update(productCandidates).set({ convertedSkuId: skuId, status: "adopted" }).where(eq(productCandidates.id, candidateId));

  const [{ id: etsyListingId }] = await db
    .insert(channelListings)
    .values({
      platform: "etsy",
      externalShopId: "ETSY-AU-001",
      externalListingId: "L-1001",
      externalVariantId: "V-1001-W",
      platformSku: "AU-CUP-001",
      skuId,
      title: "Minimal Ceramic Aroma Cup 280ml",
      url: "https://www.etsy.com/listing/demo-1001",
      price: "40.00",
      currency: "AUD",
      shippingInfo: "AU Standard AUD 5.00",
      platformStatus: "active_snapshot",
      lastSyncAt: new Date("2026-10-15T22:00:00Z"),
    })
    .$returningId();

  await db.insert(channelListings).values({
    platform: "ebay",
    externalShopId: "EBAY-AU-001",
    externalListingId: "E-2001",
    externalVariantId: "TRAY-M-G",
    platformSku: "AU-TRAY-002",
    skuId: shortageSkuId,
    title: "Foldable Felt Storage Tray Grey M",
    url: "https://www.ebay.com.au/itm/demo-2001",
    price: "29.00",
    currency: "AUD",
    shippingInfo: "AU Standard AUD 7.00",
    platformStatus: "active_snapshot",
    lastSyncAt: new Date("2026-10-15T22:00:00Z"),
  });

  const [{ id: cnyRateId }] = await db
    .insert(exchangeRates)
    .values({
      baseCurrency: "CNY",
      rate: "0.200000",
      rateDate: new Date("2026-10-01T00:00:00Z"),
      source: "试点验收快照：1 CNY = 0.20 AUD",
      isDefault: true,
      createdById: operatorId,
    })
    .$returningId();

  const [{ id: poId }] = await db
    .insert(purchaseOrders)
    .values({
      internalNo: "PO-202610-001",
      supplierId,
      externalOrderNo: "1688-DEMO-1001",
      externalOrderUrl: "https://trade.1688.com/order/demo-1001",
      orderedAt: new Date("2026-10-01T02:00:00Z"),
      expectedArrivalAt: new Date("2026-10-06T02:00:00Z"),
      ownerId: operatorId,
      flowStatus: "ordered",
      receiveStatus: "full",
      notes: "PRD 验收样例：两件货款 CNY100 + 国内运费 CNY10。",
    })
    .$returningId();

  const [{ id: poLineId }] = await db
    .insert(purchaseOrderLines)
    .values({
      purchaseOrderId: poId,
      skuId,
      supplierSpec: "米白 280ml",
      quantity: 2,
      receivedQty: 2,
      unitPrice: "50.0000",
      currency: "CNY",
      discount: "0",
      allocatedCostAud: "11.0000",
    })
    .$returningId();

  await db.insert(purchaseOrderLines).values({
    purchaseOrderId: poId,
    skuId: shortageSkuId,
    supplierSpec: "灰色 M",
    quantity: 10,
    receivedQty: 6,
    unitPrice: "18.0000",
    currency: "CNY",
    discount: "0",
    allocatedCostAud: "3.6000",
  });

  await db.insert(purchaseOrders).values({
    internalNo: "PO-202610-002",
    supplierId,
    externalOrderNo: "1688-DEMO-2002",
    orderedAt: new Date("2026-10-10T02:00:00Z"),
    expectedArrivalAt: new Date("2026-10-18T02:00:00Z"),
    ownerId: operatorId,
    flowStatus: "ordered",
    receiveStatus: "partial",
    notes: "托盘分批到货：10 件先到 6 件，其中 1 件残次，仍剩 4 件未到。",
  });

  const [{ id: receiptId }] = await db
    .insert(goodsReceipts)
    .values({
      purchaseOrderId: poId,
      receivedAt: new Date("2026-10-05T04:00:00Z"),
      note: "首批 2 件全部合格；批次费用 CNY10 已分摊。",
      idempotencyKey: "seed-receipt-po1",
      postedById: operatorId,
    })
    .$returningId();

  await db.insert(goodsReceiptLines).values([
    {
      goodsReceiptId: receiptId,
      purchaseOrderLineId: poLineId,
      skuId,
      receivedQty: 2,
      qualifiedQty: 2,
      defectiveQty: 0,
      pendingQty: 0,
    },
  ]);

  const [{ id: lotId }] = await db
    .insert(inventoryLots)
    .values({
      skuId,
      batchCode: "PO-1-CUP-SEED",
      sourceType: "purchase",
      sourceId: receiptId,
      receivedAt: new Date("2026-10-05T04:00:00Z"),
      qtyRemaining: 1,
      qualifiedRemaining: 1,
      unqualifiedRemaining: 0,
      unitCostCny: "55.0000",
      unitCostAud: "11.0000",
      costStatus: "complete",
    })
    .$returningId();

  await db.insert(inventoryLots).values({
    skuId: shortageSkuId,
    batchCode: "PO-2-TRAY-FIRST6",
    sourceType: "purchase",
    sourceId: poId,
    receivedAt: new Date("2026-10-12T04:00:00Z"),
    qtyRemaining: 6,
    qualifiedRemaining: 5,
    unqualifiedRemaining: 1,
    unitCostCny: "18.0000",
    unitCostAud: "3.6000",
    costStatus: "complete",
  });

  await db.insert(inventoryLedger).values([
    {
      skuId,
      lotId,
      type: "purchase_inbound",
      qualifiedDelta: 2,
      businessType: "goods_receipt",
      businessId: receiptId,
      unitCostAud: "11.0000",
      idempotencyKey: "seed-ledger-cup-inbound",
      actorId: operatorId,
      reason: "两件合格入库；含国内运费分摊后单件 CNY55 / AUD11",
      createdAt: new Date("2026-10-05T04:01:00Z"),
    },
    {
      skuId: shortageSkuId,
      type: "purchase_inbound",
      qualifiedDelta: 5,
      unqualifiedDelta: 1,
      businessType: "goods_receipt",
      businessId: poId,
      unitCostAud: "3.6000",
      idempotencyKey: "seed-ledger-tray-inbound",
      actorId: operatorId,
      reason: "10 件采购先到 6 件：5 合格、1 残次，4 件未到",
      createdAt: new Date("2026-10-12T04:01:00Z"),
    },
    {
      skuId: shortageSkuId,
      type: "order_reservation",
      reservedDelta: 1,
      businessType: "order_line",
      businessId: 2,
      idempotencyKey: "seed-ledger-tray-reserve",
      actorId: operatorId,
      reason: "eBay 已付款订单占用 1 件，另 1 件缺货",
      createdAt: new Date("2026-10-15T01:00:00Z"),
    },
  ]);

  const [{ id: orderId }] = await db
    .insert(salesOrders)
    .values({
      platform: "etsy",
      externalShopId: "ETSY-AU-001",
      externalOrderId: "ETSY-ORDER-9001",
      orderNo: "AU-9001",
      buyerName: "试点买家 A",
      buyerEmail: "buyer-a@example.com",
      destinationCountry: "AU",
      postalCode: "2000",
      addressSummary: "NSW 2000（详细地址仅履约视图可见）",
      rawStatus: "paid",
      paymentStatus: "paid",
      internalStatus: "fulfilled",
      fulfillmentStatus: "full",
      afterSalesStatus: "none",
      syncStatus: "normal",
      orderedAt: new Date("2026-10-14T23:30:00Z"),
      platformUpdatedAt: new Date("2026-10-14T23:35:00Z"),
      shipBy: new Date("2026-10-16T23:59:59Z"),
      ownerId: operatorId,
      currency: "AUD",
      subtotal: "40.00",
      shippingPaid: "5.00",
      taxCollected: "4.50",
      discount: "0.00",
      total: "49.50",
      profitStatus: "verified",
      profitVerifiedById: operatorId,
      profitVerifiedAt: new Date("2026-10-15T08:00:00Z"),
      note: "PRD 第 10 节验收订单。",
    })
    .$returningId();

  const [{ id: orderLineId }] = await db
    .insert(salesOrderLines)
    .values({
      salesOrderId: orderId,
      listingId: etsyListingId,
      skuId,
      externalSku: "AU-CUP-001",
      title: "Minimal Ceramic Aroma Cup 280ml",
      quantity: 1,
      unitPrice: "40.0000",
      discount: "0",
      allocatedQty: 1,
      shippedQty: 1,
      shortageQty: 0,
      snapshot: { source: "seed", platformSku: "AU-CUP-001" },
    })
    .$returningId();

  const [{ id: shipmentId }] = await db
    .insert(shipments)
    .values({
      salesOrderId: orderId,
      packageNo: "AU-9001-P01",
      carrier: "Australia Post",
      service: "Parcel Post",
      trackingNo: "APDEMO0001",
      trackingUrl: "https://auspost.com.au/track/APDEMO0001",
      weight: "620",
      freightEstimate: "12.00",
      freightActual: "12.00",
      currency: "AUD",
      status: "platform_confirmed",
      dispatchedAt: new Date("2026-10-15T05:00:00Z"),
      platformMessage: "平台已人工核对发货",
      idempotencyKey: "seed-shipment-9001",
      createdById: operatorId,
      createdAt: new Date("2026-10-15T04:40:00Z"),
    })
    .$returningId();

  await db.insert(shipmentLines).values({ shipmentId, salesOrderLineId: orderLineId, quantity: 1 });
  await db.insert(inventoryLedger).values({
    skuId,
    lotId,
    type: "shipment_outbound",
    qualifiedDelta: -1,
    reservedDelta: -1,
    businessType: "order",
    businessId: orderId,
    unitCostAud: "11.0000",
    idempotencyKey: "seed-ledger-cup-outbound",
    actorId: operatorId,
    reason: "确认实际交运，FIFO 出库",
    createdAt: new Date("2026-10-15T05:00:00Z"),
  });

  const [{ id: shortageOrderId }] = await db
    .insert(salesOrders)
    .values({
      platform: "ebay",
      externalShopId: "EBAY-AU-001",
      externalOrderId: "EBAY-ORDER-7001",
      orderNo: "AU-7001",
      buyerName: "试点买家 B",
      destinationCountry: "AU",
      postalCode: "3000",
      addressSummary: "VIC 3000（详细地址仅履约视图可见）",
      rawStatus: "paid",
      paymentStatus: "paid",
      internalStatus: "shortage",
      fulfillmentStatus: "unshipped",
      syncStatus: "normal",
      orderedAt: new Date("2026-10-15T01:00:00Z"),
      shipBy: new Date("2026-10-17T00:00:00Z"),
      ownerId: operatorId,
      currency: "AUD",
      subtotal: "58.00",
      shippingPaid: "7.00",
      taxCollected: "5.90",
      discount: "0.00",
      total: "70.90",
      profitStatus: "incomplete",
    })
    .$returningId();

  await db.insert(salesOrderLines).values({
    salesOrderId: shortageOrderId,
    skuId: shortageSkuId,
    externalSku: "AU-TRAY-002",
    title: "Foldable Felt Storage Tray Grey M",
    quantity: 2,
    unitPrice: "29.0000",
    allocatedQty: 1,
    shortageQty: 1,
    snapshot: { source: "seed", platformSku: "AU-TRAY-002" },
  });

  await db.insert(salesOrders).values({
    platform: "etsy",
    externalShopId: "ETSY-AU-001",
    externalOrderId: "ETSY-ORDER-9002",
    orderNo: "AU-9002",
    buyerName: "试点买家 C",
    destinationCountry: "NZ",
    postalCode: "1010",
    addressSummary: "Auckland 1010",
    rawStatus: "paid",
    paymentStatus: "paid",
    internalStatus: "out_of_scope",
    fulfillmentStatus: "unshipped",
    syncStatus: "normal",
    orderedAt: new Date("2026-10-15T03:00:00Z"),
    ownerId: operatorId,
    currency: "AUD",
    subtotal: "40.00",
    shippingPaid: "9.00",
    taxCollected: "0.00",
    discount: "0.00",
    total: "49.00",
    profitStatus: "incomplete",
  });

  const [{ id: feeId }] = await db
    .insert(costEntries)
    .values({
      businessType: "order",
      businessId: orderId,
      category: "platform_fee",
      amount: "5.00",
      currency: "AUD",
      audAmount: "5.00",
      entryKind: "actual",
      allocationStatus: "allocated",
      note: "平台费用测试输入",
      createdById: operatorId,
    })
    .$returningId();
  const [{ id: freightId }] = await db
    .insert(costEntries)
    .values({
      businessType: "order",
      businessId: orderId,
      category: "fulfillment_freight",
      amount: "12.00",
      currency: "AUD",
      audAmount: "12.00",
      entryKind: "actual",
      allocationStatus: "allocated",
      note: "卖家实际发货运费",
      createdById: operatorId,
    })
    .$returningId();
  const [{ id: packagingId }] = await db
    .insert(costEntries)
    .values({
      businessType: "order",
      businessId: orderId,
      category: "packaging",
      amount: "1.00",
      currency: "AUD",
      audAmount: "1.00",
      entryKind: "actual",
      allocationStatus: "allocated",
      note: "本单包装",
      createdById: operatorId,
    })
    .$returningId();

  await db.insert(costAllocations).values([
    { costEntryId: feeId, targetType: "order", targetId: orderId, amount: "5.00", audAmount: "5.00", reason: "订单费用唯一归属", createdById: operatorId },
    { costEntryId: freightId, targetType: "order", targetId: orderId, amount: "12.00", audAmount: "12.00", reason: "订单履约费用", createdById: operatorId },
    { costEntryId: packagingId, targetType: "order", targetId: orderId, amount: "1.00", audAmount: "1.00", reason: "订单包装费用", createdById: operatorId },
  ]);

  const [{ id: afterSalesId }] = await db
    .insert(afterSalesCases)
    .values({
      salesOrderId: shortageOrderId,
      type: "return_refund",
      status: "processing",
      refundStatus: "pending",
      returnStatus: "received",
      reason: "买家反馈颜色不符，退货已收到，等待质检。",
      responsibility: "待判定",
      amount: "29.00",
      currency: "AUD",
      ownerId: operatorId,
      createdById: operatorId,
    })
    .$returningId();

  await db.insert(settlements).values({
    platform: "etsy",
    externalShopId: "ETSY-AU-001",
    referenceNo: "SETTLE-DEMO-001",
    periodStart: new Date("2026-10-14T00:00:00Z"),
    periodEnd: new Date("2026-10-15T23:59:59Z"),
    currency: "AUD",
    grossAmount: "49.50",
    fees: "5.00",
    refunds: "0.00",
    taxes: "4.50",
    withheld: "0.00",
    adjustments: "0.00",
    netPlatformPayout: "40.00",
    actualReceived: "40.00",
    status: "reconciled",
    note: "净放款 AUD40 不等于订单利润 AUD16。",
    reconciledById: operatorId,
    reconciledAt: new Date("2026-10-16T01:00:00Z"),
  });

  await db.insert(storeConnections).values([
    {
      platform: "etsy",
      externalShopId: "ETSY-AU-001",
      shopName: "Etsy 澳洲试点店",
      authorizationStatus: "authorized",
      lastAttemptAt: new Date("2026-10-16T00:00:00Z"),
      lastSuccessAt: new Date("2026-10-16T00:00:00Z"),
      backlogCount: 0,
      shippingWritebackEnabled: false,
      inventoryWritebackEnabled: false,
      writebackMode: "manual_confirm",
    },
    {
      platform: "ebay",
      externalShopId: "EBAY-AU-001",
      shopName: "eBay 澳洲试点店",
      authorizationStatus: "expired",
      lastAttemptAt: new Date("2026-10-16T00:05:00Z"),
      lastSuccessAt: new Date("2026-10-15T22:00:00Z"),
      errorSummary: "授权已过期：请重新完成官方授权；当前暂停读取与写入。",
      backlogCount: 3,
      shippingWritebackEnabled: false,
      inventoryWritebackEnabled: false,
      writebackMode: "manual_confirm",
    },
  ]);

  await db.insert(tasks).values([
    {
      stableKey: "seed:store:ebay:auth",
      severity: "critical",
      type: "authorization_invalid",
      title: "eBay 澳洲试点店授权失效",
      reason: "平台授权已过期，读取与写入任务暂停；历史经营记录保留。",
      businessType: "store",
      businessId: 2,
      ownerId: operatorId,
      dueAt: new Date("2026-10-16T02:00:00Z"),
      status: "open",
      source: "auto",
    },
    {
      stableKey: "seed:order:shortage",
      severity: "high",
      type: "stock_shortage",
      title: "订单 AU-7001 缺货 1 件",
      reason: "已付款订单需要 2 件托盘，当前仅分配 1 件；系统未制造负库存。",
      businessType: "order",
      businessId: shortageOrderId,
      ownerId: operatorId,
      dueAt: new Date("2026-10-17T00:00:00Z"),
      status: "open",
      source: "auto",
    },
    {
      stableKey: "seed:after-sales:inspection",
      severity: "medium",
      type: "return_pending_inspection",
      title: "售后退货待质检",
      reason: "退货已收到但未质检，合格前不得增加可售库存。",
      businessType: "after_sales",
      businessId: afterSalesId,
      ownerId: operatorId,
      dueAt: new Date("2026-10-17T00:00:00Z"),
      status: "open",
      source: "auto",
    },
  ]);

  console.log("Seed complete.");
  process.exit(0);
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});
