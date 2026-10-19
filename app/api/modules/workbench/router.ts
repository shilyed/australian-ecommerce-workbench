import {
  isActiveOrder,
  matchesOrderQueue,
  shipmentRemainder,
} from "@contracts/merchant-workflow";
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
} from "@db/schema";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { adminQuery, authedQuery, createRouter } from "../../middleware";
import { getDb } from "../../queries/connection";
import { round2, round4, toNumber } from "./numbers";
import {
  allocateOrder,
  applyPositionDelta,
  audit,
  closeTask,
  latestRate,
  openOrReopenTask,
  recalcPurchaseStatus,
} from "./operations";
import { requireArea } from "./permissions";
import { buildWorkspace } from "./read-model";

const currencySchema = z.enum(["CNY", "AUD", "USD"]);
const platformSchema = z.enum(["etsy", "ebay"]);
const businessTargetSchema = z.enum([
  "order",
  "purchase",
  "after_sales",
  "candidate",
  "sku",
]);
const idSchema = z.number().int().positive();

const now = () => new Date();
const makeKey = (prefix: string) =>
  `${prefix}:${Date.now()}:${crypto.randomUUID()}`;

const candidateInput = z.object({
  name: z.string().min(1),
  sourceUrl: z.string().url(),
  supplierId: idSchema,
  spec: z.string().min(1),
  quote: z.string().or(z.number()),
  moq: z.number().int().positive().optional(),
  leadTimeDays: z.number().int().positive().optional(),
  referencePrice: z.string().or(z.number()).optional(),
  notes: z.string().optional(),
});

