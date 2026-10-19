import { TRPCError } from "@trpc/server";
import type { User } from "@db/schema";

type Actor = Pick<User, "role" | "businessRole" | "status">;
type Area =
  | "sourcing"
  | "procurement"
  | "inventory"
  | "orders"
  | "shipping"
  | "finance"
  | "settings";

export function roleOf(user: Actor) {
  return user.role === "admin" ? "admin" : user.businessRole;
}

export function can(user: Actor, area: Area, write = false) {
  const role = roleOf(user);
  if (role === "admin") return true;
  if (area === "settings") return false;
  if (role === "operations") return true;
  if (role === "fulfillment") {
    if (area === "finance" || area === "sourcing") return false;
    if (area === "inventory" || area === "procurement") return !write;
    return true;
  }
  if (role === "finance") {
    if (area === "finance") return true;
    return !write && ["orders", "procurement", "inventory"].includes(area);
  }
  return false;
}

export function requireArea(user: Actor, area: Area, write = false) {
  if (user.status !== "active") {
    throw new TRPCError({ code: "FORBIDDEN", message: "成员已被禁用" });
  }
  if (!can(user, area, write)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "当前角色无权执行该操作",
    });
  }
}
