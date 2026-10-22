import {
  bigint,
  boolean,
  decimal,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

const timestamps = {
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
};

export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  unionId: varchar("unionId", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 320 }),
  avatar: text("avatar"),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  businessRole: mysqlEnum("businessRole", [
    "admin",
    "operations",
    "fulfillment",
    "finance",
  ])
    .default("operations")
    .notNull(),
  status: mysqlEnum("status", ["active", "disabled"])
    .default("active")
    .notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
  lastSignInAt: timestamp("lastSignInAt").defaultNow().notNull(),
});

/**
 * 自托管账户凭据。与 users 分开存放，既避免把密码散列混入业务用户读模型，
 * 也允许原有 Kimi 用户在不改表结构的情况下逐步迁移到邮箱密码登录。
 */
export const localAccounts = mysqlTable(
  "local_accounts",
  {
    id: serial("id").primaryKey(),
    userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
    email: varchar("email", { length: 320 }).notNull(),
    passwordHash: varchar("passwordHash", { length: 255 }).notNull(),
    sessionVersion: int("sessionVersion").default(0).notNull(),
    failedLoginAttempts: int("failedLoginAttempts").default(0).notNull(),
    lockedUntil: timestamp("lockedUntil"),
    passwordChangedAt: timestamp("passwordChangedAt").defaultNow().notNull(),
    lastLoginAt: timestamp("lastLoginAt"),
    ...timestamps,
  },
  table => [
    uniqueIndex("local_accounts_user_key").on(table.userId),
    uniqueIndex("local_accounts_email_key").on(table.email),
  ]
);

export const files = mysqlTable(
  "files",
  {
    id: serial("id").primaryKey(),
    key: varchar("key", { length: 512 }).notNull().unique(),
    ownerId: bigint("ownerId", { mode: "number", unsigned: true }).notNull(),
    name: varchar("name", { length: 512 }).notNull(),
    size: int("size").notNull(),
    contentType: varchar("contentType", { length: 255 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("files_owner_idx").on(table.ownerId)]
);

export const suppliers = mysqlTable("suppliers", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  shopUrl: varchar("shopUrl", { length: 1024 }),
  contactName: varchar("contactName", { length: 255 }),
  contactInfo: varchar("contactInfo", { length: 512 }),
  notes: text("notes"),
  ...timestamps,
});

export const productCandidates = mysqlTable(
  "product_candidates",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    sourceUrl: varchar("sourceUrl", { length: 1024 }).notNull(),
    supplierId: bigint("supplierId", {
      mode: "number",
      unsigned: true,
    }).notNull(),
    spec: varchar("spec", { length: 512 }).notNull(),
    currency: mysqlEnum("currency", ["CNY", "AUD", "USD"])
      .default("CNY")
      .notNull(),
    quote: decimal("quote", { precision: 14, scale: 2 }).notNull(),
    moq: int("moq"),
    leadTimeDays: int("leadTimeDays"),
    weight: decimal("weight", { precision: 12, scale: 3 }),
    weightUnit: mysqlEnum("weightUnit", ["g", "kg"]).default("g"),
    dimensions: varchar("dimensions", { length: 255 }),
    packaging: varchar("packaging", { length: 255 }),
    referencePrice: decimal("referencePrice", { precision: 14, scale: 2 }),
    sampleCost: decimal("sampleCost", { precision: 14, scale: 2 }),
    status: mysqlEnum("status", [
      "candidate",
      "sample_evaluation",
      "pending_decision",
      "adopted",
      "rejected",
      "paused",
    ])
      .default("candidate")
      .notNull(),
    sampleScore: int("sampleScore"),
    sampleReview: text("sampleReview"),
    decisionNote: text("decisionNote"),
    etsyStatus: mysqlEnum("etsyStatus", [
      "pending",
      "assess",
      "approved",
      "rejected",
    ])
      .default("pending")
      .notNull(),
    ebayStatus: mysqlEnum("ebayStatus", [
      "pending",
      "assess",
      "approved",
      "rejected",
    ])
      .default("pending")
      .notNull(),
    complianceBasis: text("complianceBasis"),
    complianceCheckedAt: timestamp("complianceCheckedAt"),
    confirmedById: bigint("confirmedById", { mode: "number", unsigned: true }),
    attachmentKeys: json("attachmentKeys").$type<string[]>(),
    convertedSkuId: bigint("convertedSkuId", {
      mode: "number",
      unsigned: true,
    }),
    operatorId: bigint("operatorId", {
      mode: "number",
      unsigned: true,
    }).notNull(),
    ...timestamps,
  },
  table => [
    index("candidate_supplier_idx").on(table.supplierId),
  ]
);

