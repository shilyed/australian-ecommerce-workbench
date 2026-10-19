-- 平台官方直连（Etsy / eBay OAuth）
-- 应用方式（任选其一）：
--   1) npm run db:push                     （drizzle 直接按 schema 同步）
--   2) mysql -u <user> -p <db> < db/migrations/0001_store_oauth.sql

ALTER TABLE `store_connections`
  ADD COLUMN `externalAccountId` varchar(255) NULL,
  ADD COLUMN `accountLabel` varchar(255) NULL,
  ADD COLUMN `connectedBy` bigint unsigned NULL,
  ADD COLUMN `connectedAt` timestamp NULL,
  ADD COLUMN `profileSyncedAt` timestamp NULL,
  ADD COLUMN `profileSummary` text NULL;

CREATE TABLE IF NOT EXISTS `store_credentials` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `storeConnectionId` bigint unsigned NOT NULL,
  `platform` enum('etsy','ebay') NOT NULL,
  `accessToken` text NOT NULL,
  `refreshToken` text NULL,
  `tokenExpiresAt` timestamp NULL,
  `scopes` text NULL,
  `tokenType` varchar(32) NULL,
  `lastRefreshedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `store_credentials_store_key` (`storeConnectionId`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
