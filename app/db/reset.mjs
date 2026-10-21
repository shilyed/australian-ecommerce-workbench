/**
 * 清空数据库中的业务数据。
 *
 * 用法：
 *   npm run db:reset -- --yes                 # 清空全部表（含 users）
 *   npm run db:reset -- --yes --keep-users    # 保留登录用户，只清业务数据
 *
 * 注意：
 * - 这是不可逆操作，请先备份。
 * - 只清理数据库行；自托管附件目录里的文件不会被删除。
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const TABLES = [
  "after_sales_cases",
  "shipment_lines",
  "shipments",
  "sales_order_lines",
  "sales_orders",
  "settlements",
  "cost_allocations",
  "cost_entries",
  "exchange_rates",
  "inventory_ledger",
  "inventory_lots",
  "inventory_positions",
  "goods_receipt_lines",
  "goods_receipts",
  "payment_records",
  "purchase_order_lines",
  "purchase_orders",
  "channel_listings",
  "skus",
  "product_candidates",
  "suppliers",
  "sync_jobs",
  "store_credentials",
  "store_connections",
  "tasks",
  "notes",
  "audit_logs",
  "files",
  "local_accounts",
  "users",
];

const confirmed = process.argv.includes("--yes");
const keepUsers = process.argv.includes("--keep-users");

if (!confirmed) {
  console.error(
    [
      "这会清空数据库中的业务数据，且不可恢复。",
      "",
      "  npm run db:reset -- --yes                 # 清空全部表（含 users）",
      "  npm run db:reset -- --yes --keep-users    # 保留登录用户",
      "",
      "确认无误后请追加 --yes 重新执行。",
    ].join("\n")
  );
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error("缺少 DATABASE_URL，无法连接数据库。请先配置 .env。");
  process.exit(1);
}

const targets = TABLES.filter(
  table => !(keepUsers && (table === "users" || table === "local_accounts"))
);
const connection = await mysql.createConnection(process.env.DATABASE_URL);

try {
  await connection.query("SET FOREIGN_KEY_CHECKS = 0");
  for (const table of targets) {
    await connection.query(`TRUNCATE TABLE \`${table}\``);
    console.log(`cleared ${table}`);
  }
  await connection.query("SET FOREIGN_KEY_CHECKS = 1");
  console.log(`\nDone. Cleared ${targets.length} tables.`);
  if (keepUsers) console.log("users 与 local_accounts 表已保留。");
} finally {
  await connection.end();
}
