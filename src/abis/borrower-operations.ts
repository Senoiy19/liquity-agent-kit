/** Read-only branch-parameter ABI verified against the current WETH BorrowerOperations deployment. */
export const borrowerOperationsReadAbi = [
  { type: "function", name: "MCR", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "CCR", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "SCR", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "BCR", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getEntireBranchDebt", stateMutability: "view", inputs: [], outputs: [{ name: "entireSystemDebt", type: "uint256" }] },
  { type: "function", name: "getEntireBranchColl", stateMutability: "view", inputs: [], outputs: [{ name: "entireSystemColl", type: "uint256" }] },
  { type: "function", name: "hasBeenShutDown", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] }
] as const;
