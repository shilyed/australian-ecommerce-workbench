import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { localAccounts, users, type User } from "@db/schema";
import { getDb } from "../queries/connection";
import { hashPassword, isValidEmail, normalizeEmail } from "./password";

type CreateLocalUserInput = {
  email: string;
  name: string;
  password: string;
  role?: "user" | "admin";
  businessRole?: "admin" | "operations" | "fulfillment" | "finance";
};

export async function hasAnyLocalAccount(): Promise<boolean> {
  const rows = await getDb()
    .select({ id: localAccounts.id })
    .from(localAccounts)
    .limit(1);
  return rows.length > 0;
}

export async function listLocalAccountEmails(): Promise<
  Array<{ userId: number; email: string }>
> {
  return getDb()
    .select({ userId: localAccounts.userId, email: localAccounts.email })
    .from(localAccounts)
    .orderBy(asc(localAccounts.email));
}

export async function createLocalUser(
  input: CreateLocalUserInput
): Promise<User> {
  const email = normalizeEmail(input.email);
  const name = input.name.trim();
  if (!isValidEmail(email)) throw new Error("请输入有效邮箱地址");
  if (!name) throw new Error("请输入成员姓名");
  const passwordHash = await hashPassword(input.password);
  const db = getDb();

  const userId = await db.transaction(async tx => {
    const existing = await tx
      .select({ id: localAccounts.id })
      .from(localAccounts)
      .where(eq(localAccounts.email, email))
      .limit(1);
    if (existing.length) throw new Error("该邮箱已绑定工作台账号");

    const inserted = await tx
      .insert(users)
      .values({
        unionId: `local:${randomUUID()}`,
        name,
        email,
        role: input.role ?? "user",
        businessRole: input.businessRole ?? "operations",
        status: "active",
        lastSignInAt: new Date(),
      })
      .$returningId();
    const id = inserted[0]?.id;
    if (!id) throw new Error("创建成员失败");

    await tx.insert(localAccounts).values({
      userId: id,
      email,
      passwordHash,
      sessionVersion: 0,
    });
    return id;
  });

  const rows = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const user = rows.at(0);
  if (!user) throw new Error("创建成员后读取失败");
  return user;
}