export const skus = mysqlTable(
  "skus",
  {
    id: serial("id").primaryKey(),
    code: varchar("code", { length: 128 }).notNull().unique(),
    name: varchar("name", { length: 255 }).notNull(),
    productName: varchar("productName", { length: 255 }).notNull(),
    spec: varchar("spec", { length: 512 }).notNull(),
    imageKey: varchar("imageKey", { length: 512 }),
    weight: decimal("weight", { precision: 12, scale: 3 }),
    weightUnit: mysqlEnum("weightUnit", ["g", "kg"]).default("g"),
    dimensions: varchar("dimensions", { length: 255 }),
    sourcePlatform: varchar("sourcePlatform", { length: 100 }).default("1688"),
    supplierSku: varchar("supplierSku", { length: 255 }),
    declarationNameEn: varchar("declarationNameEn", { length: 255 }),
    material: varchar("material", { length: 255 }),
    originCountry: varchar("originCountry", { length: 100 }),
    hsCode: varchar("hsCode", { length: 100 }),
    status: mysqlEnum("status", ["active", "inactive"])
      .default("active")
      .notNull(),
    alertThreshold: int("alertThreshold").default(0).notNull(),
    ...timestamps,
  },
  table => [index("sku_status_idx").on(table.status)]
);

export const channelListings = mysqlTable(
  "channel_listings",
  {
    id: serial("id").primaryKey(),
    platform: mysqlEnum("platform", ["etsy", "ebay"]).notNull(),
    externalShopId: varchar("externalShopId", { length: 255 }).notNull(),
    externalListingId: varchar("externalListingId", { length: 255 }).notNull(),
    externalVariantId: varchar("externalVariantId", { length: 255 }).notNull(),
    platformSku: varchar("platformSku", { length: 255 }),
    skuId: bigint("skuId", { mode: "number", unsigned: true }),
    title: varchar("title", { length: 512 }).notNull(),
    url: varchar("url", { length: 1024 }),
    price: decimal("price", { precision: 14, scale: 2 }).notNull(),
    currency: mysqlEnum("currency", ["AUD", "USD", "CNY"])
      .default("AUD")
      .notNull(),
    shippingInfo: varchar("shippingInfo", { length: 512 }),
    platformStatus: varchar("platformStatus", { length: 255 })
      .default("unknown")
      .notNull(),
    lastSyncAt: timestamp("lastSyncAt"),
    rawSnapshot: json("rawSnapshot").$type<Record<string, unknown>>(),
    ...timestamps,
  },
  table => [
    uniqueIndex("listing_external_key").on(
      table.platform,
      table.externalShopId,
      table.externalListingId,
      table.externalVariantId
    ),
    index("listing_sku_idx").on(table.skuId),
  ]
);

/**
 * 主商品（skus）在各个销售市场上的刊登详情。本地编辑只写 localPayload，
 * 不会自动推送到平台；push / publish / unpublish 需要管理员明确操作。
 */
export const marketplaceListings = mysqlTable(
  "marketplace_listings",
  {
    id: serial("id").primaryKey(),
    skuId: bigint("skuId", { mode: "number", unsigned: true }).notNull(),
    platform: mysqlEnum("platform", ["ebay", "etsy", "amazon"]).notNull(),
    storeConnectionId: bigint("storeConnectionId", {
      mode: "number",
      unsigned: true,
    }).notNull(),
    status: mysqlEnum("status", [
      "draft",
      "ready",
      "publishing",
      "published",
      "unpublished",
      "failed",
    ])
      .default("draft")
      .notNull(),
    platformSku: varchar("platformSku", { length: 255 }),
    externalListingId: varchar("externalListingId", { length: 255 }),
    externalOfferId: varchar("externalOfferId", { length: 255 }),
    listingUrl: varchar("listingUrl", { length: 1024 }),
    localPayload: json("localPayload").$type<Record<string, unknown>>(),
    lastPushedPayload: json("lastPushedPayload").$type<Record<string, unknown>>(),
    lastPushedHash: varchar("lastPushedHash", { length: 64 }),
    lastError: text("lastError"),
    lastPushedAt: timestamp("lastPushedAt"),
    publishedAt: timestamp("publishedAt"),
    createdBy: bigint("createdBy", { mode: "number", unsigned: true }),
    ...timestamps,
  },
  table => [
    uniqueIndex("marketplace_listing_key").on(
      table.skuId,
      table.platform,
      table.storeConnectionId
    ),
    index("marketplace_listing_status_idx").on(table.platform, table.status),
    index("marketplace_listing_store_idx").on(table.storeConnectionId),
  ]
);

