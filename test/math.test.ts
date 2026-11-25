import { describe, expect, it } from "vitest";
import { collateralRatio, estimateSimpleInterest, liquidationPrice, WAD } from "../src/core/math.js";
import { LiquityAgentKitError } from "../src/core/errors.js";

describe("fixed-point calculations", () => {
  it("calculates collateral ratio in 18-decimal form", () => {
    expect(collateralRatio(2n * WAD, 2000n * WAD, 2000n * WAD)).toBe(2n * WAD);
  });
  it("returns null for zero debt", () => expect(collateralRatio(10n, 2n, 0n)).toBeNull());
  it("returns zero ratio for zero collateral or zero price", () => {
    expect(collateralRatio(0n, 2000n * WAD, 1000n * WAD)).toBe(0n);
    expect(collateralRatio(WAD, 0n, 1000n * WAD)).toBe(0n);
  });
  it("rounds collateral ratio down", () => expect(collateralRatio(1n, 1n, 3n)).toBe(0n));
  it("estimates simple interest without floating point", () => {
    expect(estimateSimpleInterest(10_000n * WAD, 5n * WAD / 100n, 365n)).toBe(500n * WAD);
    expect(estimateSimpleInterest(10_000n * WAD, 5n * WAD / 100n, 0n)).toBe(0n);
  });
  it("is exact for values beyond 2^53", () => {
    const debt = 123_456_789_012_345_678_901n * WAD;
    expect(estimateSimpleInterest(debt, WAD, 365n)).toBe(debt);
  });
  it("calculates liquidation price from debt, MCR and collateral", () => {
    expect(liquidationPrice(1_000n, 11n * WAD / 10n, 2n * WAD)).toBe(550n);
  });
  it("rounds liquidation price up so it is never below the true threshold", () => {
    expect(liquidationPrice(1n, WAD, 3n)).toBe(333_333_333_333_333_334n); // ceil(1e18 / 3)
    expect(liquidationPrice(1n, 1n, 2n)).toBe(1n);
  });
  it("returns null liquidation price when there is no collateral", () => expect(liquidationPrice(1000n, WAD, 0n)).toBeNull());
  it("rejects negative inputs with INVALID_INPUT", () => {
    for (const fn of [() => collateralRatio(-1n, 1n, 1n), () => estimateSimpleInterest(1n, -1n, 1n), () => liquidationPrice(1n, 1n, -1n)]) {
      try { fn(); throw new Error("did not throw"); } catch (e) { expect((e as LiquityAgentKitError).code).toBe("INVALID_INPUT"); }
    }
  });
});
