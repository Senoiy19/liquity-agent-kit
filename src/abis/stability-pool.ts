/** Read-only Stability Pool ABI. Signatures: contracts/src/Interfaces/IStabilityPool.sol at liquity/bold d262669e. */
const u = (name: string, inputs: { name: string; type: "address" }[] = []) =>
  ({ type: "function", name, stateMutability: "view", inputs, outputs: [{ type: "uint256" }] }) as const;
const depositor = [{ name: "_depositor", type: "address" }] as { name: string; type: "address" }[];
export const stabilityPoolReadAbi = [
  u("getTotalBoldDeposits"), u("getCollBalance"), u("getYieldGainsOwed"), u("getYieldGainsPending"),
  u("deposits", depositor), u("stashedColl", depositor), u("getDepositorCollGain", depositor),
  u("getDepositorYieldGain", depositor), u("getDepositorYieldGainWithPending", depositor), u("getCompoundedBoldDeposit", depositor)
] as const;
