/**
 * 服务器侧密码恢复工具。
 *
 * 用法：
 *   EMAIL=admin@example.com NEW_PASSWORD='NewPassword123' npm run db:set-password
 *
 * 只修改现有账号；不会创建新用户。适合管理员忘记密码时在服务器上执行。
 */
import "dotenv/config";
import { randomBytes, scryptSync } from "node:crypto";
import mysql from "mysql2/promise";

const email = (process.env.EMAIL || process.env.ADMIN_EMAIL || "")
  .trim()
  .toLowerCase();
const password = process.env.NEW_PASSWORD || "";

if (!process.env.DATABASE_URL) {
  console.error("缺少 DATABASE_URL。");
  process.exit(1);
}
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("请设置 EMAIL（有效邮箱地址）。");
  process.exit(1);
}
if (
  password.length < 12 ||
  password.length > 128 ||
  !/[A-Za-z]/.test(password) ||
  !/\d/.test(password)
) {
  console.error("NEW_PASSWORD 至少 12 位，且必须同时包含字母和数字。");
  process.exit(1);
}

const salt = randomBytes(16);
const derived = scryptSync(password, salt, 64, {
  N: 16_384,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
});
const passwordHash = [
  "scrypt",
  16_384,
  8,
  1,
  salt.toString("base64url"),
  derived.toString("base64url"),
].join("$");

const connection = await mysql.createConnection(process.env.DATABASE_URL);

try {
  const [accounts] = await connection.execute(
    "SELECT id FROM local_accounts WHERE email = ? LIMIT 1",
    [email]
  );
  if (accounts.length) {
    await connection.execute(
      `UPDATE local_accounts
       SET passwordHash = ?, sessionVersion = sessionVersion + 1,
           failedLoginAttempts = 0, lockedUntil = NULL,
           passwordChangedAt = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [passwordHash, accounts[0].id]
    );
  } else {
    const [users] = await connection.execute(
      "SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1",
      [email]
    );
    if (!users.length) {
      console.error(`没有找到邮箱为 ${email} 的成员，请先在系统内创建成员。`);
      process.exitCode = 1;
    } else {
      await connection.execute(
        `INSERT INTO local_accounts
           (userId, email, passwordHash, sessionVersion, failedLoginAttempts)
         VALUES (?, ?, ?, 0, 0)`,
        [users[0].id, email, passwordHash]
      );
    }
  }

  if (!process.exitCode) {
    console.log(`已为 ${email} 设置新密码，旧登录会话已失效。`);
  }
} finally {
  await connection.end();
}
