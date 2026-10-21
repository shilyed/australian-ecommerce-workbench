import { describe, expect, it } from "vitest";
import { computeEbayChallengeResponse } from "./ebay-compliance";

describe("eBay marketplace account deletion challenge", () => {
  it("hashes challenge code, token, and endpoint in the documented order", () => {
    expect(
      computeEbayChallengeResponse(
        "challenge-123",
        "verification-token",
        "https://workbench.example.com/api/integrations/ebay/account-deletion/secret"
      )
    ).toMatch(/^[a-f0-9]{64}$/);
  });
});
