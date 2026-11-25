/** Read a bounded page from the protocol's sorted Trove list.
 *   ETH_RPC_URL=https://... TROVE_BRANCH=WETH npx tsx examples/sorted-troves.ts
 */
import { createLiquityClient, executeTool } from "../src/index.js";

const rpcUrl = process.env.ETH_RPC_URL;
const branch = process.env.TROVE_BRANCH ?? "WETH";
if (!rpcUrl) throw new Error("Set ETH_RPC_URL.");
const client = createLiquityClient({ rpcUrl });
const outcome = await executeTool("liquity_get_sorted_troves_page", { branch, startIndex: "0", count: "50" }, { client });
console.log(JSON.stringify(outcome, null, 2));
process.exit(outcome.ok ? 0 : 1);
