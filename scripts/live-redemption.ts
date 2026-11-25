/**
 * Live check of getTroveRedemptionPosition on mid-list Troves, against real mainnet state. Read-only. Usage:
 *   ETH_RPC_URL=https://... npm run live:redemption
 *
 * For each branch it picks Troves at several depths from the redemption tail, prints the full result (including the
 * pending-zombie and below-100%-ICR fields), and cross-checks it against an independent walk of the sorted list:
 *   - rank        === Troves before the target + (pending zombie ? 1 : 0) + 1
 *   - debtAhead   === pendingZombieDebt + sum(debt of listed Troves before the target)
 *   - lower/same  split matches a recount by rate
 *   - belowParity === recount of Troves with ICR < 100% at the branch's oracle price
 *   - redeemableDebtAhead === debtAhead - belowParityDebtAhead
 * Everything is pinned to one block so the two computations see the same state.
 */
import { BRANCH_IDS, collateralRatio, createLiquityClient, getBranchPrice, getSortedTrovesPage, getTroveRedemptionPosition, WAD } from "../src/index.js";

const rpcUrl = process.env.ETH_RPC_URL;
if (!rpcUrl) { console.error("Set ETH_RPC_URL."); process.exit(2); }
const client = createLiquityClient({ rpcUrl });
let failures = 0;
const check = (ok: boolean, label: string, detail = "") => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`); if (!ok) failures++; };

const DEPTHS = [0n, 1n, 10n, 100n, 400n]; // offsets from the tail (0 = first to be redeemed)
const PAGE = 500n;

const latest = await client.getBlockNumber();
console.log(`Pinned block ${latest}\n`);
const at = { blockNumber: latest };

for (const branch of BRANCH_IDS) {
  console.log(`== ${branch} ==`);
  const price = (await getBranchPrice(client, branch, at)).data.price;

  // Independent walk: the first PAGE+ Troves from the tail, in redemption order.
  const walked: Awaited<ReturnType<typeof getSortedTrovesPage>>["data"]["troves"] = [];
  for (let start = 0n; start < 1000n; ) {
    const page = await getSortedTrovesPage(client, branch, -(start + 1n), PAGE, at);
    walked.push(...page.data.troves);
    if (page.data.troves.length < Number(PAGE)) break;
    start += BigInt(page.data.troves.length);
  }
  console.log(`  walked ${walked.length} Troves from the tail; oracle price ${price}`);

  for (const depth of DEPTHS) {
    if (depth >= BigInt(walked.length)) { console.log(`  SKIP  depth ${depth}: list has only ${walked.length} walked Troves`); continue; }
    const target = walked[Number(depth)]!;
    const res = await getTroveRedemptionPosition(client, branch, target.id, { ...at, maxTroves: 1000 });
    const d = res.data;
    console.log(`  depth ${depth}: Trove ${String(target.id).slice(0, 10)}…  rank=${d.rank} ahead=${d.trovesAhead} debtAhead=${d.debtAhead} redeemable=${d.redeemableDebtAhead} belowParity=${d.belowParityDebtAhead} zombie=${d.pendingZombieTroveId ?? "none"}`);

    const before = walked.slice(0, Number(depth));
    const zombieCount = d.pendingZombieTroveId === null ? 0n : 1n;
    const listDebt = before.reduce((s, t) => s + t.debt, 0n);
    const lower = before.filter((t) => t.annualInterestRate < target.annualInterestRate).reduce((s, t) => s + t.debt, 0n);
    const same = before.filter((t) => t.annualInterestRate === target.annualInterestRate).reduce((s, t) => s + t.debt, 0n);
    const below = before.filter((t) => { const icr = collateralRatio(t.collateral, price, t.debt); return icr !== null && icr < WAD; }).reduce((s, t) => s + t.debt, 0n);

    check(d.positionFound && d.positionComplete, "target found, position complete");
    check(d.rank === depth + zombieCount + 1n, "rank = list position + pending zombie + 1", `${d.rank} vs ${depth + zombieCount + 1n}`);
    check(d.trovesAhead === depth + zombieCount, "trovesAhead matches", `${d.trovesAhead}`);
    check(d.debtAhead === d.pendingZombieDebt + listDebt, "debtAhead = zombie debt + listed debt before target");
    check(d.lowerRateDebtAhead === lower && d.sameRateDebtAhead === same, "lower/same-rate split matches recount");
    check(d.lowerRateDebtAhead + d.sameRateDebtAhead === listDebt, "every listed Trove ahead is lower- or same-rate (none higher)");
    check(d.belowParityDebtAhead >= below, "belowParityDebtAhead >= recount of listed below-100% Troves", `${d.belowParityDebtAhead} vs listed ${below}`);
    check(d.redeemableDebtAhead === d.debtAhead - d.belowParityDebtAhead, "redeemableDebtAhead = debtAhead - belowParityDebtAhead");
    check(d.targetStatus === "active", "targetStatus is active");
  }
  // A non-listed ID must report why it is absent rather than a bare "not found".
  const missing = await getTroveRedemptionPosition(client, branch, 1n, { ...at, maxTroves: 1000 });
  if (!missing.data.scanComplete) console.log("  SKIP  unknown-ID check: branch has more than 1000 listed Troves, so the scan did not complete");
  else check(!missing.data.positionFound && missing.data.targetStatus !== null && missing.data.rank === null, "unknown Trove ID reports a status and no rank", `status=${missing.data.targetStatus}`);
  console.log();
}

if (failures) { console.error(`${failures} check(s) failed.`); process.exit(1); }
console.log("All live redemption-position checks passed.");
