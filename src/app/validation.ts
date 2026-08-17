export const MIN_INITIAL_DEPOSIT_CENTS = 2_500; // $25.00
export const LARGE_DEPOSIT_THRESHOLD_CENTS = 1_000_000; // $10,000.00 — triggers the confirmation interstitial
export const ALLOWED_ACCOUNT_TYPES = ["sub_savings", "sub_checking"] as const;
export type SubAccountType = (typeof ALLOWED_ACCOUNT_TYPES)[number];

export interface SubAccountFormInput {
  accountType?: unknown;
  nickname?: unknown;
  initialDeposit?: unknown;
}

export interface SubAccountFormErrors {
  accountType?: string;
  nickname?: string;
  initialDeposit?: string;
}

export interface ValidatedSubAccountForm {
  accountType: SubAccountType;
  nickname: string;
  initialDepositCents: number;
}

export type SubAccountValidationResult =
  | { valid: true; data: ValidatedSubAccountForm }
  | { valid: false; errors: SubAccountFormErrors };

function isAllowedAccountType(value: string): value is SubAccountType {
  return (ALLOWED_ACCOUNT_TYPES as readonly string[]).includes(value);
}

function parseDollarsToCents(raw: string): number | null {
  const cleaned = raw.trim().replace(/[$,]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [dollars, centsRaw = ""] = cleaned.split(".");
  const cents = centsRaw.padEnd(2, "0").slice(0, 2);
  return Number(dollars) * 100 + Number(cents);
}

/**
 * Validates a raw sub-account form submission. Deliberately does not know
 * about the large-deposit confirmation interstitial — a validated,
 * in-range deposit is always "valid" here; the caller decides whether it
 * also needs extra confirmation.
 */
export function validateSubAccountForm(input: SubAccountFormInput): SubAccountValidationResult {
  const errors: SubAccountFormErrors = {};

  const accountTypeRaw = typeof input.accountType === "string" ? input.accountType : "";
  if (!isAllowedAccountType(accountTypeRaw)) {
    errors.accountType = "Select a valid account type.";
  }

  const nickname = typeof input.nickname === "string" ? input.nickname.trim() : "";
  if (nickname.length < 2 || nickname.length > 40) {
    errors.nickname = "Nickname must be between 2 and 40 characters.";
  }

  const initialDepositRaw = typeof input.initialDeposit === "string" ? input.initialDeposit : "";
  const cents = initialDepositRaw ? parseDollarsToCents(initialDepositRaw) : null;
  if (cents === null) {
    errors.initialDeposit = "Enter a valid dollar amount (e.g. 25.00).";
  } else if (cents < MIN_INITIAL_DEPOSIT_CENTS) {
    errors.initialDeposit = `Initial deposit must be at least $${(MIN_INITIAL_DEPOSIT_CENTS / 100).toFixed(2)}.`;
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    data: {
      accountType: accountTypeRaw as SubAccountType,
      nickname,
      initialDepositCents: cents as number,
    },
  };
}
