/**
 * Live smoke test against a real Ethereum mainnet RPC. Not run in CI. Usage:
 *   ETH_RPC_URL=https://... npm run smoke
 * Confirms every address in the registry has contract code and that each branch's readers return sane values.
 */
import { getAddress } from "viem";
import { BRANCH_IDS, createLiquityClient, getBoldTokenInfo, getBranchParameters, getBranchPrice, getSortedTrovesPage, getStabilityPoolState, getTroveRedemptionPosition, LIQUITY_V2_MAINNET } from "../src/index.js";

const rpcUrl = process.env.ETH_RPC_URL;
if (!rpcUrl) { console.error("Set ETH_RPC_URL."); process.exit(2); }
const client = createLiquityClient({ rpcUrl });
let failures = 0;
const check = (ok: boolean, label: string, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`); if (!ok) failures++; };

const addresses = [
  ...Object.entries(LIQUITY_V2_MAINNET.shared).map(([k, v]) => [`shared.${k}`, v.address] as const),
  ...BRANCH_IDS.flatMap((b) => Object.entries(LIQUITY_V2_MAINNET.branches[b].contracts).map(([k, a]) => [`${b}.${k}`, a] as const))
];
for (const [label, address] of addresses) {
  const code = await client.getCode({ address: getAddress(address) });
  check(!!code && code !== "0x", `contract code at ${label}`, address);
}
const bold = await getBoldTokenInfo(client);
check(bold.data.symbol === "BOLD" && bold.data.decimals === 18, "BOLD token metadata", `supply=${bold.data.totalSupply}`);
for (const branch of BRANCH_IDS) {
  const p = await getBranchParameters(client, branch, { blockNumber: bold.provenance.blockNumber });
  check(p.data.mcr > 10n ** 18n && p.data.ccr > p.data.mcr, `${branch} parameters`, `MCR=${p.data.mcr} CCR=${p.data.ccr} shutdown=${p.data.isShutdown}`);
  const price = await getBranchPrice(client, branch, { blockNumber: bold.provenance.blockNumber });
  check(price.data.price > 0n, `${branch} oracle price`, `price=${price.data.price} source=${price.data.priceSource}`);
  const sp = await getStabilityPoolState(client, branch, { blockNumber: bold.provenance.blockNumber });
  check(sp.data.totalBoldDeposits >= 0n, `${branch} Stability Pool`, `deposits=${sp.data.totalBoldDeposits}`);

  // Sorted-list ordering: descending by rate from the head, so redemption (tail first) hits the lowest rate.
  const at = { blockNumber: bold.provenance.blockNumber };
  const head = await getSortedTrovesPage(client, branch, 0n, 20n, at);
  const tail = await getSortedTrovesPage(client, branch, -1n, 20n, at);
  if (head.data.troves.length > 1) {
    const nonIncreasing = head.data.troves.every((t, i, a) => i === 0 || a[i - 1]!.annualInterestRate >= t.annualInterestRate);
    const nonDecreasing = tail.data.troves.every((t, i, a) => i === 0 || a[i - 1]!.annualInterestRate <= t.annualInterestRate);
    check(nonIncreasing, `${branch} list head is non-increasing in rate`, `first=${head.data.troves[0]!.annualInterestRate}`);
    check(nonDecreasing, `${branch} list tail walk is non-decreasing in rate`, `first=${tail.data.troves[0]!.annualInterestRate}`);
    const tailTrove = tail.data.troves[0]!;
    const pos = await getTroveRedemptionPosition(client, branch, tailTrove.id, { ...at, maxTroves: 5 });
    check(pos.data.rank === 1n && pos.data.debtAhead === 0n, `${branch} tail Trove is first in the redemption queue`, `id=${tailTrove.id}`);
  } else {
    console.log(`SKIP  ${branch} ordering checks (fewer than 2 Troves in list)`);
  }
}
console.log(failures === 0 ? "\nAll live checks passed." : `\n${failures} live check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