export const workbenchRouter = createRouter({
  workspace: authedQuery.query(async ({ ctx }) => buildWorkspace(ctx.user)),

  dashboard: authedQuery.query(async ({ ctx }) => {
    const workspace = await buildWorkspace(ctx.user);
    const openTasks = workspace.tasks.filter(task => task.status === "open");
    const nowDate = now();
    const lateOrders = workspace.orders.filter(
      order =>
        order.paymentStatus === "paid" &&
        order.fulfillmentStatus !== "full" &&
        order.shipBy &&
        order.shipBy < nowDate
    );
    const dueSoon = workspace.orders.filter(
      order =>
        order.paymentStatus === "paid" &&
        order.fulfillmentStatus !== "full" &&
        order.shipBy &&
        order.shipBy >= nowDate &&
        order.shipBy.getTime() - nowDate.getTime() <= 24 * 60 * 60 * 1000
    );
    const lowStock = workspace.inventory.filter(
      ({ sku, position }) =>
        sku.status === "active" &&
        (position?.qualifiedQty ?? 0) - (position?.reservedQty ?? 0) <=
          sku.alertThreshold
    );
    const syncIssues = workspace.stores.filter(
      store => store.authorizationStatus !== "authorized" || store.errorSummary
    );
    const verifiedCount = workspace.report.filter(
      row => row.profitStatus === "verified"
    ).length;
    return {
      tasks: openTasks,
      lateOrders,
      dueSoon,
      lowStock,
      syncIssues,
      stores: workspace.stores,
      counts: {
        unmatched: workspace.orders.filter(
          order => order.internalStatus === "matching"
        ).length,
        shortage: workspace.orders.filter(
          order => order.internalStatus === "shortage"
        ).length,
        pendingInspection: workspace.purchaseOrders.reduce(
          (sum, po) =>
            sum +
            po.receipts
              .flatMap(receipt => receipt.lines)
              .reduce((lineSum, line) => lineSum + line.pendingQty, 0),
          0
        ),
        afterSalesOpen: workspace.afterSales.filter(
          item => item.status !== "closed"
        ).length,
        verifiedProfitOrders: verifiedCount,
        totalProfitOrders: workspace.report.length,
      },
    };
  }),

  createSupplier: authedQuery
    .input(
      z.object({
        name: z.string().min(1),
        shopUrl: z.string().url().optional().or(z.literal("")),
        contactName: z.string().optional(),
        contactInfo: z.string().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireArea(ctx.user, "sourcing", true);
      const db = getDb();
      const [{ id }] = await db
        .insert(suppliers)
        .values({ ...input, shopUrl: input.shopUrl || null })
        .$returningId();
      await audit(
        db,
        ctx.user.id,
        "supplier.create",
        "supplier",
        id,
        undefined,
        input
      );
      return { id };
    }),

  createCandidate: authedQuery
    .input(candidateInput)
    .mutation(async ({ ctx, input }) => {
      requireArea(ctx.user, "sourcing", true);
      const db = getDb();
      const duplicate = await db
        .select()
        .from(productCandidates)
        .where(eq(productCandidates.sourceUrl, input.sourceUrl))
        .limit(1);
      const [{ id }] = await db
        .insert(productCandidates)
        .values({
          name: input.name,
          sourceUrl: input.sourceUrl,
          supplierId: input.supplierId,
          spec: input.spec,
          quote: String(input.quote),
          moq: input.moq,
          leadTimeDays: input.leadTimeDays,
          referencePrice:
            input.referencePrice === undefined
              ? undefined
              : String(input.referencePrice),
          sampleReview: input.notes,
          operatorId: ctx.user.id,
        })
        .$returningId();
      await audit(
        db,
        ctx.user.id,
        "candidate.create",
        "candidate",
        id,
        undefined,
        input
      );
      return { id, duplicateWarning: duplicate.length > 0 };
    }),

  updateCandidateStatus: authedQuery
    .input(
      z.object({
        id: idSchema,
        status: z.enum([
          "candidate",
          "sample_evaluation",
          "pending_decision",
          "adopted",
          "rejected",
          "paused",
        ]),
        sampleScore: z.number().int().min(0).max(100).optional(),
        sampleReview: z.string().optional(),
        decisionNote: z.string().min(1, "状态流转必须保留决策说明"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireArea(ctx.user, "sourcing", true);
      const db = getDb();
      const before = await db
        .select()
        .from(productCandidates)
        .where(eq(productCandidates.id, input.id))
        .limit(1);
      if (!before.at(0))
        throw new TRPCError({ code: "NOT_FOUND", message: "选品不存在" });
      await db
        .update(productCandidates)
        .set({
          status: input.status,
          sampleScore: input.sampleScore,
          sampleReview: input.sampleReview,
          decisionNote: input.decisionNote,
          operatorId: ctx.user.id,
        })
        .where(eq(productCandidates.id, input.id));
      await audit(
        db,
        ctx.user.id,
        "candidate.status",
        "candidate",
        input.id,
        before.at(0),
        input,
        input.decisionNote
      );
      return { ok: true };
    }),

  setCandidateCompliance: authedQuery
    .input(
      z.object({
        id: idSchema,
        platform: platformSchema,
        conclusion: z.enum(["pending", "assess", "approved", "rejected"]),
        basis: z.string().min(3, "必须填写判断依据"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireArea(ctx.user, "sourcing", true);
      const db = getDb();
      const rows = await db
        .select()
        .from(productCandidates)
        .where(eq(productCandidates.id, input.id))
        .limit(1);
      const before = rows.at(0);
      if (!before)
        throw new TRPCError({ code: "NOT_FOUND", message: "选品不存在" });
      await db
        .update(productCandidates)
        .set({
          etsyStatus:
            input.platform === "etsy" ? input.conclusion : before.etsyStatus,
          ebayStatus:
            input.platform === "ebay" ? input.conclusion : before.ebayStatus,
          complianceBasis: `${before.complianceBasis ? `${before.complianceBasis}\n` : ""}[${input.platform}] ${input.basis}`,
          complianceCheckedAt: now(),
          confirmedById: ctx.user.id,
        })
        .where(eq(productCandidates.id, input.id));
      await audit(
        db,
        ctx.user.id,
        "candidate.compliance",
        "candidate",
        input.id,
        before,
        input,
        input.basis
      );
      return { ok: true };
    }),

  createSku: authedQuery
    .input(
      z.object({
        code: z.string().min(2),
        name: z.string().min(1),
        productName: z.string().min(1),
        spec: z.string().min(1),
        weight: z.string().or(z.number()).optional(),
        dimensions: z.string().optional(),
        supplierSku: z.string().optional(),
        declarationNameEn: z.string().optional(),
        material: z.string().optional(),
        originCountry: z.string().optional(),
        hsCode: z.string().optional(),
        alertThreshold: z.number().int().min(0).default(0),
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireArea(ctx.user, "inventory", true);
      const db = getDb();
      const existing = await db
        .select()
        .from(skus)
        .where(eq(skus.code, input.code))
        .limit(1);
      if (existing.at(0))
        throw new TRPCError({
          code: "CONFLICT",
          message: "SKU 编码必须全局唯一",
        });
      const [{ id }] = await db
        .insert(skus)
        .values({
          ...input,
          weight: input.weight === undefined ? undefined : String(input.weight),
        })
        .$returningId();
      await db
        .insert(inventoryPositions)
        .values({ skuId: id })
        .onDuplicateKeyUpdate({ set: { skuId: id } });
      await audit(db, ctx.user.id, "sku.create", "sku", id, undefined, input);
      return { id };
    }),

  convertCandidate: authedQuery
    .input(
      z.object({
        candidateId: idSchema,
        skuId: idSchema.optional(),
        skuCode: z.string().optional(),
        decisionNote: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireArea(ctx.user, "sourcing", true);
      const db = getDb();
      const candidateRows = await db
        .select()
        .from(productCandidates)
        .where(eq(productCandidates.id, input.candidateId))
        .limit(1);
      const candidate = candidateRows.at(0);
      if (!candidate)
        throw new TRPCError({ code: "NOT_FOUND", message: "选品不存在" });
      let skuId = input.skuId;
      if (!skuId) {
        const code =
          input.skuCode || `AU-${String(candidate.id).padStart(4, "0")}`;
        const [{ id }] = await db
          .insert(skus)
          .values({
            code,
            name: candidate.name,
            productName: candidate.name,
            spec: candidate.spec,
            weight: candidate.weight ?? undefined,
            weightUnit: candidate.weightUnit,
            dimensions: candidate.dimensions ?? undefined,
            supplierSku: candidate.spec,
            alertThreshold: 2,
          })
          .$returningId();
        skuId = id;
        await db
          .insert(inventoryPositions)
          .values({ skuId })
          .onDuplicateKeyUpdate({ set: { skuId } });
      }
      await db
        .update(productCandidates)
        .set({
          status: "adopted",
          convertedSkuId: skuId,
          decisionNote: input.decisionNote,
          operatorId: ctx.user.id,
        })
        .where(eq(productCandidates.id, candidate.id));
      await audit(
        db,
        ctx.user.id,
        "candidate.convert",
        "candidate",
        candidate.id,
        candidate,
        { skuId, ...input },
        input.decisionNote
      );
      return { skuId };
    }),

  linkListing: authedQuery
    .input(
      z.object({
        listingId: idSchema,
        skuId: idSchema,
        reason: z.string().min(1, "首次映射或调整必须确认并说明原因"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireArea(ctx.user, "inventory", true);
      const db = getDb();
      const listingRows = await db
        .select()
        .from(channelListings)
        .where(eq(channelListings.id, input.listingId))
        .limit(1);
      const before = listingRows.at(0);
      if (!before)
        throw new TRPCError({ code: "NOT_FOUND", message: "刊登不存在" });
      await db
        .update(channelListings)
        .set({ skuId: input.skuId })
        .where(eq(channelListings.id, input.listingId));
      await audit(
        db,
        ctx.user.id,
        "listing.map",
        "listing",
        input.listingId,
        before,
        input,
        input.reason
      );
      return { ok: true };
    }),

  createPurchaseOrder: authedQuery
    .input(
      z.object({
        internalNo: z.string().min(2),
        supplierId: idSchema,
        externalOrderNo: z.string().optional(),
        externalOrderUrl: z.string().url().optional().or(z.literal("")),
        orderedAt: z.coerce.date().optional(),
        expectedArrivalAt: z.coerce.date().optional(),
        notes: z.string().optional(),
        flowStatus: z.enum(["draft", "ordered"]).default("ordered"),
        lines: z
          .array(
            z.object({
              skuId: idSchema,
              supplierSpec: z.string().min(1),
              quantity: z.number().int().positive(),
              unitPrice: z.string().or(z.number()),
              currency: currencySchema.default("CNY"),
              discount: z.string().or(z.number()).default(0),
            })
          )
          .min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireArea(ctx.user, "procurement", true);
      const db = getDb();
      if (input.externalOrderNo) {
        const duplicate = await db
          .select()
          .from(purchaseOrders)
          .where(
            and(
              eq(purchaseOrders.supplierId, input.supplierId),
              eq(purchaseOrders.externalOrderNo, input.externalOrderNo)
            )
          )
          .limit(1);
        if (duplicate.at(0)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "同一供应商下 1688 订单号已存在，请确认是否重复录入",
          });
        }
      }
      return db.transaction(async tx => {
        const [{ id }] = await tx
          .insert(purchaseOrders)
          .values({
            internalNo: input.internalNo,
            supplierId: input.supplierId,
            externalOrderNo: input.externalOrderNo || null,
            externalOrderUrl: input.externalOrderUrl || null,
            orderedAt: input.orderedAt ?? now(),
            expectedArrivalAt: input.expectedArrivalAt,
            ownerId: ctx.user.id,
            flowStatus: input.flowStatus,
            notes: input.notes,
          })
          .$returningId();
        await tx.insert(purchaseOrderLines).values(
          input.lines.map(line => ({
            purchaseOrderId: id,
            skuId: line.skuId,
            supplierSpec: line.supplierSpec,
            quantity: line.quantity,
            unitPrice: String(line.unitPrice),
            currency: line.currency,
            discount: String(line.discount),
          }))
        );
        await audit(
          tx,
          ctx.user.id,
          "purchase.create",
          "purchase",
          id,
          undefined,
          input
        );
        return { id };
      });
    }),

  addPayment: authedQuery
    .input(
      z.object({
        purchaseOrderId: idSchema,
        type: z.enum(["payment", "supplier_refund"]).default("payment"),
        paidAt: z.coerce.date(),
        currency: currencySchema.default("CNY"),
        amount: z.string().or(z.number()),
        referenceNo: z.string().optional(),
        voucherKey: z.string().optional(),
        note: z.string().optional(),
        idempotencyKey: z.string().min(8),
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireArea(ctx.user, "procurement", true);
      const db = getDb();
      const existing = await db
        .select()
        .from(paymentRecords)
        .where(eq(paymentRecords.idempotencyKey, input.idempotencyKey))
        .limit(1);
      if (existing.at(0)) return { id: existing.at(0)!.id, duplicated: true };
      const [{ id }] = await db
        .insert(paymentRecords)
        .values({
          ...input,
          amount: String(input.amount),
          recordedById: ctx.user.id,
        })
        .$returningId();
      await audit(
        db,
        ctx.user.id,
        "purchase.payment",
        "purchase",
        input.purchaseOrderId,
        undefined,
        input,
        "付款记录不代表真实支付或银行核验"
      );
      return { id, duplicated: false };
    }),

  postReceipt: authedQuery
    .input(
      z.object({
        purchaseOrderId: idSchema,
        receivedAt: z.coerce.date(),
        note: z.string().optional(),
        idempotencyKey: z.string().min(8),
        lines: z
          .array(
            z.object({
              purchaseOrderLineId: idSchema,
              receivedQty: z.number().int().positive(),
              qualifiedQty: z.number().int().min(0),
              defectiveQty: z.number().int().min(0),
              pendingQty: z.number().int().min(0),
              overReceiptReason: z.string().optional(),
            })
          )
          .min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireArea(ctx.user, "procurement", true);
      const db = getDb();
      const existing = await db
        .select()
        .from(goodsReceipts)
        .where(eq(goodsReceipts.idempotencyKey, input.idempotencyKey))
        .limit(1);
      if (existing.at(0))
        return { id: existing.at(0)!.id, duplicated: true, rateMissing: false };
      const rate = await latestRate(db, "CNY");

      return db.transaction(async tx => {
        const poRows = await tx
          .select()
          .from(purchaseOrders)
          .where(eq(purchaseOrders.id, input.purchaseOrderId))
          .limit(1);
        const po = poRows.at(0);
        if (!po || po.flowStatus === "cancelled")
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "采购单不可收货",
          });
        const [{ id: receiptId }] = await tx
          .insert(goodsReceipts)
          .values({
            purchaseOrderId: input.purchaseOrderId,
            receivedAt: input.receivedAt,
            note: input.note,
            idempotencyKey: input.idempotencyKey,
            postedById: ctx.user.id,
          })
          .$returningId();

        for (const lineInput of input.lines) {
          const sum =
            lineInput.qualifiedQty +
            lineInput.defectiveQty +
            lineInput.pendingQty;
          if (sum !== lineInput.receivedQty) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "实收必须等于合格+残次+待检",
            });
          }
          const poLineRows = await tx
            .select()
            .from(purchaseOrderLines)
            .where(
              and(
                eq(purchaseOrderLines.id, lineInput.purchaseOrderLineId),
                eq(purchaseOrderLines.purchaseOrderId, input.purchaseOrderId)
              )
            )
            .limit(1);
          const poLine = poLineRows.at(0);
          if (!poLine)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "采购明细不存在",
            });
          const remaining =
            poLine.quantity - poLine.receivedQty - poLine.closedQty;
          if (
            lineInput.receivedQty > remaining &&
            !lineInput.overReceiptReason
          ) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "超采购量收货必须明确确认并填写原因",
            });
          }

          await tx.insert(goodsReceiptLines).values({
            goodsReceiptId: receiptId,
            purchaseOrderLineId: poLine.id,
            skuId: poLine.skuId,
            receivedQty: lineInput.receivedQty,
            qualifiedQty: lineInput.qualifiedQty,
            defectiveQty: lineInput.defectiveQty,
            pendingQty: lineInput.pendingQty,
            overReceiptReason: lineInput.overReceiptReason,
          });
          await tx
            .update(purchaseOrderLines)
            .set({
              receivedQty: poLine.receivedQty + lineInput.receivedQty,
              allocatedCostAud: rate
                ? String(
                    round4(toNumber(poLine.unitPrice) * toNumber(rate.rate))
                  )
                : null,
            })
            .where(eq(purchaseOrderLines.id, poLine.id));

          await applyPositionDelta(tx, {
            skuId: poLine.skuId,
            physicalDelta: lineInput.receivedQty,
            qualifiedDelta: lineInput.qualifiedQty,
            unqualifiedDelta: lineInput.defectiveQty + lineInput.pendingQty,
          });
          const batchCode = `PO-${input.purchaseOrderId}-${poLine.id}`;
          const lots = await tx
            .select()
            .from(inventoryLots)
            .where(
              and(
                eq(inventoryLots.skuId, poLine.skuId),
                eq(inventoryLots.location, "MAIN"),
                eq(inventoryLots.batchCode, batchCode)
              )
            )
            .limit(1);
          const unitCostCny =
            poLine.currency === "CNY" ? toNumber(poLine.unitPrice) : null;
          const unitCostAud =
            rate && unitCostCny !== null
              ? round4(unitCostCny * toNumber(rate.rate))
              : null;
          const lot = lots.at(0);
          if (lot) {
            await tx
              .update(inventoryLots)
              .set({
                qtyRemaining: lot.qtyRemaining + lineInput.receivedQty,
                qualifiedRemaining:
                  lot.qualifiedRemaining + lineInput.qualifiedQty,
                unqualifiedRemaining:
                  lot.unqualifiedRemaining +
                  lineInput.defectiveQty +
                  lineInput.pendingQty,
              })
              .where(eq(inventoryLots.id, lot.id));
          } else {
            await tx.insert(inventoryLots).values({
              skuId: poLine.skuId,
              batchCode,
              sourceType: "purchase",
              sourceId: receiptId,
              receivedAt: input.receivedAt,
              qtyRemaining: lineInput.receivedQty,
              qualifiedRemaining: lineInput.qualifiedQty,
              unqualifiedRemaining:
                lineInput.defectiveQty + lineInput.pendingQty,
              unitCostCny: unitCostCny === null ? null : String(unitCostCny),
              unitCostAud: unitCostAud === null ? null : String(unitCostAud),
              costStatus: unitCostAud === null ? "missing" : "complete",
            });
          }
          await tx.insert(inventoryLedger).values({
            skuId: poLine.skuId,
            type: "purchase_inbound",
            qualifiedDelta: lineInput.qualifiedQty,
            unqualifiedDelta: lineInput.defectiveQty + lineInput.pendingQty,
            businessType: "goods_receipt",
            businessId: receiptId,
            unitCostAud: unitCostAud === null ? null : String(unitCostAud),
            idempotencyKey: `${input.idempotencyKey}:line:${poLine.id}`,
            actorId: ctx.user.id,
            reason: lineInput.overReceiptReason ?? "采购到货质检过账",
          });
        }
        await recalcPurchaseStatus(tx, input.purchaseOrderId);
        await audit(
          tx,
          ctx.user.id,
          "purchase.receipt.post",
          "purchase",
          input.purchaseOrderId,
          undefined,
          input
        );
        return { id: receiptId, duplicated: false, rateMissing: !rate };
      });
    }),

  closePurchaseRemainder: authedQuery
    .input(
      z.object({
        purchaseOrderId: idSchema,
        reason: z.string().min(3, "关闭余量必须说明原因"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireArea(ctx.user, "procurement", true);
      const db = getDb();
      return db.transaction(async tx => {
        const lines = await tx
          .select()
          .from(purchaseOrderLines)
          .where(eq(purchaseOrderLines.purchaseOrderId, input.purchaseOrderId));
        for (const line of lines) {
          const closeQty = Math.max(
            0,
            line.quantity - line.receivedQty - line.closedQty
          );
          if (closeQty > 0) {
            await tx
              .update(purchaseOrderLines)
              .set({ closedQty: line.closedQty + closeQty })
              .where(eq(purchaseOrderLines.id, line.id));
          }
        }
        await tx
          .update(purchaseOrders)
          .set({ flowStatus: "closed", closeReason: input.reason })
          .where(eq(purchaseOrders.id, input.purchaseOrderId));
        await recalcPurchaseStatus(tx, input.purchaseOrderId);
        await audit(
          tx,
          ctx.user.id,
          "purchase.close_remainder",
          "purchase",
          input.purchaseOrderId,
          undefined,
          input,
          input.reason
        );
        return { ok: true };
      });
    }),

  createOrder: authedQuery
    .input(
      z.object({
        platform: platformSchema,
        externalShopId: z.string().min(1),
        externalOrderId: z.string().min(1),
        orderNo: z.string().min(1),
        buyerName: z.string().optional(),
        buyerEmail: z.string().email().optional().or(z.literal("")),
        destinationCountry: z.string().min(2),
        postalCode: z.string().optional(),
        addressSummary: z.string().optional(),
        rawStatus: z.string().min(1),
        paymentStatus: z.enum([
          "unpaid",
          "paid",
          "partial_refund",
          "refunded",
          "unknown",
        ]),
        orderedAt: z.coerce.date(),
        shipBy: z.coerce.date().optional(),
        currency: z.enum(["AUD", "USD", "CNY"]).default("AUD"),
        subtotal: z.string().or(z.number()),
        shippingPaid: z.string().or(z.number()).default(0),
        taxCollected: z.string().or(z.number()).default(0),
        discount: z.string().or(z.number()).default(0),
        total: z.string().or(z.number()),
        note: z.string().optional(),
        lines: z
          .array(
            z.object({
              listingId: idSchema.optional(),
              skuId: idSchema.optional(),
              externalSku: z.string().optional(),
              title: z.string().min(1),
              quantity: z.number().int().positive(),
              unitPrice: z.string().or(z.number()),
              discount: z.string().or(z.number()).default(0),
            })
          )
          .min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireArea(ctx.user, "orders", true);
      const db = getDb();
      const existing = await db
        .select()
        .from(salesOrders)
        .where(
          and(
            eq(salesOrders.platform, input.platform),
            eq(salesOrders.externalShopId, input.externalShopId),
            eq(salesOrders.externalOrderId, input.externalOrderId)
          )
        )
        .limit(1);
      if (existing.at(0)) return { id: existing.at(0)!.id, duplicated: true };

      return db.transaction(async tx => {
        const [{ id }] = await tx
          .insert(salesOrders)
          .values({
            platform: input.platform,
            externalShopId: input.externalShopId,
            externalOrderId: input.externalOrderId,
            orderNo: input.orderNo,
            buyerName: input.buyerName,
            buyerEmail: input.buyerEmail || null,
            destinationCountry: input.destinationCountry,
            postalCode: input.postalCode,
            addressSummary: input.addressSummary,
            rawStatus: input.rawStatus,
            paymentStatus: input.paymentStatus,
            orderedAt: input.orderedAt,
            shipBy: input.shipBy,
            ownerId: ctx.user.id,
            currency: input.currency,
            subtotal: String(input.subtotal),
            shippingPaid: String(input.shippingPaid),
            taxCollected: String(input.taxCollected),
            discount: String(input.discount),
            total: String(input.total),
            note: input.note,
          })
          .$returningId();
        await tx.insert(salesOrderLines).values(
          input.lines.map(line => ({
            salesOrderId: id,
            listingId: line.listingId,
            skuId: line.skuId,
            externalSku: line.externalSku,
            title: line.title,
            quantity: line.quantity,
            unitPrice: String(line.unitPrice),
            discount: String(line.discount),
            snapshot: {
              importedAt: now().toISOString(),
              source: "manual-or-csv",
            },
          }))
        );
        await allocateOrder(tx, id, ctx.user.id);
        await audit(
          tx,
          ctx.user.id,
          "order.create",
          "order",
          id,
          undefined,
          input
        );
        return { id, duplicated: false };
      });
    }),

  assignOrder: authedQuery
    .input(
      z.object({
        orderId: idSchema,
        ownerId: idSchema.nullable(),
        internalShipBy: z.coerce.date().optional(),
        note: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireArea(ctx.user, "orders", true);
      const db = getDb();
      await db
        .update(salesOrders)
        .set({
          ownerId: input.ownerId ?? undefined,
          internalShipBy: input.internalShipBy,
          note: input.note,
        })
        .where(eq(salesOrders.id, input.orderId));
      await audit(
        db,
        ctx.user.id,
        "order.assign",
        "order",
        input.orderId,
        undefined,
        input
      );
      return { ok: true };
    }),

  resolveOrderLines: authedQuery
    .input(
      z.object({
        orderId: idSchema,
        lines: z
          .array(z.object({ lineId: idSchema, skuId: idSchema }))
          .default([]),
        reason: z.string().trim().min(3, "请填写至少三个字的核对说明"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireArea(ctx.user, "orders", true);
      if (input.lines.length) requireArea(ctx.user, "inventory", true);
      if (
        new Set(input.lines.map(line => line.lineId)).size !==
        input.lines.length
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "同一订单商品不能重复匹配",
        });
      }
      return getDb().transaction(async tx => {
        const [order] = await tx
          .select()
          .from(salesOrders)
          .where(eq(salesOrders.id, input.orderId))
          .limit(1)
          .for("update");
        if (!order)
          throw new TRPCError({ code: "NOT_FOUND", message: "订单不存在" });
        if (
          !isActiveOrder({ ...order, lines: [], shipments: [] }) ||
          order.paymentStatus !== "paid"
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "只能重新检查尚未结束的已付款订单",
          });
        }
        for (const binding of input.lines) {
          const [line] = await tx
            .select()
            .from(salesOrderLines)
            .where(
              and(
                eq(salesOrderLines.id, binding.lineId),
                eq(salesOrderLines.salesOrderId, input.orderId)
              )
            )
            .limit(1);
          if (!line || line.skuId !== null || line.shippedQty > 0) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "只能补齐未匹配商品，已有商品快照不能改写",
            });
          }
          const [sku] = await tx
            .select()
            .from(skus)
            .where(eq(skus.id, binding.skuId))
            .limit(1);
          if (!sku || sku.status !== "active")
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "请选择启用的库存商品",
            });
          await tx
            .update(salesOrderLines)
            .set({ skuId: sku.id, shortageQty: 0 })
            .where(eq(salesOrderLines.id, line.id));
        }
        const result = await allocateOrder(tx, input.orderId, ctx.user.id);
        await audit(
          tx,
          ctx.user.id,
          "order.resolve_lines",
          "order",
          input.orderId,
          order,
          input,
          input.reason
        );
        return result;
      });
    }),

  cancelOrder: authedQuery
    .input(z.object({ orderId: idSchema, reason: z.string().min(3) }))
    .mutation(async ({ ctx, input }) => {
      requireArea(ctx.user, "orders", true);
      const db = getDb();
      return db.transaction(async tx => {
        const orderRows = await tx
          .select()
          .from(salesOrders)
          .where(eq(salesOrders.id, input.orderId))
          .limit(1);
        const order = orderRows.at(0);
        if (!order)
          throw new TRPCError({ code: "NOT_FOUND", message: "订单不存在" });
        const lines = await tx
          .select()
          .from(salesOrderLines)
          .where(eq(salesOrderLines.salesOrderId, input.orderId));
        for (const line of lines) {
          const releasable = Math.max(0, line.allocatedQty - line.shippedQty);
          if (releasable > 0 && line.skuId) {
            await applyPositionDelta(tx, {
              skuId: line.skuId,
              reservedDelta: -releasable,
              shortageDelta: -line.shortageQty,
            });
            await tx.insert(inventoryLedger).values({
              skuId: line.skuId,
              type: "reservation_release",
              reservedDelta: -releasable,
              businessType: "order_line",
              businessId: line.id,
              idempotencyKey: `order:${input.orderId}:line:${line.id}:cancel-release`,
              actorId: ctx.user.id,
              reason: input.reason,
            });
          }
          await tx
            .update(salesOrderLines)
            .set({ allocatedQty: line.shippedQty, shortageQty: 0 })
            .where(eq(salesOrderLines.id, line.id));
        }
        await tx
          .update(salesOrders)
          .set({
            rawStatus: "cancelled",
            internalStatus: "fulfilled",
            paymentStatus:
              order.paymentStatus === "paid" ? "unknown" : order.paymentStatus,
          })
          .where(eq(salesOrders.id, input.orderId));
        await audit(
          tx,
          ctx.user.id,
          "order.cancel",
          "order",
          input.orderId,
          order,
          input,
          input.reason
        );
        return { ok: true };
      });
    }),

  createShipment: authedQuery
    .input(
      z.object({
        salesOrderId: idSchema,
        carrier: z.string().min(1),
        service: z.string().min(1),
        trackingNo: z.string().optional(),
        trackingUrl: z.string().url().optional().or(z.literal("")),
        weight: z.string().or(z.number()).optional(),
        freightEstimate: z.string().or(z.number()).optional(),
        idempotencyKey: z.string().min(8),
        lines: z
          .array(
            z.object({
              salesOrderLineId: idSchema,
              quantity: z.number().int().positive(),
            })
          )
          .min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireArea(ctx.user, "shipping", true);
      const db = getDb();
      const existing = await db
        .select()
        .from(shipments)
        .where(eq(shipments.idempotencyKey, input.idempotencyKey))
        .limit(1);
      if (existing.at(0))
        return {
          id: existing.at(0)!.id,
          duplicated: true,
          packageNo: existing.at(0)!.packageNo,
        };
      return db.transaction(async tx => {
        const orderRows = await tx
          .select()
          .from(salesOrders)
          .where(eq(salesOrders.id, input.salesOrderId))
          .limit(1)
          .for("update");
        const order = orderRows.at(0);
        if (!order)
          throw new TRPCError({ code: "NOT_FOUND", message: "订单不存在" });
        if (
          !matchesOrderQueue({ ...order, lines: [], shipments: [] }, "to_ship")
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "订单尚未付款、缺货、待匹配或已结束，不能新建包裹",
          });
        }
        if (
          new Set(input.lines.map(line => line.salesOrderLineId)).size !==
          input.lines.length
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "同一商品不能在包裹中重复添加，请合并数量",
          });
        }
        const countRows = await tx
          .select()
          .from(shipments)
          .where(eq(shipments.salesOrderId, input.salesOrderId));
        const draftIds = countRows
          .filter(shipment => shipment.status === "draft")
          .map(shipment => shipment.id);
        const draftLines = draftIds.length
          ? await tx
              .select()
              .from(shipmentLines)
              .where(inArray(shipmentLines.shipmentId, draftIds))
          : [];
        const packageNo = `${order.orderNo}-P${String(countRows.length + 1).padStart(2, "0")}`;
        const [{ id }] = await tx
          .insert(shipments)
          .values({
            salesOrderId: input.salesOrderId,
            packageNo,
            carrier: input.carrier,
            service: input.service,
            trackingNo: input.trackingNo,
            trackingUrl: input.trackingUrl || null,
            weight:
              input.weight === undefined ? undefined : String(input.weight),
            freightEstimate:
              input.freightEstimate === undefined
                ? undefined
                : String(input.freightEstimate),
            idempotencyKey: input.idempotencyKey,
            createdById: ctx.user.id,
          })
          .$returningId();
        for (const line of input.lines) {
          const orderLineRows = await tx
            .select()
            .from(salesOrderLines)
            .where(
              and(
                eq(salesOrderLines.id, line.salesOrderLineId),
                eq(salesOrderLines.salesOrderId, input.salesOrderId)
              )
            )
            .limit(1);
          const orderLine = orderLineRows.at(0);
          if (!orderLine)
            throw new TRPCError({ code: "NOT_FOUND", message: "订单行不存在" });
          const remaining = shipmentRemainder(
            {
              ...order,
              lines: [orderLine],
              shipments: countRows.map(shipment => ({
                ...shipment,
                lines: draftLines.filter(
                  item => item.shipmentId === shipment.id
                ),
              })),
            },
            orderLine
          );
          if (line.quantity > remaining) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "包裹数量超过订单可发数量",
            });
          }
          await tx
            .insert(shipmentLines)
            .values({
              shipmentId: id,
              salesOrderLineId: line.salesOrderLineId,
              quantity: line.quantity,
            });
        }
        await tx
          .update(salesOrders)
          .set({ internalStatus: "awaiting_dispatch" })
          .where(eq(salesOrders.id, input.salesOrderId));
        await audit(
          tx,
          ctx.user.id,
          "shipment.draft",
          "shipment",
          id,
          undefined,
          input
        );
        return { id, duplicated: false, packageNo };
      });
    }),

  confirmDispatch: authedQuery
    .input(
      z.object({
        shipmentId: idSchema,
        dispatchedAt: z.coerce.date(),
        reason: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireArea(ctx.user, "shipping", true);
      const db = getDb();
      return db.transaction(async tx => {
        const shipmentRows = await tx
          .select()
          .from(shipments)
          .where(eq(shipments.id, input.shipmentId))
          .limit(1);
        const shipment = shipmentRows.at(0);
        if (!shipment)
          throw new TRPCError({ code: "NOT_FOUND", message: "包裹不存在" });
        if (shipment.status !== "draft")
          return { id: shipment.id, duplicated: true, status: shipment.status };
        const lines = await tx
          .select()
          .from(shipmentLines)
          .where(eq(shipmentLines.shipmentId, shipment.id));
        for (const shipLine of lines) {
          const orderLineRows = await tx
            .select()
            .from(salesOrderLines)
            .where(eq(salesOrderLines.id, shipLine.salesOrderLineId))
            .limit(1);
          const orderLine = orderLineRows.at(0);
          if (!orderLine || !orderLine.skuId)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "发货行缺少 SKU",
            });
          if (
            orderLine.shippedQty + shipLine.quantity >
            orderLine.allocatedQty
          ) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "确认交运超过已分配数量，已阻断",
            });
          }
          let remaining = shipLine.quantity;
          const lots = await tx
            .select()
            .from(inventoryLots)
            .where(
              and(
                eq(inventoryLots.skuId, orderLine.skuId),
                eq(inventoryLots.location, "MAIN")
              )
            )
            .orderBy(asc(inventoryLots.receivedAt), asc(inventoryLots.id));
          for (const lot of lots) {
            if (remaining <= 0) break;
            const take = Math.min(remaining, lot.qualifiedRemaining);
            if (take <= 0) continue;
            await tx
              .update(inventoryLots)
              .set({
                qtyRemaining: lot.qtyRemaining - take,
                qualifiedRemaining: lot.qualifiedRemaining - take,
              })
              .where(eq(inventoryLots.id, lot.id));
            await tx.insert(inventoryLedger).values({
              skuId: orderLine.skuId,
              lotId: lot.id,
              type: "shipment_outbound",
              qualifiedDelta: -take,
              reservedDelta: -take,
              businessType: "order",
              businessId: orderLine.salesOrderId,
              unitCostAud: lot.unitCostAud,
              idempotencyKey: `shipment:${shipment.id}:line:${orderLine.id}:lot:${lot.id}`,
              actorId: ctx.user.id,
              reason: input.reason ?? "确认实际交运，FIFO 出库",
            });
            remaining -= take;
          }
          if (remaining > 0)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "批次库存不足，无法交运",
            });
          await applyPositionDelta(tx, {
            skuId: orderLine.skuId,
            physicalDelta: -shipLine.quantity,
            qualifiedDelta: -shipLine.quantity,
            reservedDelta: -shipLine.quantity,
          });
          await tx
            .update(salesOrderLines)
            .set({ shippedQty: orderLine.shippedQty + shipLine.quantity })
            .where(eq(salesOrderLines.id, orderLine.id));
        }
        await tx
          .update(shipments)
          .set({
            status: "dispatched",
            dispatchedAt: input.dispatchedAt,
            platformMessage: "P0-A：请在平台人工更新发货后回到此处核对",
          })
          .where(eq(shipments.id, shipment.id));
        const updatedLines = await tx
          .select()
          .from(salesOrderLines)
          .where(eq(salesOrderLines.salesOrderId, shipment.salesOrderId));
        const full = updatedLines.every(
          line => line.shippedQty >= line.quantity
        );
        const partial = updatedLines.some(line => line.shippedQty > 0);
        await tx
          .update(salesOrders)
          .set({
            fulfillmentStatus: full
              ? "full"
              : partial
                ? "partial"
                : "unshipped",
            internalStatus: full ? "fulfilled" : "picking",
          })
          .where(eq(salesOrders.id, shipment.salesOrderId));
        await audit(
          tx,
          ctx.user.id,
          "shipment.dispatch",
          "shipment",
          shipment.id,
          shipment,
          input,
          input.reason
        );
        return { id: shipment.id, duplicated: false };
      });
    }),

  updateShipmentPlatformStatus: authedQuery
    .input(
      z.object({
        shipmentId: idSchema,
        status: z.enum([
          "platform_pending",
          "platform_confirmed",
          "platform_failed",
        ]),
        message: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireArea(ctx.user, "shipping", true);
      const db = getDb();
      const rows = await db
        .select()
        .from(shipments)
        .where(eq(shipments.id, input.shipmentId))
        .limit(1);
      const before = rows.at(0);
      if (!before || before.status === "draft")
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "只有已交运包裹才能核对平台状态",
        });
      await db
        .update(shipments)
        .set({ status: input.status, platformMessage: input.message })
        .where(eq(shipments.id, input.shipmentId));
      if (input.status === "platform_failed") {
        await openOrReopenTask(db, {
          stableKey: `shipment:${input.shipmentId}:platform-failed`,
          severity: "high",
          type: "shipping_writeback_failed",
          title: `包裹 ${before.packageNo} 平台发货回传失败`,
          reason: input.message,
          businessType: "order",
          businessId: before.salesOrderId,
          dueAt: now(),
        });
      } else {
        await closeTask(db, `shipment:${input.shipmentId}:platform-failed`);
      }
      await audit(
        db,
        ctx.user.id,
        "shipment.platform_status",
        "shipment",
        input.shipmentId,
        before,
        input,
        input.message
      );
      return { ok: true };
    }),

  createAfterSales: authedQuery
    .input(
      z.object({
        salesOrderId: idSchema,
        type: z.enum([
          "refund_only",
          "return_refund",
          "reship",
          "cancel_assist",
          "dispute",
        ]),
        reason: z.string().min(1),
        responsibility: z.string().optional(),
        amount: z.string().or(z.number()).default(0),
        currency: z.enum(["AUD", "USD", "CNY"]).default("AUD"),
        externalEventId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireArea(ctx.user, "orders", true);
      const db = getDb();
      return db.transaction(async tx => {
        if (input.externalEventId) {
          const duplicate = await tx
            .select()
            .from(afterSalesCases)
            .where(eq(afterSalesCases.externalEventId, input.externalEventId))
            .limit(1);
          if (duplicate.at(0))
            return { id: duplicate.at(0)!.id, duplicated: true };
        }
        const [{ id }] = await tx
          .insert(afterSalesCases)
          .values({
            ...input,
            amount: String(input.amount),
            refundStatus: ["refund_only", "return_refund", "dispute"].includes(
              input.type
            )
              ? "pending"
              : "none",
            returnStatus: input.type === "return_refund" ? "awaiting" : "none",
            ownerId: ctx.user.id,
            createdById: ctx.user.id,
          })
          .$returningId();
        await tx
          .update(salesOrders)
          .set({ afterSalesStatus: "open" })
          .where(eq(salesOrders.id, input.salesOrderId));
        await openOrReopenTask(tx, {
          stableKey: `after-sales:${id}:open`,
          severity: "medium",
          type: "after_sales_open",
          title: `售后事件待处理`,
          reason: input.reason,
          businessType: "after_sales",
          businessId: id,
          ownerId: ctx.user.id,
          dueAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        });
        await audit(
          tx,
          ctx.user.id,
          "after_sales.create",
          "after_sales",
          id,
          undefined,
          input
        );
        return { id, duplicated: false };
      });
    }),

  updateAfterSales: authedQuery
    .input(
      z.object({
        id: idSchema,
        status: z.enum(["pending", "processing", "waiting_external", "closed"]),
        refundStatus: z.enum(["none", "pending", "confirmed", "failed"]),
        returnStatus: z.enum([
          "none",
          "awaiting",
          "received",
          "pending_inspection",
          "qualified",
          "defective",
        ]),
        resolution: z.string().optional(),
        restockSkuId: idSchema.optional(),
        restockQty: z.number().int().positive().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireArea(ctx.user, "orders", true);
      const db = getDb();
      return db.transaction(async tx => {
        const rows = await tx
          .select()
          .from(afterSalesCases)
          .where(eq(afterSalesCases.id, input.id))
          .limit(1)
          .for("update");
        const before = rows.at(0);
        if (!before)
          throw new TRPCError({ code: "NOT_FOUND", message: "售后事件不存在" });
        if (
          input.restockSkuId !== undefined ||
          input.restockQty !== undefined
        ) {
          if (
            before.type !== "return_refund" ||
            input.returnStatus !== "qualified" ||
            !input.restockSkuId ||
            !input.restockQty
          ) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "退货入库必须选择质检合格、退回商品和数量",
            });
          }
          const previousRestock = await tx
            .select()
            .from(inventoryLedger)
            .where(
              eq(
                inventoryLedger.idempotencyKey,
                `after-sales:${input.id}:restock`
              )
            )
            .limit(1);
          if (previousRestock.length)
            throw new TRPCError({
              code: "CONFLICT",
              message: "这笔退货已经入库，请取消勾选重新入库后保存其他状态",
            });
          const orderLines = await tx
            .select()
            .from(salesOrderLines)
            .where(
              and(
                eq(salesOrderLines.salesOrderId, before.salesOrderId),
                eq(salesOrderLines.skuId, input.restockSkuId)
              )
            );
          if (
            input.restockQty >
            orderLines.reduce((sum, line) => sum + line.shippedQty, 0)
          ) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "退货入库数量不能超过原订单该商品已发数量",
            });
          }
        }
        await tx
          .update(afterSalesCases)
          .set({
            status: input.status,
            refundStatus: input.refundStatus,
            returnStatus: input.returnStatus,
            resolution: input.resolution,
            closedAt: input.status === "closed" ? now() : null,
          })
          .where(eq(afterSalesCases.id, input.id));
        if (
          input.returnStatus === "qualified" &&
          input.restockSkuId &&
          input.restockQty
        ) {
          await applyPositionDelta(tx, {
            skuId: input.restockSkuId,
            physicalDelta: input.restockQty,
            qualifiedDelta: input.restockQty,
          });
          const batchCode = `RETURN-${input.id}`;
          await tx
            .insert(inventoryLots)
            .values({
              skuId: input.restockSkuId,
              batchCode,
              sourceType: "return",
              sourceId: input.id,
              receivedAt: now(),
              qtyRemaining: input.restockQty,
              qualifiedRemaining: input.restockQty,
              costStatus: "missing",
            })
            .onDuplicateKeyUpdate({
              set: {
                qtyRemaining: input.restockQty,
                qualifiedRemaining: input.restockQty,
              },
            });
          await tx.insert(inventoryLedger).values({
            skuId: input.restockSkuId,
            type: "sales_return_inbound",
            qualifiedDelta: input.restockQty,
            businessType: "after_sales",
            businessId: input.id,
            idempotencyKey: `after-sales:${input.id}:restock`,
            actorId: ctx.user.id,
            reason: "退货质检合格后重新入库",
          });
        }
        const remainingOpen = await tx
          .select()
          .from(afterSalesCases)
          .where(
            and(
              eq(afterSalesCases.salesOrderId, before.salesOrderId),
              ne(afterSalesCases.status, "closed")
            )
          );
        await tx
          .update(salesOrders)
          .set({
            afterSalesStatus: remainingOpen.length === 0 ? "closed" : "open",
          })
          .where(eq(salesOrders.id, before.salesOrderId));
        if (input.status === "closed")
          await closeTask(tx, `after-sales:${input.id}:open`);
        await audit(
          tx,
          ctx.user.id,
          "after_sales.update",
          "after_sales",
          input.id,
          before,
          input,
          input.resolution
        );
        return { ok: true };
      });
    }),

  addExchangeRate: authedQuery
    .input(
      z.object({
        baseCurrency: z.enum(["CNY", "USD"]),
        rate: z.string().or(z.number()),
        rateDate: z.coerce.date(),
        source: z.string().min(1),
        isDefault: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireArea(ctx.user, "finance", true);
      const db = getDb();
      if (toNumber(input.rate) <= 0)
        throw new TRPCError({ code: "BAD_REQUEST", message: "汇率必须大于 0" });
      const [{ id }] = await db
        .insert(exchangeRates)
        .values({
          ...input,
          rate: String(input.rate),
          createdById: ctx.user.id,
        })
        .$returningId();
      await audit(
        db,
        ctx.user.id,
        "finance.exchange_rate.create",
        "exchange_rate",
        id,
        undefined,
        input,
        "历史批次使用原快照，不因默认汇率变更静默重算"
      );
      return { id };
    }),

  addCostEntry: authedQuery
    .input(
      z.object({
        businessType: z.enum([
          "purchase",
          "order",
          "after_sales",
          "settlement",
          "period",
        ]),
        businessId: idSchema,
        category: z.string().min(1),
        amount: z.string().or(z.number()),
        currency: currencySchema,
        exchangeRateId: idSchema.optional(),
        entryKind: z.enum(["estimate", "actual", "reversal"]).default("actual"),
        replacesId: idSchema.optional(),
        note: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireArea(ctx.user, "finance", true);
      const db = getDb();
      let audAmount: string | null = null;
      if (input.currency === "AUD")
        audAmount = String(round2(toNumber(input.amount)));
      if (input.currency !== "AUD" && input.exchangeRateId) {
        const rateRows = await db
          .select()
          .from(exchangeRates)
          .where(eq(exchangeRates.id, input.exchangeRateId))
          .limit(1);
        const rate = rateRows.at(0);
        if (!rate || rate.baseCurrency !== input.currency)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "汇率快照与原币不匹配",
          });
        audAmount = String(
          round2(toNumber(input.amount) * toNumber(rate.rate))
        );
      }
      if (input.replacesId) {
        const replaced = await db
          .select()
          .from(costEntries)
          .where(eq(costEntries.id, input.replacesId))
          .limit(1);
        if (!replaced.at(0))
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "被替换费用不存在",
          });
      }
      const [{ id }] = await db
        .insert(costEntries)
        .values({
          ...input,
          amount: String(input.amount),
          audAmount,
          createdById: ctx.user.id,
        })
        .$returningId();
      if (input.businessType === "order") {
        await db
          .update(salesOrders)
          .set({
            profitStatus: "incomplete",
            profitVerifiedAt: null,
            profitVerifiedById: null,
            profitRevisionReason: input.note ?? "新增/替换费用，利润需重新核实",
          })
          .where(eq(salesOrders.id, input.businessId));
      }
      await audit(
        db,
        ctx.user.id,
        "finance.cost.create",
        "cost_entry",
        id,
        undefined,
        { ...input, audAmount },
        input.note
      );
      return { id, audAmount, incomplete: audAmount === null };
    }),

  allocateCost: authedQuery
    .input(
      z.object({
        costEntryId: idSchema,
        allocations: z
          .array(
            z.object({
              targetType: z.enum([
                "lot",
                "order",
                "after_sales",
                "settlement",
                "period",
              ]),
              targetId: idSchema,
              amount: z.string().or(z.number()),
            })
          )
          .min(1),
        reason: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireArea(ctx.user, "finance", true);
      const db = getDb();
      return db.transaction(async tx => {
        const entries = await tx
          .select()
          .from(costEntries)
          .where(eq(costEntries.id, input.costEntryId))
          .limit(1);
        const entry = entries.at(0);
        if (!entry)
          throw new TRPCError({ code: "NOT_FOUND", message: "费用不存在" });
        const existing = await tx
          .select()
          .from(costAllocations)
          .where(eq(costAllocations.costEntryId, input.costEntryId));
        const existingTotal = existing.reduce(
          (sum, item) => sum + toNumber(item.amount),
          0
        );
        const newTotal = input.allocations.reduce(
          (sum, item) => sum + toNumber(item.amount),
          0
        );
        if (round2(existingTotal + newTotal) > round2(toNumber(entry.amount))) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "分摊合计不得超过源费用，重复计入已阻断",
          });
        }
        await tx.insert(costAllocations).values(
          input.allocations.map(allocation => ({
            costEntryId: input.costEntryId,
            targetType: allocation.targetType,
            targetId: allocation.targetId,
            amount: String(allocation.amount),
            audAmount:
              entry.currency === "AUD"
                ? String(allocation.amount)
                : entry.audAmount === null
                  ? null
                  : String(
                      round2(
                        toNumber(allocation.amount) *
                          (toNumber(entry.audAmount) / toNumber(entry.amount))
                      )
                    ),
            reason: input.reason,
            createdById: ctx.user.id,
          }))
        );
        const status =
          round2(existingTotal + newTotal) === round2(toNumber(entry.amount))
            ? "allocated"
            : "partial";
        await tx
          .update(costEntries)
          .set({ allocationStatus: status })
          .where(eq(costEntries.id, input.costEntryId));
        await audit(
          tx,
          ctx.user.id,
          "finance.cost.allocate",
          "cost_entry",
          input.costEntryId,
          existing,
          input,
          input.reason
        );
        return { ok: true, status };
      });
    }),

  verifyOrderProfit: authedQuery
    .input(
      z.object({
        orderId: idSchema,
        verified: z.boolean(),
        reason: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireArea(ctx.user, "finance", true);
      const db = getDb();
      await db
        .update(salesOrders)
        .set({
          profitStatus: input.verified ? "verified" : "incomplete",
          profitVerifiedById: input.verified ? ctx.user.id : null,
          profitVerifiedAt: input.verified ? now() : null,
          profitRevisionReason: input.reason,
        })
        .where(eq(salesOrders.id, input.orderId));
      await audit(
        db,
        ctx.user.id,
        "finance.profit.verify",
        "order",
        input.orderId,
        undefined,
        input,
        input.reason
      );
      return { ok: true };
    }),

  addSettlement: authedQuery
    .input(
      z.object({
        platform: platformSchema,
        externalShopId: z.string().min(1),
        referenceNo: z.string().min(1),
        periodStart: z.coerce.date(),
        periodEnd: z.coerce.date(),
        currency: z.enum(["AUD", "USD", "CNY"]).default("AUD"),
        grossAmount: z.string().or(z.number()),
        fees: z.string().or(z.number()).default(0),
        refunds: z.string().or(z.number()).default(0),
        taxes: z.string().or(z.number()).default(0),
        withheld: z.string().or(z.number()).default(0),
        adjustments: z.string().or(z.number()).default(0),
        netPlatformPayout: z.string().or(z.number()),
        actualReceived: z.string().or(z.number()).optional(),
        note: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireArea(ctx.user, "finance", true);
      const db = getDb();
      const values = Object.fromEntries(
        Object.entries(input).map(([key, value]) => [
          key,
          typeof value === "number" ? String(value) : value,
        ])
      );
      await db
        .insert(settlements)
        .values(values as unknown as typeof settlements.$inferInsert)
        .onDuplicateKeyUpdate({ set: { note: input.note } });
      await audit(
        db,
        ctx.user.id,
        "finance.settlement.upsert",
        "settlement",
        `${input.platform}:${input.externalShopId}:${input.referenceNo}`,
        undefined,
        input
      );
      return { ok: true };
    }),

  reconcileSettlement: authedQuery
    .input(
      z.object({
        id: idSchema,
        actualReceived: z.string().or(z.number()),
        note: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireArea(ctx.user, "finance", true);
      const db = getDb();
      const rows = await db
        .select()
        .from(settlements)
        .where(eq(settlements.id, input.id))
        .limit(1);
      const before = rows.at(0);
      if (!before)
        throw new TRPCError({ code: "NOT_FOUND", message: "结算批次不存在" });
      const status =
        round2(toNumber(input.actualReceived)) ===
        round2(toNumber(before.netPlatformPayout))
          ? "reconciled"
          : "discrepancy";
      await db
        .update(settlements)
        .set({
          actualReceived: String(input.actualReceived),
          status,
          note: input.note,
          reconciledById: ctx.user.id,
          reconciledAt: now(),
        })
        .where(eq(settlements.id, input.id));
      await audit(
        db,
        ctx.user.id,
        "finance.settlement.reconcile",
        "settlement",
        input.id,
        before,
        { ...input, status },
        input.note
      );
      return { ok: true, status };
    }),

  createTask: authedQuery
    .input(
      z.object({
        severity: z
          .enum(["critical", "high", "medium", "low"])
          .default("medium"),
        type: z.string().min(1),
        title: z.string().min(1).max(255),
        reason: z.string().min(1),
        businessType: z.enum([
          "order",
          "purchase",
          "after_sales",
          "store",
          "sku",
          "sync",
        ]),
        businessId: idSchema,
        ownerId: idSchema.optional(),
        dueAt: z.coerce.date().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      if (/地址|密钥|token|password|secret/i.test(input.title)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "待办标题不得包含地址、密钥等敏感内容",
        });
      }
      const [{ id }] = await db
        .insert(tasks)
        .values({
          ...input,
          stableKey: makeKey("manual-task"),
          source: "manual",
          createdById: ctx.user.id,
        })
        .$returningId();
      await audit(db, ctx.user.id, "task.create", "task", id, undefined, input);
      return { id };
    }),

  updateTask: authedQuery
    .input(
      z.object({
        id: idSchema,
        status: z.enum(["open", "closed"]),
        ownerId: idSchema.optional(),
        dueAt: z.coerce.date().optional(),
        reason: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const rows = await db
        .select()
        .from(tasks)
        .where(eq(tasks.id, input.id))
        .limit(1);
      const before = rows.at(0);
      if (!before)
        throw new TRPCError({ code: "NOT_FOUND", message: "待办不存在" });
      await db
        .update(tasks)
        .set({
          status: input.status,
          ownerId: input.ownerId,
          dueAt: input.dueAt,
          reason: `${before.reason}\n处理说明：${input.reason}`,
          resolvedAt: input.status === "closed" ? now() : null,
          closedAt: input.status === "closed" ? now() : null,
        })
        .where(eq(tasks.id, input.id));
      await audit(
        db,
        ctx.user.id,
        "task.update",
        "task",
        input.id,
        before,
        input,
        input.reason
      );
      return { ok: true };
    }),

  addNote: authedQuery
    .input(
      z.object({
        businessType: businessTargetSchema,
        businessId: idSchema,
        body: z.string().min(1),
        attachmentKey: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [{ id }] = await db
        .insert(notes)
        .values({ ...input, createdById: ctx.user.id })
        .$returningId();
      await audit(
        db,
        ctx.user.id,
        "note.create",
        input.businessType,
        input.businessId,
        undefined,
        { ...input, body: "[INTERNAL_NOTE]" }
      );
      return { id };
    }),

  updateStoreConnection: adminQuery
    .input(
      z.object({
        platform: platformSchema,
        externalShopId: z.string().min(1),
        shopName: z.string().min(1),
        authorizationStatus: z.enum([
          "not_connected",
          "authorized",
          "expired",
          "revoked",
        ]),
        shippingWritebackEnabled: z.boolean().default(false),
        inventoryWritebackEnabled: z.boolean().default(false),
        writebackMode: z
          .enum(["system_controlled", "manual_confirm"])
          .optional(),
        errorSummary: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      if (
        (input.shippingWritebackEnabled || input.inventoryWritebackEnabled) &&
        !input.writebackMode
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "开启写回前必须选择系统主控或人工确认",
        });
      }
      // OAuth 直连店铺的授权状态由平台令牌决定，手工表单不得覆盖
      const [existingStore] = await db
        .select({ id: storeConnections.id })
        .from(storeConnections)
        .where(
          and(
            eq(storeConnections.platform, input.platform),
            eq(storeConnections.externalShopId, input.externalShopId)
          )
        )
        .limit(1);
      let authorizationStatus = input.authorizationStatus;
      if (existingStore) {
        const [credential] = await db
          .select({ id: storeCredentials.id })
          .from(storeCredentials)
          .where(eq(storeCredentials.storeConnectionId, existingStore.id))
          .limit(1);
        if (credential) authorizationStatus = "authorized";
      }
      await db
        .insert(storeConnections)
        .values({ ...input, authorizationStatus })
        .onDuplicateKeyUpdate({
          set: {
            shopName: input.shopName,
            authorizationStatus,
            shippingWritebackEnabled: input.shippingWritebackEnabled,
            inventoryWritebackEnabled: input.inventoryWritebackEnabled,
            writebackMode: input.writebackMode,
            errorSummary: input.errorSummary,
          },
        });
      await audit(
        db,
        ctx.user.id,
        "store.connection.update",
        "store",
        `${input.platform}:${input.externalShopId}`,
        undefined,
        { ...input, authorizationStatus },
        "高风险配置变更"
      );
      return { ok: true };
    }),

  createSyncJob: authedQuery
    .input(
      z.object({
        storeConnectionId: idSchema,
        resourceType: z.enum([
          "orders",
          "listings",
          "refunds",
          "shipments",
          "inventory",
        ]),
        note: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireArea(ctx.user, "orders", true);
      const db = getDb();
      const storeRows = await db
        .select()
        .from(storeConnections)
        .where(eq(storeConnections.id, input.storeConnectionId))
        .limit(1);
      const store = storeRows.at(0);
      if (!store)
        throw new TRPCError({ code: "NOT_FOUND", message: "店铺不存在" });
      if (store.authorizationStatus !== "authorized") {
        await openOrReopenTask(db, {
          stableKey: `store:${store.id}:auth`,
          severity: "critical",
          type: "authorization_invalid",
          title: `${store.shopName} 授权未就绪`,
          reason:
            "店铺未授权或授权已失效；不会伪装同步成功，请先完成官方授权或使用文件导入。",
          businessType: "store",
          businessId: store.id,
          dueAt: now(),
        });
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "店铺授权未就绪，不能创建读取任务",
        });
      }
      const [{ id }] = await db
        .insert(syncJobs)
        .values({
          storeConnectionId: input.storeConnectionId,
          resourceType: input.resourceType,
          status: "queued",
          idempotencyKey: makeKey(`sync:${input.resourceType}`),
        })
        .$returningId();
      await audit(
        db,
        ctx.user.id,
        "sync.job.create",
        "sync_job",
        id,
        undefined,
        input
      );
      return { id };
    }),

  updateMemberRole: adminQuery
    .input(
      z.object({
        userId: idSchema,
        businessRole: z.enum(["admin", "operations", "fulfillment", "finance"]),
        status: z.enum(["active", "disabled"]),
        reason: z.string().min(3),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const rows = await db
        .select()
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);
      const before = rows.at(0);
      if (!before)
        throw new TRPCError({ code: "NOT_FOUND", message: "成员不存在" });
      await db
        .update(users)
        .set({ businessRole: input.businessRole, status: input.status })
        .where(eq(users.id, input.userId));
      await audit(
        db,
        ctx.user.id,
        "member.role.update",
        "user",
        input.userId,
        { businessRole: before.businessRole, status: before.status },
        input,
        input.reason
      );
      return { ok: true };
    }),
});
