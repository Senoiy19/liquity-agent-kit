import type { BranchDeployment, LiquityDeployment } from "../core/types.js";
import { parseBranchId } from "../core/branches.js";

/**
 * Ethereum mainnet deployment manifest transcribed from Liquity's V2 Technical Docs & Audits
 * page and cross-checked address-by-address against `frontend/app/.env` of liquity/bold at
 * the pinned commit below (all 32 addresses matched on 2026-11-24). Addresses are checksummed
 * by viem at runtime. Cross-checking against a repository manifest is not an on-chain
 * verification: run `npm run smoke` with an RPC URL to confirm the contracts live on-chain.
 */
export const LIQUITY_V2_MAINNET: LiquityDeployment = {
  chainId: 1,
  protocolVersion: "v2",
  deploymentLabel: "Liquity V2 Ethereum mainnet (official docs manifest)",
  sourceObservedAt: "2026-11-24",
  sourceCommit: "d262669ef3c4d37bf0544df3bb2624c07b8a5ee0",
  sourceCommitNote: "HEAD of liquity/bold main on 2026-11-24 (merge of PR #1206, committed 2026-09-26). Main may be ahead of what is deployed; the address manifest, not contract source, is what was matched.",
  shared: {
    collateralRegistry: { address: "0xf949982b91c8c61e952b3ba942cbbfaef5386684", sourceUrl: "https://docs.liquity.org/v2-documentation/technical-docs-and-audits", verification: "official-repository-env" },
    boldToken: { address: "0x6440f144b7e50d6a8439336510312d2f54beb01d", sourceUrl: "https://docs.liquity.org/v2-documentation/technical-docs-and-audits", verification: "official-repository-env" },
    hintHelpers: { address: "0xf0cae19c96e572234398d6665cc1147a16cbe657", sourceUrl: "https://docs.liquity.org/v2-documentation/technical-docs-and-audits", verification: "official-repository-env" },
    multiTroveGetter: { address: "0xfa61db085510c64b83056db3a7acf3b6f631d235", sourceUrl: "https://docs.liquity.org/v2-documentation/technical-docs-and-audits", verification: "official-repository-env" },
    exchangeHelpers: { address: "0x2f60bab0072abec7058017f48d7256ec288c8686", sourceUrl: "https://docs.liquity.org/v2-documentation/technical-docs-and-audits", verification: "official-repository-env" }
  },
  branches: {
    WETH: {
      id: "WETH", collateralSymbol: "WETH", collateralToken: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
      contracts: { addressesRegistry: "0x20f7c9ad66983f6523a0881d0f82406541417526", troveManager: "0x7bcb64b2c9206a5b699ed43363f6f98d4776cf5a", troveNFT: "0x1a0fc0b843afd9140267d25d4e575cb37a838013", borrowerOperations: "0x372abd1810eaf23cb9d941bbe7596dfb2c46bc65", stabilityPool: "0x5721cbbd64fc7ae3ef44a0a3f9a790a9264cf9bf", sortedTroves: "0xa25269e41bd072513849f2e64ad221e84f3063f4", priceFeed: "0xcc5f8102eb670c89a4a3c567c13851260303c24f", activePool: "0xeb5a8c825582965f1d84606e078620a84ab16afe" }
    },
    wstETH: {
      id: "wstETH", collateralSymbol: "wstETH", collateralToken: "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0",
      contracts: { addressesRegistry: "0x8d733f7ea7c23cbea7c613b6ebd845d46d3aac54", troveManager: "0xa2895d6a3bf110561dfe4b71ca539d84e1928b22", troveNFT: "0x857aecebf75f1012dc18e15020c97096aea31b04", borrowerOperations: "0xa741a32f9dcfe6adba088fd0f97e90742d7d5da3", stabilityPool: "0x9502b7c397e9aa22fe9db7ef7daf21cd2aebe56b", sortedTroves: "0x84eb85a8c25049255614f0536bea8f31682e86f1", priceFeed: "0xe7aa2ba9e086a379d3beb224098bc634a46e314e", activePool: "0x531a8f99c70d6a56a7cee02d6b4281650d7919a0" }
    },
    rETH: {
      id: "rETH", collateralSymbol: "rETH", collateralToken: "0xae78736cd615f374d3085123a210448e74fc6393",
      contracts: { addressesRegistry: "0x6106046f031a22713697e04c08b330ddaf3e8789", troveManager: "0xb2b2abeb5c357a234363ff5d180912d319e3e19e", troveNFT: "0x7ae430e25b67f19b431e1d1dc048a5bcf24c0873", borrowerOperations: "0xe8119fc02953b27a1b48d2573855738485a17329", stabilityPool: "0xd442e41019b7f5c4dd78f50dc03726c446148695", sortedTroves: "0x14d8d8011df2b396ed2bbc4959bb73250324f386", priceFeed: "0x34f1e9c7dcc279ec70d3c4488eb2d80fba8b7b2b", activePool: "0x9074d72cc82dad1e13e454755aa8f144c479532f" }
    }
  }
};

export function getBranchDeployment(branch: unknown): BranchDeployment {
  return LIQUITY_V2_MAINNET.branches[parseBranchId(branch)];
}
