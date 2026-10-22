-- 多市场刊登：主商品（skus）在 eBay / Etsy / Amazon 上的市场详情
-- 应用方式（任选其一）：
--   1) npm run db:push（以 db/schema.ts 为准）
--   2) mysql -u <user> -p <db> < db/migrations/0003_marketplace_listings.sql

CREATE TABLE IF NOT EXISTS `marketplace_listings` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `skuId` bigint unsigned NOT NULL,
  `platform` enum('ebay','etsy','amazon') NOT NULL,
  `storeConnectionId` bigint unsigned NOT NULL,
  `status` enum('draft','ready','publishing','published','unpublished','failed') NOT NULL DEFAULT 'draft',
  `platformSku` varchar(255) NULL,
  `externalListingId` varchar(255) NULL,
  `externalOfferId` varchar(255) NULL,
  `listingUrl` varchar(1024) NULL,
  `localPayload` json NULL,
  `lastPushedPayload` json NULL,
  `lastPushedHash` varchar(64) NULL,
  `lastError` text NULL,
  `lastPushedAt` timestamp NULL,
  `publishedAt` timestamp NULL,
  `createdBy` bigint unsigned NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `marketplace_listing_key` (`skuId`, `platform`, `storeConnectionId`),
  KEY `marketplace_listing_status_idx` (`platform`, `status`),
  KEY `marketplace_listing_store_idx` (`storeConnectionId`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