export const purchaseOrders = mysqlTable(
  "purchase_orders",
  {
    id: serial("id").primaryKey(),
    internalNo: varchar("internalNo", { length: 128 }).notNull().unique(),
    supplierId: bigint("supplierId", {
      mode: "number",
      unsigned: true,
    }).notNull(),
    externalOrderNo: varchar("externalOrderNo", { length: 255 }),
    externalOrderUrl: varchar("externalOrderUrl", { length: 1024 }),
    orderedAt: timestamp("orderedAt"),
    expectedArrivalAt: timestamp("expectedArrivalAt"),
    ownerId: bigint("ownerId", { mode: "number", unsigned: true }).notNull(),
    flowStatus: mysqlEnum("flowStatus", [
      "draft",
      "ordered",
      "closed",
      "cancelled",
    ])
      .default("draft")
      .notNull(),
    receiveStatus: mysqlEnum("receiveStatus", ["none", "partial", "full"])
      .default("none")
      .notNull(),
    notes: text("notes"),
    closeReason: text("closeReason"),
    attachmentKeys: json("attachmentKeys").$type<string[]>(),
    ...timestamps,
  },
  table => [
    uniqueIndex("po_supplier_external_idx").on(
      table.supplierId,
      table.externalOrderNo
    ),
    index("po_status_idx").on(table.flowStatus, table.receiveStatus),
  ]
);

export const purchaseOrderLines = mysqlTable(
  "purchase_order_lines",
  {
    id: serial("id").primaryKey(),
    purchaseOrderId: bigint("purchaseOrderId", {
      mode: "number",
      unsigned: true,
    }).notNull(),
    skuId: bigint("skuId", { mode: "number", unsigned: true }).notNull(),
    supplierSpec: varchar("supplierSpec", { length: 512 }).notNull(),
    quantity: int("quantity").notNull(),
    receivedQty: int("receivedQty").default(0).notNull(),
    closedQty: int("closedQty").default(0).notNull(),
    unitPrice: decimal("unitPrice", { precision: 14, scale: 4 }).notNull(),
    currency: mysqlEnum("currency", ["CNY", "AUD", "USD"])
      .default("CNY")
      .notNull(),
    discount: decimal("discount", { precision: 14, scale: 2 })
      .default("0")
      .notNull(),
    allocatedCostAud: decimal("allocatedCostAud", { precision: 14, scale: 4 }),
    ...timestamps,
  },
  table => [
    index("po_line_po_idx").on(table.purchaseOrderId),
    index("po_line_sku_idx").on(table.skuId),
  ]
);

