import { describe, expect, it } from "vitest";
import {
  assertPasswordStrength,
  hashPassword,
  verifyPassword,
} from "./password";

describe("password hashing", () => {
  it("verifies the correct password and rejects a wrong one", async () => {
    const encoded = await hashPassword("CorrectHorse9");
    await expect(verifyPassword("CorrectHorse9", encoded)).resolves.toBe(true);
    await expect(verifyPassword("WrongHorse99", encoded)).resolves.toBe(false);
  });

  it("uses a unique salt for each hash", async () => {
    const first = await hashPassword("CorrectHorse9");
    const second = await hashPassword("CorrectHorse9");
    expect(first).not.toBe(second);
  });

  it("rejects weak passwords", () => {
    expect(() => assertPasswordStrength("short")).toThrow();
    expect(() => assertPasswordStrength("allletterslong")).toThrow();
    expect(() => assertPasswordStrength("123456789012")).toThrow();
    expect(() => assertPasswordStrength("LongEnough123")).not.toThrow();
  });
});
