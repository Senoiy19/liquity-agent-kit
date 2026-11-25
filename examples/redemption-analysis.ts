/** Redemption queue position (lowest rate redeemed first) and rate distribution for one branch.
 *   ETHEREUM_RPC_URL=... TROVE_ID=<decimal> npx tsx examples/redemption-analysis.ts
 */
import { formatUnits } from "viem";
import { createLiquityClient, getTroveRedemptionPosition, analyzeBranchInterestRates } from "../src/index.js";

const rpcUrl = process.env.ETHEREUM_RPC_URL;
const troveId = process.env.TROVE_ID;
if (!rpcUrl || !troveId) throw new Error("Set ETHEREUM_RPC_URL and TROVE_ID in your environment.");

const client = createLiquityClient({ rpcUrl });
const branch = "WETH" as const;

const [position, rates] = await Promise.all([
  getTroveRedemptionPosition(client, branch, BigInt(troveId)),
  analyzeBranchInterestRates(client, branch)
]);

console.log("Redemption position:", {
  ...position.data,
  debtAheadBOLD: formatUnits(position.data.debtAhead, 18),
  warnings: position.warnings
});
console.log("Branch rate analysis:", {
  ...rates.data,
  meanPercent: rates.data.meanRate === null ? null : formatUnits(rates.data.meanRate, 16),
  debtWeightedMeanPercent: rates.data.debtWeightedMeanRate === null ? null : formatUnits(rates.data.debtWeightedMeanRate, 16),
  warnings: rates.warnings
});
