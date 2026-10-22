import { and, eq } from "drizzle-orm";
import { auditLogs, storeConnections, storeCredentials } from "@db/schema";
import { getDb } from "../queries/connection";
import { decryptSecret, encryptSecret } from "../lib/secrets";
import { IntegrationError, type IntegrationPlatform, type StoreProfile, type TokenSet } from "./types";
import { fetchStoreProfile, refreshAccessToken } from "./providers";

export async function saveConnectedStore(options: {
  platform: IntegrationPlatform;
  profile: StoreProfile;
  tokens: TokenSet;
  actorId: number;
}): Promise<number> {
  const { platform, profile, tokens, actorId } = options;
  const db = getDb();
  const now = new Date();
  const profileJson = JSON.stringify(profile);

  await db
    .insert(storeConnections)
    .values({
      platform,
      externalShopId: profile.accountId,
      shopName: profile.shopName,
      authorizationStatus: "authorized",
      lastAttemptAt: now,
      lastSuccessAt: now,
      externalAccountId: profile.accountId,
      accountLabel: profile.accountLabel,
      connectedBy: actorId,
      connectedAt: now,
      profileSyncedAt: now,
      profileSummary: profileJson,
      errorSummary: null,
    })
    .onDuplicateKeyUpdate({
      set: {
        shopName: profile.shopName,
        authorizationStatus: "authorized",
        lastAttemptAt: now,
        lastSuccessAt: now,
        externalAccountId: profile.accountId,
        accountLabel: profile.accountLabel,
        connectedBy: actorId,
        connectedAt: now,
        profileSyncedAt: now,
        profileSummary: profileJson,
        errorSummary: null,
      },
    });

  const [store] = await db
    .select({ id: storeConnections.id })
    .from(storeConnections)
    .where(
      and(
        eq(storeConnections.platform, platform),
        eq(storeConnections.externalShopId, profile.accountId),
      ),
    )
    .limit(1);
  if (!store) {
    throw new IntegrationError("店铺记录写入失败，请重试");
  }

  await db
    .insert(storeCredentials)
    .values({
      storeConnectionId: store.id,
      platform,
      accessToken: encryptSecret(tokens.accessToken),
      refreshToken: tokens.refreshToken ? encryptSecret(tokens.refreshToken) : null,
      tokenExpiresAt: tokens.expiresAt,
      scopes: tokens.scopes.join(" "),
      tokenType: tokens.tokenType,
      lastRefreshedAt: now,
    })
    .onDuplicateKeyUpdate({
      set: {
        accessToken: encryptSecret(tokens.accessToken),
        refreshToken: tokens.refreshToken ? encryptSecret(tokens.refreshToken) : null,
        tokenExpiresAt: tokens.expiresAt,
        scopes: tokens.scopes.join(" "),
        tokenType: tokens.tokenType,
        lastRefreshedAt: now,
      },
    });

  await db.insert(auditLogs).values({
    actorId,
    action: "store.oauth.connect",
    entityType: "store",
    entityId: String(store.id),
    afterJson: {
      platform,
      externalShopId: profile.accountId,
      accountLabel: profile.accountLabel,
      scopes: tokens.scopes,
    },
    reason: "管理员通过官方 OAuth 完成店铺授权",
  });

  return store.id;
}

export async function getStoreCredentials(storeId: number) {
  const db = getDb();
  const [store] = await db
    .select()
    .from(storeConnections)
    .where(eq(storeConnections.id, storeId))
    .limit(1);
  if (!store) throw new IntegrationError("店铺不存在");
  const [credentials] = await db
    .select()
    .from(storeCredentials)
    .where(eq(storeCredentials.storeConnectionId, storeId))
    .limit(1);
  return { store, credentials };
}

