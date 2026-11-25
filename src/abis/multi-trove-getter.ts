/** Read-only ABI for the pinned Liquity V2 MultiTroveGetter deployment.
 * getMultipleSortedTroves output follows the CombinedTroveData tuple published in the verified ABI.
 */
const combinedTroveData = [
  { name: "id", type: "uint256" },
  { name: "entireDebt", type: "uint256" },
  { name: "entireColl", type: "uint256" },
  { name: "redistBoldDebtGain", type: "uint256" },
  { name: "redistCollGain", type: "uint256" },
  { name: "accruedInterest", type: "uint256" },
  { name: "recordedDebt", type: "uint256" },
  { name: "annualInterestRate", type: "uint256" },
  { name: "accruedBatchManagementFee", type: "uint256" },
  { name: "lastInterestRateAdjTime", type: "uint256" },
  { name: "stake", type: "uint256" },
  { name: "lastDebtUpdateTime", type: "uint256" },
  { name: "interestBatchManager", type: "address" },
  { name: "batchDebtShares", type: "uint256" },
  { name: "snapshotETH", type: "uint256" },
  { name: "snapshotBoldDebt", type: "uint256" }
] as const;

export const multiTroveGetterAbi = [
  { type: "function", name: "getMultipleSortedTroves", stateMutability: "view", inputs: [
    { name: "_collIndex", type: "uint256" },
    { name: "_startIdx", type: "int256" },
    { name: "_count", type: "uint256" }
  ], outputs: [{ name: "_troves", type: "tuple[]", components: combinedTroveData }] }
] as const;

export const collateralRegistryReadAbi = [
  { type: "function", name: "totalCollaterals", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getToken", stateMutability: "view", inputs: [{ name: "_index", type: "uint256" }], outputs: [{ type: "address" }] }
] as const;