export const paymentRecords = mysqlTable(
  "payment_records",
  {
    id: serial("id").primaryKey(),
    purchaseOrderId: bigint("purchaseOrderId", {
      mode: "number",
      unsigned: true,
    }).notNull(),
    type: mysqlEnum("type", ["payment", "supplier_refund"]).notNull(),
    paidAt: timestamp("paidAt").notNull(),
    currency: mysqlEnum("currency", ["CNY", "AUD", "USD"]).notNull(),
    amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
    referenceNo: varchar("referenceNo", { length: 255 }),
    voucherKey: varchar("voucherKey", { length: 512 }),
    note: text("note"),
    recordedById: bigint("recordedById", {
      mode: "number",
      unsigned: true,
    }).notNull(),
    idempotencyKey: varchar("idempotencyKey", { length: 255 })
      .notNull()
      .unique(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("payment_po_idx").on(table.purchaseOrderId)]
);

export const goodsReceipts = mysqlTable(
  "goods_receipts",
  {
    id: serial("id").primaryKey(),
    purchaseOrderId: bigint("purchaseOrderId", {
      mode: "number",
      unsigned: true,
    }).notNull(),
    receivedAt: timestamp("receivedAt").notNull(),
    note: text("note"),
    idempotencyKey: varchar("idempotencyKey", { length: 255 })
      .notNull()
      .unique(),
    postedById: bigint("postedById", {
      mode: "number",
      unsigned: true,
    }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("receipt_po_idx").on(table.purchaseOrderId)]
);

export const goodsReceiptLines = mysqlTable(
  "goods_receipt_lines",
  {
    id: serial("id").primaryKey(),
    goodsReceiptId: bigint("goodsReceiptId", {
      mode: "number",
      unsigned: true,
    }).notNull(),
    purchaseOrderLineId: bigint("purchaseOrderLineId", {
      mode: "number",
      unsigned: true,
    }).notNull(),
    skuId: bigint("skuId", { mode: "number", unsigned: true }).notNull(),
    receivedQty: int("receivedQty").notNull(),
    qualifiedQty: int("qualifiedQty").notNull(),
    defectiveQty: int("defectiveQty").notNull(),
    pendingQty: int("pendingQty").notNull(),
    overReceiptReason: text("overReceiptReason"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("receipt_line_receipt_idx").on(table.goodsReceiptId)]
);

export const inventoryPositions = mysqlTable(
  "inventory_positions",
  {
    id: serial("id").primaryKey(),
    skuId: bigint("skuId", { mode: "number", unsigned: true }).notNull(),
    location: varchar("location", { length: 128 }).default("MAIN").notNull(),
    physicalQty: int("physicalQty").default(0).notNull(),
    qualifiedQty: int("qualifiedQty").default(0).notNull(),
    unqualifiedQty: int("unqualifiedQty").default(0).notNull(),
    reservedQty: int("reservedQty").default(0).notNull(),
    shortageQty: int("shortageQty").default(0).notNull(),
    updatedAt: timestamp("updatedAt")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  table => [
    uniqueIndex("inventory_position_key").on(table.skuId, table.location),
  ]
);

export const inventoryLots = mysqlTable(
  "inventory_lots",
  {
    id: serial("id").primaryKey(),
    skuId: bigint("skuId", { mode: "number", unsigned: true }).notNull(),
    location: varchar("location", { length: 128 }).default("MAIN").notNull(),
    batchCode: varchar("batchCode", { length: 128 }).notNull(),
    sourceType: mysqlEnum("sourceType", [
      "purchase",
      "return",
      "adjustment",
      "initial",
    ]).notNull(),
    sourceId: bigint("sourceId", { mode: "number", unsigned: true }),
    receivedAt: timestamp("receivedAt").notNull(),
    qtyRemaining: int("qtyRemaining").default(0).notNull(),
    qualifiedRemaining: int("qualifiedRemaining").default(0).notNull(),
    unqualifiedRemaining: int("unqualifiedRemaining").default(0).notNull(),
    unitCostCny: decimal("unitCostCny", { precision: 14, scale: 4 }),
    unitCostAud: decimal("unitCostAud", { precision: 14, scale: 4 }),
    costStatus: mysqlEnum("costStatus", ["complete", "missing"])
      .default("missing")
      .notNull(),
    ...timestamps,
  },
  table => [
    uniqueIndex("inventory_lot_key").on(
      table.skuId,
      table.location,
      table.batchCode
    ),
    index("inventory_lot_fifo_idx").on(table.skuId, table.receivedAt),
  ]
);

export const inventoryLedger = mysqlTable(
  "inventory_ledger",
  {
    id: serial("id").primaryKey(),
    skuId: bigint("skuId", { mode: "number", unsigned: true }).notNull(),
    location: varchar("location", { length: 128 }).default("MAIN").notNull(),
    lotId: bigint("lotId", { mode: "number", unsigned: true }),
    type: mysqlEnum("type", [
      "purchase_inbound",
      "inspection_release",
      "order_reservation",
      "reservation_release",
      "shipment_outbound",
      "sales_return_inbound",
      "purchase_return",
      "writeoff",
      "count_adjustment",
      "cost_adjustment",
    ]).notNull(),
    qualifiedDelta: int("qualifiedDelta").default(0).notNull(),
    unqualifiedDelta: int("unqualifiedDelta").default(0).notNull(),
    reservedDelta: int("reservedDelta").default(0).notNull(),
    businessType: varchar("businessType", { length: 64 }),
    businessId: bigint("businessId", { mode: "number", unsigned: true }),
    unitCostAud: decimal("unitCostAud", { precision: 14, scale: 4 }),
    reason: text("reason"),
    idempotencyKey: varchar("idempotencyKey", { length: 255 })
      .notNull()
      .unique(),
    actorId: bigint("actorId", { mode: "number", unsigned: true }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("ledger_sku_idx").on(table.skuId, table.createdAt),
    index("ledger_business_idx").on(table.businessType, table.businessId),
  ]
);

export const salesOrders = mysqlTable(
  "sales_orders",
  {
    id: serial("id").primaryKey(),
    platform: mysqlEnum("platform", ["etsy", "ebay"]).notNull(),
    externalShopId: varchar("externalShopId", { length: 255 }).notNull(),
    externalOrderId: varchar("externalOrderId", { length: 255 }).notNull(),
    orderNo: varchar("orderNo", { length: 255 }).notNull(),
    buyerName: varchar("buyerName", { length: 255 }),
    buyerEmail: varchar("buyerEmail", { length: 320 }),
    destinationCountry: varchar("destinationCountry", { length: 100 }),
    postalCode: varchar("postalCode", { length: 64 }),
    addressSummary: varchar("addressSummary", { length: 512 }),
    rawStatus: varchar("rawStatus", { length: 255 }).notNull(),
    paymentStatus: mysqlEnum("paymentStatus", [
      "unpaid",
      "paid",
      "partial_refund",
      "refunded",
      "unknown",
    ])
      .default("unknown")
      .notNull(),
    internalStatus: mysqlEnum("internalStatus", [
      "pending",
      "matching",
      "shortage",
      "picking",
      "packing",
      "awaiting_dispatch",
      "fulfilled",
      "out_of_scope",
    ])
      .default("pending")
      .notNull(),
    fulfillmentStatus: mysqlEnum("fulfillmentStatus", [
      "unshipped",
      "partial",
      "full",
    ])
      .default("unshipped")
      .notNull(),
    afterSalesStatus: mysqlEnum("afterSalesStatus", ["none", "open", "closed"])
      .default("none")
      .notNull(),
    syncStatus: mysqlEnum("syncStatus", [
      "normal",
      "delayed",
      "failed",
      "auth_invalid",
    ])
      .default("normal")
      .notNull(),
    profitStatus: mysqlEnum("profitStatus", [
      "estimated",
      "incomplete",
      "verified",
    ])
      .default("incomplete")
      .notNull(),
    profitVerifiedById: bigint("profitVerifiedById", {
      mode: "number",
      unsigned: true,
    }),
    profitVerifiedAt: timestamp("profitVerifiedAt"),
    profitRevisionReason: text("profitRevisionReason"),
    orderedAt: timestamp("orderedAt").notNull(),
    platformUpdatedAt: timestamp("platformUpdatedAt"),
    shipBy: timestamp("shipBy"),
    internalShipBy: timestamp("internalShipBy"),
    ownerId: bigint("ownerId", { mode: "number", unsigned: true }),
    currency: mysqlEnum("currency", ["AUD", "USD", "CNY"])
      .default("AUD")
      .notNull(),
    subtotal: decimal("subtotal", { precision: 14, scale: 2 }).notNull(),
    shippingPaid: decimal("shippingPaid", { precision: 14, scale: 2 })
      .default("0")
      .notNull(),
    taxCollected: decimal("taxCollected", { precision: 14, scale: 2 })
      .default("0")
      .notNull(),
    discount: decimal("discount", { precision: 14, scale: 2 })
      .default("0")
      .notNull(),
    total: decimal("total", { precision: 14, scale: 2 }).notNull(),
    note: text("note"),
    externalVersion: varchar("externalVersion", { length: 255 }),
    rawSnapshot: json("rawSnapshot").$type<Record<string, unknown>>(),
    ...timestamps,
  },
  table => [
    uniqueIndex("order_external_key").on(
      table.platform,
      table.externalShopId,
      table.externalOrderId
    ),
    index("order_status_idx").on(
      table.internalStatus,
      table.paymentStatus,
      table.shipBy
    ),
  ]
);

export const salesOrderLines = mysqlTable(
  "sales_order_lines",
  {
    id: serial("id").primaryKey(),
    salesOrderId: bigint("salesOrderId", {
      mode: "number",
      unsigned: true,
    }).notNull(),
    listingId: bigint("listingId", { mode: "number", unsigned: true }),
    skuId: bigint("skuId", { mode: "number", unsigned: true }),
    externalSku: varchar("externalSku", { length: 255 }),
    title: varchar("title", { length: 512 }).notNull(),
    quantity: int("quantity").notNull(),
    unitPrice: decimal("unitPrice", { precision: 14, scale: 4 }).notNull(),
    discount: decimal("discount", { precision: 14, scale: 2 })
      .default("0")
      .notNull(),
    allocatedQty: int("allocatedQty").default(0).notNull(),
    shippedQty: int("shippedQty").default(0).notNull(),
    shortageQty: int("shortageQty").default(0).notNull(),
    snapshot: json("snapshot").$type<Record<string, unknown>>(),
    ...timestamps,
  },
  table => [
    index("order_line_order_idx").on(table.salesOrderId),
    index("order_line_sku_idx").on(table.skuId),
  ]
);

export const shipments = mysqlTable(
  "shipments",
  {
    id: serial("id").primaryKey(),
    salesOrderId: bigint("salesOrderId", {
      mode: "number",
      unsigned: true,
    }).notNull(),
    packageNo: varchar("packageNo", { length: 128 }).notNull(),
    carrier: varchar("carrier", { length: 255 }).notNull(),
    service: varchar("service", { length: 255 }).notNull(),
    trackingNo: varchar("trackingNo", { length: 255 }),
    trackingUrl: varchar("trackingUrl", { length: 1024 }),
    weight: decimal("weight", { precision: 12, scale: 3 }),
    weightUnit: mysqlEnum("weightUnit", ["g", "kg"]).default("g"),
    freightEstimate: decimal("freightEstimate", { precision: 14, scale: 2 }),
    freightActual: decimal("freightActual", { precision: 14, scale: 2 }),
    currency: mysqlEnum("currency", ["AUD", "USD", "CNY"])
      .default("AUD")
      .notNull(),
    status: mysqlEnum("status", [
      "draft",
      "dispatched",
      "platform_pending",
      "platform_confirmed",
      "platform_failed",
    ])
      .default("draft")
      .notNull(),
    dispatchedAt: timestamp("dispatchedAt"),
    proofKey: varchar("proofKey", { length: 512 }),
    platformMessage: text("platformMessage"),
    idempotencyKey: varchar("idempotencyKey", { length: 255 })
      .notNull()
      .unique(),
    createdById: bigint("createdById", {
      mode: "number",
      unsigned: true,
    }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("shipment_order_idx").on(table.salesOrderId),
    index("shipment_status_idx").on(table.status),
  ]
);

export const shipmentLines = mysqlTable(
  "shipment_lines",
  {
    id: serial("id").primaryKey(),
    shipmentId: bigint("shipmentId", {
      mode: "number",
      unsigned: true,
    }).notNull(),
    salesOrderLineId: bigint("salesOrderLineId", {
      mode: "number",
      unsigned: true,
    }).notNull(),
    quantity: int("quantity").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    uniqueIndex("shipment_line_key").on(
      table.shipmentId,
      table.salesOrderLineId
    ),
  ]
);

export const afterSalesCases = mysqlTable(
  "after_sales_cases",
  {
    id: serial("id").primaryKey(),
    salesOrderId: bigint("salesOrderId", {
      mode: "number",
      unsigned: true,
    }).notNull(),
    type: mysqlEnum("type", [
      "refund_only",
      "return_refund",
      "reship",
      "cancel_assist",
      "dispute",
    ]).notNull(),
    status: mysqlEnum("status", [
      "pending",
      "processing",
      "waiting_external",
      "closed",
    ])
      .default("pending")
      .notNull(),
    refundStatus: mysqlEnum("refundStatus", [
      "none",
      "pending",
      "confirmed",
      "failed",
    ])
      .default("none")
      .notNull(),
    returnStatus: mysqlEnum("returnStatus", [
      "none",
      "awaiting",
      "received",
      "pending_inspection",
      "qualified",
      "defective",
    ])
      .default("none")
      .notNull(),
    reason: text("reason").notNull(),
    responsibility: varchar("responsibility", { length: 255 }),
    amount: decimal("amount", { precision: 14, scale: 2 })
      .default("0")
      .notNull(),
    currency: mysqlEnum("currency", ["AUD", "USD", "CNY"])
      .default("AUD")
      .notNull(),
    ownerId: bigint("ownerId", { mode: "number", unsigned: true }),
    externalEventId: varchar("externalEventId", { length: 255 }),
    resolution: text("resolution"),
    attachmentKeys: json("attachmentKeys").$type<string[]>(),
    createdById: bigint("createdById", {
      mode: "number",
      unsigned: true,
    }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    closedAt: timestamp("closedAt"),
  },
  table => [
    index("after_sales_order_idx").on(table.salesOrderId),
    uniqueIndex("after_sales_external_idx").on(table.externalEventId),
  ]
);

export const exchangeRates = mysqlTable(
  "exchange_rates",
  {
    id: serial("id").primaryKey(),
    baseCurrency: mysqlEnum("baseCurrency", ["CNY", "USD", "AUD"]).notNull(),
    quoteCurrency: mysqlEnum("quoteCurrency", ["AUD"]).default("AUD").notNull(),
    rate: decimal("rate", { precision: 18, scale: 6 }).notNull(),
    rateDate: timestamp("rateDate").notNull(),
    source: varchar("source", { length: 255 }).notNull(),
    isDefault: boolean("isDefault").default(false).notNull(),
    createdById: bigint("createdById", {
      mode: "number",
      unsigned: true,
    }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("exchange_rate_currency_idx").on(table.baseCurrency, table.rateDate),
  ]
);

export const costEntries = mysqlTable(
  "cost_entries",
  {
    id: serial("id").primaryKey(),
    businessType: mysqlEnum("businessType", [
      "purchase",
      "order",
      "after_sales",
      "settlement",
      "period",
    ]).notNull(),
    businessId: bigint("businessId", {
      mode: "number",
      unsigned: true,
    }).notNull(),
    category: varchar("category", { length: 255 }).notNull(),
    amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
    currency: mysqlEnum("currency", ["CNY", "AUD", "USD"]).notNull(),
    exchangeRateId: bigint("exchangeRateId", {
      mode: "number",
      unsigned: true,
    }),
    audAmount: decimal("audAmount", { precision: 14, scale: 2 }),
    entryKind: mysqlEnum("entryKind", ["estimate", "actual", "reversal"])
      .default("actual")
      .notNull(),
    allocationStatus: mysqlEnum("allocationStatus", [
      "unallocated",
      "partial",
      "allocated",
    ])
      .default("unallocated")
      .notNull(),
    replacesId: bigint("replacesId", { mode: "number", unsigned: true }),
    note: text("note"),
    createdById: bigint("createdById", {
      mode: "number",
      unsigned: true,
    }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("cost_business_idx").on(table.businessType, table.businessId)]
);

export const costAllocations = mysqlTable(
  "cost_allocations",
  {
    id: serial("id").primaryKey(),
    costEntryId: bigint("costEntryId", {
      mode: "number",
      unsigned: true,
    }).notNull(),
    targetType: mysqlEnum("targetType", [
      "lot",
      "order",
      "after_sales",
      "settlement",
      "period",
    ]).notNull(),
    targetId: bigint("targetId", { mode: "number", unsigned: true }).notNull(),
    amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
    audAmount: decimal("audAmount", { precision: 14, scale: 2 }),
    reason: text("reason"),
    createdById: bigint("createdById", {
      mode: "number",
      unsigned: true,
    }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("allocation_entry_idx").on(table.costEntryId),
    index("allocation_target_idx").on(table.targetType, table.targetId),
  ]
);

export const settlements = mysqlTable(
  "settlements",
  {
    id: serial("id").primaryKey(),
    platform: mysqlEnum("platform", ["etsy", "ebay"]).notNull(),
    externalShopId: varchar("externalShopId", { length: 255 }).notNull(),
    referenceNo: varchar("referenceNo", { length: 255 }).notNull(),
    periodStart: timestamp("periodStart").notNull(),
    periodEnd: timestamp("periodEnd").notNull(),
    currency: mysqlEnum("currency", ["AUD", "USD", "CNY"])
      .default("AUD")
      .notNull(),
    grossAmount: decimal("grossAmount", { precision: 14, scale: 2 }).notNull(),
    fees: decimal("fees", { precision: 14, scale: 2 }).default("0").notNull(),
    refunds: decimal("refunds", { precision: 14, scale: 2 })
      .default("0")
      .notNull(),
    taxes: decimal("taxes", { precision: 14, scale: 2 }).default("0").notNull(),
    withheld: decimal("withheld", { precision: 14, scale: 2 })
      .default("0")
      .notNull(),
    adjustments: decimal("adjustments", { precision: 14, scale: 2 })
      .default("0")
      .notNull(),
    netPlatformPayout: decimal("netPlatformPayout", {
      precision: 14,
      scale: 2,
    }).notNull(),
    actualReceived: decimal("actualReceived", { precision: 14, scale: 2 }),
    status: mysqlEnum("status", ["pending", "reconciled", "discrepancy"])
      .default("pending")
      .notNull(),
    note: text("note"),
    reconciledById: bigint("reconciledById", {
      mode: "number",
      unsigned: true,
    }),
    reconciledAt: timestamp("reconciledAt"),
    ...timestamps,
  },
  table => [
    uniqueIndex("settlement_reference_idx").on(
      table.platform,
      table.externalShopId,
      table.referenceNo
    ),
  ]
);

export const storeConnections = mysqlTable(
  "store_connections",
  {
    id: serial("id").primaryKey(),
    platform: mysqlEnum("platform", ["etsy", "ebay"]).notNull(),
    externalShopId: varchar("externalShopId", { length: 255 }).notNull(),
    shopName: varchar("shopName", { length: 255 }).notNull(),
    authorizationStatus: mysqlEnum("authorizationStatus", [
      "not_connected",
      "authorized",
      "expired",
      "revoked",
    ])
      .default("not_connected")
      .notNull(),
    lastAttemptAt: timestamp("lastAttemptAt"),
    lastSuccessAt: timestamp("lastSuccessAt"),
    syncCursor: varchar("syncCursor", { length: 1024 }),
    errorSummary: text("errorSummary"),
    backlogCount: int("backlogCount").default(0).notNull(),
    shippingWritebackEnabled: boolean("shippingWritebackEnabled")
      .default(false)
      .notNull(),
    inventoryWritebackEnabled: boolean("inventoryWritebackEnabled")
      .default(false)
      .notNull(),
    writebackMode: mysqlEnum("writebackMode", [
      "system_controlled",
      "manual_confirm",
    ]),
    // 官方 OAuth 直连后写入的账号快照。凭证本身保存在 store_credentials，绝不随 workspace 查询返回。
    externalAccountId: varchar("externalAccountId", { length: 255 }),
    accountLabel: varchar("accountLabel", { length: 255 }),
    connectedBy: bigint("connectedBy", { mode: "number", unsigned: true }),
    connectedAt: timestamp("connectedAt"),
    profileSyncedAt: timestamp("profileSyncedAt"),
    profileSummary: text("profileSummary"),
    ...timestamps,
  },
  table => [
    uniqueIndex("store_connection_key").on(
      table.platform,
      table.externalShopId
    ),
  ]
);

/**
 * 平台 OAuth 凭证。accessToken / refreshToken 使用 AES-256-GCM 加密后存储，
 * 仅服务端集成模块可读取；任何 tRPC 查询都不会 select 本表。
 */
export const storeCredentials = mysqlTable(
  "store_credentials",
  {
    id: serial("id").primaryKey(),
    storeConnectionId: bigint("storeConnectionId", {
      mode: "number",
      unsigned: true,
    }).notNull(),
    platform: mysqlEnum("platform", ["etsy", "ebay"]).notNull(),
    accessToken: text("accessToken").notNull(),
    refreshToken: text("refreshToken"),
    tokenExpiresAt: timestamp("tokenExpiresAt"),
    scopes: text("scopes"),
    tokenType: varchar("tokenType", { length: 32 }),
    lastRefreshedAt: timestamp("lastRefreshedAt"),
    ...timestamps,
  },
  table => [
    uniqueIndex("store_credentials_store_key").on(table.storeConnectionId),
  ]
);

export const syncJobs = mysqlTable(
  "sync_jobs",
  {
    id: serial("id").primaryKey(),
    storeConnectionId: bigint("storeConnectionId", {
      mode: "number",
      unsigned: true,
    }).notNull(),
    resourceType: mysqlEnum("resourceType", [
      "orders",
      "listings",
      "refunds",
      "shipments",
      "inventory",
    ]).notNull(),
    status: mysqlEnum("status", [
      "queued",
      "running",
      "succeeded",
      "failed",
      "retrying",
    ]).notNull(),
    attemptCount: int("attemptCount").default(0).notNull(),
    lastError: text("lastError"),
    startedAt: timestamp("startedAt"),
    finishedAt: timestamp("finishedAt"),
    idempotencyKey: varchar("idempotencyKey", { length: 255 })
      .notNull()
      .unique(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("sync_job_store_idx").on(table.storeConnectionId, table.status),
  ]
);

export const tasks = mysqlTable(
  "tasks",
  {
    id: serial("id").primaryKey(),
    stableKey: varchar("stableKey", { length: 255 }).notNull().unique(),
    severity: mysqlEnum("severity", ["critical", "high", "medium", "low"])
      .default("medium")
      .notNull(),
    type: varchar("type", { length: 128 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    reason: text("reason").notNull(),
    businessType: mysqlEnum("businessType", [
      "order",
      "purchase",
      "after_sales",
      "store",
      "sku",
      "sync",
    ]).notNull(),
    businessId: bigint("businessId", {
      mode: "number",
      unsigned: true,
    }).notNull(),
    ownerId: bigint("ownerId", { mode: "number", unsigned: true }),
    dueAt: timestamp("dueAt"),
    status: mysqlEnum("status", ["open", "closed"]).default("open").notNull(),
    source: mysqlEnum("source", ["manual", "auto"]).default("manual").notNull(),
    createdById: bigint("createdById", { mode: "number", unsigned: true }),
    reopenCount: int("reopenCount").default(0).notNull(),
    resolvedAt: timestamp("resolvedAt"),
    closedAt: timestamp("closedAt"),
    ...timestamps,
  },
  table => [
    index("task_status_idx").on(table.status, table.severity, table.dueAt),
  ]
);

export const notes = mysqlTable(
  "notes",
  {
    id: serial("id").primaryKey(),
    businessType: mysqlEnum("businessType", [
      "order",
      "purchase",
      "after_sales",
      "candidate",
      "sku",
    ]).notNull(),
    businessId: bigint("businessId", {
      mode: "number",
      unsigned: true,
    }).notNull(),
    body: text("body").notNull(),
    visibility: mysqlEnum("visibility", ["internal"])
      .default("internal")
      .notNull(),
    attachmentKey: varchar("attachmentKey", { length: 512 }),
    createdById: bigint("createdById", {
      mode: "number",
      unsigned: true,
    }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("note_business_idx").on(table.businessType, table.businessId)]
);

export const auditLogs = mysqlTable(
  "audit_logs",
  {
    id: serial("id").primaryKey(),
    actorId: bigint("actorId", { mode: "number", unsigned: true }),
    action: varchar("action", { length: 255 }).notNull(),
    entityType: varchar("entityType", { length: 128 }).notNull(),
    entityId: varchar("entityId", { length: 128 }).notNull(),
    beforeJson: json("beforeJson").$type<unknown>(),
    afterJson: json("afterJson").$type<unknown>(),
    reason: text("reason"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("audit_entity_idx").on(table.entityType, table.entityId),
    index("audit_actor_idx").on(table.actorId, table.createdAt),
  ]
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type LocalAccount = typeof localAccounts.$inferSelect;
export type InsertLocalAccount = typeof localAccounts.$inferInsert;
export type Supplier = typeof suppliers.$inferSelect;
export type ProductCandidate = typeof productCandidates.$inferSelect;
export type Sku = typeof skus.$inferSelect;
export type ChannelListing = typeof channelListings.$inferSelect;
export type MarketplaceListing = typeof marketplaceListings.$inferSelect;
export type PurchaseOrder = typeof purchaseOrders.$inferSelect;
export type PurchaseOrderLine = typeof purchaseOrderLines.$inferSelect;
export type PaymentRecord = typeof paymentRecords.$inferSelect;
export type GoodsReceipt = typeof goodsReceipts.$inferSelect;
export type InventoryPosition = typeof inventoryPositions.$inferSelect;
export type InventoryLot = typeof inventoryLots.$inferSelect;
export type InventoryLedger = typeof inventoryLedger.$inferSelect;
export type SalesOrder = typeof salesOrders.$inferSelect;
export type SalesOrderLine = typeof salesOrderLines.$inferSelect;
export type Shipment = typeof shipments.$inferSelect;
export type AfterSalesCase = typeof afterSalesCases.$inferSelect;
export type ExchangeRate = typeof exchangeRates.$inferSelect;
export type CostEntry = typeof costEntries.$inferSelect;
export type Settlement = typeof settlements.$inferSelect;
export type StoreConnection = typeof storeConnections.$inferSelect;
export type SyncJob = typeof syncJobs.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type Note = typeof notes.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