async function persistRefreshedToken(storeId: number, tokens: TokenSet, previousRefresh?: string | null) {
  const db = getDb();
  await db
    .update(storeCredentials)
    .set({
      accessToken: encryptSecret(tokens.accessToken),
      refreshToken: tokens.refreshToken
        ? encryptSecret(tokens.refreshToken)
        : previousRefresh ?? null,
      tokenExpiresAt: tokens.expiresAt,
      scopes: tokens.scopes.join(" "),
      tokenType: tokens.tokenType,
      lastRefreshedAt: new Date(),
    })
    .where(eq(storeCredentials.storeConnectionId, storeId));
}

export async function getValidAccessToken(storeId: number): Promise<{
  store: typeof storeConnections.$inferSelect;
  accessToken: string;
}> {
  const { store, credentials } = await getStoreCredentials(storeId);
  if (!credentials) {
    throw new IntegrationError("该店铺尚未完成官方授权，请先点击“连接店铺”");
  }

  const accessToken = decryptSecret(credentials.accessToken);
  const expiresAt = credentials.tokenExpiresAt?.getTime() ?? 0;
  if (expiresAt - Date.now() > 60_000) {
    return { store, accessToken };
  }

  if (!credentials.refreshToken) {
    throw new IntegrationError("授权已过期且没有可用的刷新令牌，请重新连接店铺");
  }

  try {
    const refreshed = await refreshAccessToken(
      store.platform,
      decryptSecret(credentials.refreshToken),
      credentials.scopes,
    );
    await persistRefreshedToken(storeId, refreshed, credentials.refreshToken);
    return { store, accessToken: refreshed.accessToken };
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    const db = getDb();
    await db
      .update(storeConnections)
      .set({
        authorizationStatus: "expired",
        lastAttemptAt: new Date(),
        errorSummary: `授权刷新失败：${message}`,
      })
      .where(eq(storeConnections.id, storeId));
    throw new IntegrationError(`授权已过期，请重新连接店铺：${message}`);
  }
}

export async function refreshStoreProfile(storeId: number): Promise<StoreProfile> {
  const { store, accessToken } = await getValidAccessToken(storeId);
  const db = getDb();
  const now = new Date();
  try {
    const profile = await fetchStoreProfile(store.platform, accessToken);
    await db
      .update(storeConnections)
      .set({
        shopName: profile.shopName,
        authorizationStatus: "authorized",
        externalAccountId: profile.accountId,
        accountLabel: profile.accountLabel,
        profileSyncedAt: now,
        profileSummary: JSON.stringify(profile),
        lastAttemptAt: now,
        lastSuccessAt: now,
        errorSummary: null,
      })
      .where(eq(storeConnections.id, storeId));
    return profile;
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    const authFailed = error instanceof IntegrationError && error.status === 401;
    await db
      .update(storeConnections)
      .set({
        lastAttemptAt: now,
        errorSummary: message,
        ...(authFailed ? { authorizationStatus: "expired" as const } : {}),
      })
      .where(eq(storeConnections.id, storeId));
    throw error;
  }
}

export async function disconnectStore(storeId: number, actorId: number): Promise<void> {
  const db = getDb();
  const { store, credentials } = await getStoreCredentials(storeId);
  if (!credentials) {
    throw new IntegrationError("该店铺本来就没有官方授权凭证");
  }

  await db.delete(storeCredentials).where(eq(storeCredentials.storeConnectionId, storeId));
  await db
    .update(storeConnections)
    .set({
      authorizationStatus: "not_connected",
      externalAccountId: null,
      accountLabel: null,
      connectedBy: null,
      connectedAt: null,
      profileSyncedAt: null,
      profileSummary: null,
      errorSummary: "管理员已断开官方授权；历史业务数据保留，但读取与写回暂停。",
    })
    .where(eq(storeConnections.id, storeId));

  await db.insert(auditLogs).values({
    actorId,
    action: "store.oauth.disconnect",
    entityType: "store",
    entityId: String(storeId),
    beforeJson: {
      platform: store.platform,
      externalShopId: store.externalShopId,
      accountLabel: store.accountLabel,
    },
    reason: "管理员断开店铺官方授权",
  });
}

