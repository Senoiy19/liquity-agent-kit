/**
 * PriceFeed ABI. `fetchPrice` is NOT a view function upstream (it can switch the branch to its
 * last-good-price mode and shut the branch down), so it must only ever be used through `eth_call`
 * simulation, never sent as a transaction. Signatures: contracts/src/Interfaces/IPriceFeed.sol and
 * IMainnetPriceFeed.sol at liquity/bold d262669e.
 */
export const priceFeedAbi = [
  { type: "function", name: "fetchPrice", stateMutability: "nonpayable", inputs: [], outputs: [{ name: "", type: "uint256" }, { name: "", type: "bool" }] },
  { type: "function", name: "lastGoodPrice", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "priceSource", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] }
] as const;
