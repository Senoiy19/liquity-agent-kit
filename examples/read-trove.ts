/**
 * Read one Trove and its health at a single block.
 *   ETH_RPC_URL=https://... TROVE_BRANCH=WETH TROVE_ID=<decimal> npx tsx examples/read-trove.ts
 * Trove IDs are 256-bit hashes (keccak256(abi.encode(sender, owner, ownerIndex))), so pass them as decimal strings.
 * Find real IDs with getWalletTroves, or from the Liquity app / a block explorer.
 */
import { createLiquityClient, executeTool } from "../src/index.js";

const rpcUrl = process.env.ETH_RPC_URL;
const troveId = process.env.TROVE_ID;
const branch = process.env.TROVE_BRANCH;
if (!rpcUrl || !troveId || !branch) throw new Error("Set ETH_RPC_URL, TROVE_BRANCH (WETH|wstETH|rETH) and TROVE_ID.");

const client = createLiquityClient({ rpcUrl });
const outcome = await executeTool("liquity_get_trove_health", { branch, troveId }, { client });
console.log(JSON.stringify(outcome, null, 2));
process.exit(outcome.ok ? 0 : 1);
