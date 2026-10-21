import { env } from "../lib/env";
import {
  assertPasswordStrength,
  isValidEmail,
  normalizeEmail,
} from "./password";
import { createLocalUser, hasAnyLocalAccount } from "./accounts";

/**
 * 首次启动可用环境变量创建管理员，适合自动部署。
 * 一旦存在任何本地账号，环境变量中的初始密码不会再被使用。
 */
export async function bootstrapAdminFromEnv(): Promise<void> {
  const email = normalizeEmail(env.adminEmail);
  if (!email || !env.adminPassword) return;

  if (await hasAnyLocalAccount()) return;
  if (!isValidEmail(email)) {
    throw new Error("ADMIN_EMAIL 不是有效邮箱地址");
  }

  assertPasswordStrength(env.adminPassword);
  await createLocalUser({
    email,
    name: env.adminName || "管理员",
    password: env.adminPassword,
    role: "admin",
    businessRole: "admin",
  });
  console.log(`[auth] 已创建初始管理员账号：${email}`);
}
