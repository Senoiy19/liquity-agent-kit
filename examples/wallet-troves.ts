/**
 * List a wallet's open Troves on one branch.
 *   ETH_RPC_URL=... WALLET=0x... FROM_BLOCK=<block at/before branch deployment> TROVE_BRANCH=WETH npx tsx examples/wallet-troves.ts
 * TroveNFT is not enumerable, so this scans Transfer logs. Check `complete` in the output; if false, lower FROM_BLOCK.
 * Many providers cap eth_getLogs ranges: lower MAX_BLOCK_RANGE if you see range errors.
 */
import { createLiquityClient, executeTool } from "../src/index.js";

const { ETH_RPC_URL, WALLET, FROM_BLOCK, TROVE_BRANCH = "WETH", MAX_BLOCK_RANGE } = process.env;
if (!ETH_RPC_URL || !WALLET || !FROM_BLOCK) throw new Error("Set ETH_RPC_URL, WALLET and FROM_BLOCK.");
const client = createLiquityClient({ rpcUrl: ETH_RPC_URL });
const outcome = await executeTool("liquity_get_wallet_troves", {
  branch: TROVE_BRANCH, owner: WALLET, fromBlock: FROM_BLOCK, ...(MAX_BLOCK_RANGE ? { maxBlockRange: MAX_BLOCK_RANGE } : {})
}, { client });
console.log(JSON.stringify(outcome, null, 2));
