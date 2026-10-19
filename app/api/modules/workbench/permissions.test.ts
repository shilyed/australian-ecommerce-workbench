import { describe, expect, it } from "vitest";
import { can, requireArea } from "./permissions";

describe("workbench permission compatibility", () => {
  const member = {
    role: "user" as const,
    businessRole: "fulfillment" as const,
    status: "active" as const,
  };
  it("preserves fulfillment reads but prevents purchasing and inventory writes", () => {
    expect(can(member, "procurement")).toBe(true);
    expect(can(member, "procurement", true)).toBe(false);
    expect(can(member, "inventory", true)).toBe(false);
    expect(can(member, "shipping", true)).toBe(true);
    expect(can(member, "finance")).toBe(false);
  });
  it("does not let finance roles fulfill orders or manage connections", () => {
    const finance = { ...member, businessRole: "finance" as const };
    expect(can(finance, "finance", true)).toBe(true);
    expect(can(finance, "orders")).toBe(true);
    expect(can(finance, "orders", true)).toBe(false);
    expect(can(finance, "settings", true)).toBe(false);
  });
  it("preserves administrator and operations access", () => {
    expect(can({ ...member, role: "admin" }, "settings", true)).toBe(true);
    expect(
      can({ ...member, businessRole: "operations" }, "procurement", true)
    ).toBe(true);
    expect(can({ ...member, businessRole: "operations" }, "settings")).toBe(
      false
    );
  });
  it("rejects disabled accounts even when they otherwise have access", () => {
    expect(() =>
      requireArea(
        { ...member, role: "admin", status: "disabled" },
        "shipping",
        true
      )
    ).toThrow("成员已被禁用");
    expect(() => requireArea(member, "procurement", true)).toThrow(
      "当前角色无权执行该操作"
    );
  });
});
