/** Minimal read-only ABI surface. Signatures are taken from the verified Liquity V2 TroveManager ABI. */
export const troveManagerReadAbi = [
  { type: "function", name: "getLatestTroveData", stateMutability: "view", inputs: [{ name: "_troveId", type: "uint256" }], outputs: [{ name: "trove", type: "tuple", components: [
    { name: "entireDebt", type: "uint256" }, { name: "entireColl", type: "uint256" },
    { name: "redistBoldDebtGain", type: "uint256" }, { name: "redistCollGain", type: "uint256" },
    { name: "accruedInterest", type: "uint256" }, { name: "recordedDebt", type: "uint256" },
    { name: "annualInterestRate", type: "uint256" }, { name: "weightedRecordedDebt", type: "uint256" },
    { name: "accruedBatchManagementFee", type: "uint256" }, { name: "lastInterestRateAdjTime", type: "uint256" }
  ] }] },
  { type: "function", name: "lastZombieTroveId", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getTroveStatus", stateMutability: "view", inputs: [{ name: "_troveId", type: "uint256" }], outputs: [{ type: "uint8" }] },
  { type: "function", name: "getTroveAnnualInterestRate", stateMutability: "view", inputs: [{ name: "_troveId", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "Troves", stateMutability: "view", inputs: [{ name: "", type: "uint256" }], outputs: [
    { name: "debt", type: "uint256" }, { name: "coll", type: "uint256" }, { name: "stake", type: "uint256" },
    { name: "status", type: "uint8" }, { name: "arrayIndex", type: "uint64" }, { name: "lastDebtUpdateTime", type: "uint64" },
    { name: "lastInterestRateAdjTime", type: "uint64" }, { name: "annualInterestRate", type: "uint256" },
    { name: "interestBatchManager", type: "address" }, { name: "batchDebtShares", type: "uint256" }
  ] }
] as const;
