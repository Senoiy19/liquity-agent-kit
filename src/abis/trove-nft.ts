/** ERC-721 subset of TroveNFT. TroveNFT is not enumerable; wallet discovery uses Transfer logs. */
export const troveNftReadAbi = [
  { type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] }
] as const;

export const erc721TransferEvent = {
  type: "event", name: "Transfer",
  inputs: [
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "tokenId", type: "uint256", indexed: true }
  ]
} as const;
