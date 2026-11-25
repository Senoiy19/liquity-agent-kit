/** Discover and hydrate all wallet Troves up to the requested cap.
 *   ETH_RPC_URL=... WALLET=0x... FROM_BLOCK=<branch deployment block> TROVE_BRANCH=WETH npx tsx examples/wallet-details.ts
 */
import { createLiquityClient, executeTool } from "../src/index.js";

const { ETH_RPC_URL, WALLET, FROM_BLOCK, TROVE_BRANCH = "WETH", MAX_TROVES = "25" } = process.env;
if (!ETH_RPC_URL || !WALLET || !FROM_BLOCK) throw new Error("Set ETH_RPC_URL, WALLET and FROM_BLOCK.");
const client = createLiquityClient({ rpcUrl: ETH_RPC_URL });
const outcome = await executeTool("liquity_get_wallet_trove_details", {
  branch: TROVE_BRANCH, owner: WALLET, fromBlock: FROM_BLOCK, maxTroves: MAX_TROVES
}, { client });
console.log(JSON.stringify(outcome, null, 2));
process.exit(outcome.ok ? 0 : 1);
