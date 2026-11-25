import { LiquityAgentKitError } from "./errors.js";

export const WAD = 10n ** 18n;

function nonNegative(label: string, ...values: bigint[]) {
  if (values.some((v) => v < 0n)) throw new LiquityAgentKitError("INVALID_INPUT", `${label} must be non-negative.`);
}

/**
 * Collateral ratio (ICR) in 18-decimal fixed point (1e18 = 100%).
 * `collateral` and `debt` are 1e18-scaled base units, `price` is USD per collateral unit scaled 1e18.
 * Rounds down. Returns null when debt is zero (ratio undefined).
 */
export function collateralRatio(collateral: bigint, price: bigint, debt: bigint): bigint | null {
  nonNegative("Amounts", collateral, price, debt);
  if (debt === 0n) return null;
  return (collateral * price) / debt;
}

/** Simple-interest estimate only; excludes batch management fees, compounding and future debt changes. Rounds down. */
export function estimateSimpleInterest(debt: bigint, annualRateWad: bigint, days: bigint): bigint {
  nonNegative("Debt, rate and days", debt, annualRateWad, days);
  return (debt * annualRateWad * days) / (WAD * 365n);
}

/**
 * USD price (1e18) at which a position's ICR equals `mcrWad`, i.e. debt * MCR / collateral.
 * Rounds up so the reported price is never below the true threshold. Returns null when collateral is zero.
 */
export function liquidationPrice(debt: bigint, mcrWad: bigint, collateral: bigint): bigint | null {
  nonNegative("Inputs", debt, mcrWad, collateral);
  if (collateral === 0n) return null;
  const numerator = debt * mcrWad;
  return (numerator + collateral - 1n) / collateral;
}
