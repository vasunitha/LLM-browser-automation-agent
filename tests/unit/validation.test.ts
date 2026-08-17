import { describe, it, expect } from "vitest";
import {
  validateSubAccountForm,
  MIN_INITIAL_DEPOSIT_CENTS,
  LARGE_DEPOSIT_THRESHOLD_CENTS,
} from "../../src/app/validation";

describe("validateSubAccountForm", () => {
  it("accepts a valid submission", () => {
    const result = validateSubAccountForm({
      accountType: "sub_savings",
      nickname: "Vacation Fund",
      initialDeposit: "50.00",
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.initialDepositCents).toBe(5000);
      expect(result.data.accountType).toBe("sub_savings");
      expect(result.data.nickname).toBe("Vacation Fund");
    }
  });

  it("rejects an invalid account type", () => {
    const result = validateSubAccountForm({
      accountType: "checking",
      nickname: "Test Account",
      initialDeposit: "50.00",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.accountType).toBeDefined();
  });

  it("rejects a nickname that is too short", () => {
    const result = validateSubAccountForm({
      accountType: "sub_savings",
      nickname: "A",
      initialDeposit: "50.00",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.nickname).toBeDefined();
  });

  it("rejects a deposit below the minimum", () => {
    const result = validateSubAccountForm({
      accountType: "sub_savings",
      nickname: "Test Account",
      initialDeposit: "10.00",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.initialDeposit).toBeDefined();
  });

  it("rejects a non-numeric deposit", () => {
    const result = validateSubAccountForm({
      accountType: "sub_savings",
      nickname: "Test Account",
      initialDeposit: "not-a-number",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.initialDeposit).toBeDefined();
  });

  it("accepts a deposit exactly at the minimum", () => {
    const result = validateSubAccountForm({
      accountType: "sub_checking",
      nickname: "Minimum Deposit",
      initialDeposit: (MIN_INITIAL_DEPOSIT_CENTS / 100).toFixed(2),
    });
    expect(result.valid).toBe(true);
  });

  it("still validates as 'valid' at/above the large-deposit threshold — that decision belongs to the caller, not this function", () => {
    const result = validateSubAccountForm({
      accountType: "sub_savings",
      nickname: "Big Deposit",
      initialDeposit: (LARGE_DEPOSIT_THRESHOLD_CENTS / 100).toFixed(2),
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.initialDepositCents).toBeGreaterThanOrEqual(LARGE_DEPOSIT_THRESHOLD_CENTS);
    }
  });

  it("reports all applicable errors at once, not just the first", () => {
    const result = validateSubAccountForm({
      accountType: "bogus",
      nickname: "",
      initialDeposit: "1.00",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.accountType).toBeDefined();
      expect(result.errors.nickname).toBeDefined();
      expect(result.errors.initialDeposit).toBeDefined();
    }
  });
});
