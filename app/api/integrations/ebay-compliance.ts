import { createHash, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { and, eq, inArray } from "drizzle-orm";
import {
  auditLogs,
  salesOrders,
  storeConnections,
  storeCredentials,
  type StoreConnection,
} from "@db/schema";
import { getDb } from "../queries/connection";
import { integrationEnv } from "../lib/env";

type EbayDeletionPayload = {
  metadata?: {
    topic?: string;
  };
  notification?: {
    notificationId?: string;
    data?: {
      userId?: string;
      username?: string;
      eiasToken?: string;
    };
  };
};

export function computeEbayChallengeResponse(
  challengeCode: string,
  verificationToken: string,
  endpoint: string
): string {
  return createHash("sha256")
    .update(challengeCode)
    .update(verificationToken)
    .update(endpoint)
    .digest("hex");
}

function sameSecret(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function configuredEndpointPath(): string | null {
  const endpoint = integrationEnv.ebay.deletionEndpoint.trim();
  if (!endpoint) return null;
  try {
    return new URL(endpoint).pathname;
  } catch {
    return null;
  }
}

function matchesDeletedAccount(
  store: StoreConnection,
  userId: string,
  username: string
): boolean {
  return (
    (userId !== "" &&
      (store.externalAccountId === userId ||
        store.externalShopId === userId)) ||
    (username !== "" &&
      (store.accountLabel === username ||
        store.shopName === username ||
        store.shopName === `${username} · eBay`))
  );
}

async function eraseEbayUserData(
  payload: EbayDeletionPayload
): Promise<number> {
  const data = payload.notification?.data;
  const userId = data?.userId?.trim() ?? "";
  const username = data?.username?.trim() ?? "";
  if (!userId && !username) return 0;

  const db = getDb();
  const stores = await db
    .select()
    .from(storeConnections)
    .where(eq(storeConnections.platform, "ebay"));
  const matched = stores.filter(store =>
    matchesDeletedAccount(store, userId, username)
  );
  if (matched.length === 0) return 0;

  const storeIds = matched.map(store => store.id);
  const externalShopIds = Array.from(
    new Set(matched.map(store => store.externalShopId).filter(Boolean))
  );

  await db
    .delete(storeCredentials)
    .where(inArray(storeCredentials.storeConnectionId, storeIds));

  await db
    .update(storeConnections)
    .set({
      shopName: "已删除的 eBay 店铺",
      authorizationStatus: "revoked",
      externalAccountId: null,
      accountLabel: null,
      connectedBy: null,
      connectedAt: null,
      profileSyncedAt: null,
      profileSummary: null,
      errorSummary: "已按 eBay 用户数据删除通知清除账号资料与授权凭证。",
    })
    .where(inArray(storeConnections.id, storeIds));

  if (externalShopIds.length > 0) {
    await db
      .update(salesOrders)
      .set({
        buyerName: null,
        buyerEmail: null,
        destinationCountry: null,
        postalCode: null,
        addressSummary: null,
        note: null,
        rawSnapshot: null,
      })
      .where(
        and(
          eq(salesOrders.platform, "ebay"),
          inArray(salesOrders.externalShopId, externalShopIds)
        )
      );
  }

  await db.insert(auditLogs).values({
    actorId: null,
    action: "store.ebay.account_deletion",
    entityType: "store",
    entityId: storeIds.join(","),
    beforeJson: {
      storeIds,
      externalShopIds,
      notificationId: payload.notification?.notificationId ?? null,
    },
    afterJson: {
      credentialsDeleted: true,
      profileCleared: true,
      orderBuyerFieldsAnonymized: true,
    },
    reason: "eBay Marketplace Account Deletion 通知",
  });

  return matched.length;
}

export function createEbayComplianceRoutes() {
  const app = new Hono();

  app.get("/ebay/account-deletion/:secret", c => {
    const expectedPath = configuredEndpointPath();
    if (
      !expectedPath ||
      !sameSecret(c.req.path, expectedPath) ||
      !integrationEnv.ebay.verificationToken
    ) {
      return c.json({ error: "Not Found" }, 404);
    }

    const challengeCode = c.req.query("challenge_code");
    if (!challengeCode) {
      return c.json({ error: "challenge_code is required" }, 400);
    }

    return c.json({
      challengeResponse: computeEbayChallengeResponse(
        challengeCode,
        integrationEnv.ebay.verificationToken,
        integrationEnv.ebay.deletionEndpoint
      ),
    });
  });

  app.post("/ebay/account-deletion/:secret", async c => {
    const expectedPath = configuredEndpointPath();
    if (!expectedPath || !sameSecret(c.req.path, expectedPath)) {
      return c.json({ error: "Not Found" }, 404);
    }

    let payload: EbayDeletionPayload;
    try {
      payload = (await c.req.json()) as EbayDeletionPayload;
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }

    try {
      await eraseEbayUserData(payload);
    } catch (error) {
      console.error(
        "[ebay] account deletion processing failed:",
        error instanceof Error ? error.message : error
      );
      // eBay retries non-2xx responses. A database outage should be retried.
      return c.json({ error: "Deletion processing failed" }, 503);
    }

    return c.body(null, 204);
  });

  return app;
}
