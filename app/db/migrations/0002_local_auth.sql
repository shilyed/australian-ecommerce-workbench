-- 自托管邮箱密码登录
-- 应用方式（任选其一）：
--   1) npm run db:push
--   2) mysql -u <user> -p <db> < db/migrations/0002_local_auth.sql

CREATE TABLE IF NOT EXISTS `local_accounts` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `userId` bigint unsigned NOT NULL,
  `email` varchar(320) NOT NULL,
  `passwordHash` varchar(255) NOT NULL,
  `sessionVersion` int NOT NULL DEFAULT 0,
  `failedLoginAttempts` int NOT NULL DEFAULT 0,
  `lockedUntil` timestamp NULL,
  `passwordChangedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `lastLoginAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `local_accounts_user_key` (`userId`),
  UNIQUE KEY `local_accounts_email_key` (`email`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
