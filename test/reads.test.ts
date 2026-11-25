import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { getBoldTokenInfo, getBranchParameters, getBranchPrice, getStabilityPoolDeposit, getStabilityPoolState, getTrove, getTroveHealth, getWalletTroves, getSortedTrovesPage, getWalletTroveDetails, getTroveRedemptionPosition, analyzeBranchInterestRates } from "../src/evm/reads.js";
import { LiquityAgentKitError } from "../src/core/errors.js";
import { LIQUITY_V2_MAINNET } from "../src/evm/deployments.js";
import { addTrove, BATCH_MANAGER, E18, erc721TransferEvent, makeWorld, OTHER, OWNER, TROVE_ID, sortedRow } from "./helpers/world.js";

const nft = LIQUITY_V2_MAINNET.branches.WETH.contracts.troveNFT;
const codeOf = async (p: Promise<unknown>) => { try { await p; return "no error"; } catch (e) { return e instanceof LiquityAgentKitError ? e.code : `other:${String(e)}`; } };

describe("getTrove", () => {
  it("reads a hash-style Trove ID with correct fields, provenance and one pinned block", async () => {
    const w = makeWorld(); addTrove(w, TROVE_ID);
    const r = await getTrove(w.chain.client(), "WETH", TROVE_ID);
    expect(r.data).toMatchObject({ id: TROVE_ID, branch: "WETH", owner: OWNER, status: "active", collateral: 2n * E18, debt: 1000n * E18, recordedDebt: 990n * E18, accruedInterest: 10n * E18 });
    expect(r.provenance).toMatchObject({ chainId: 1, blockNumber: w.chain.head, source: "ethereum-rpc" });
    expect(r.provenance.blockHash).toBe(w.chain.blockHash(w.chain.head));
    expect(r.provenance.blockTimestamp).toBe(new Date(Number(w.chain.timestamp) * 1000).toISOString());
    expect(r.provenance.contractAddresses).toContain(getAddress(nft));
    const calls = w.chain.calls.filter((c) => c.method === "eth_call");
    expect(calls.length).toBeGreaterThanOrEqual(4);
    expect(new Set(calls.map((c) => c.blockTag)).size).toBe(1);
    expect(r.warnings).toEqual([]);
  });
  it("takes the interest rate from getLatestTroveData, not the stale Troves() record", async () => {
    const w = makeWorld(); addTrove(w, TROVE_ID, { rate: 7n * E18 / 100n });
    expect((await getTrove(w.chain.client(), "WETH", TROVE_ID)).data.annualInterestRate).toBe(7n * E18 / 100n);
  });
  it("warns for batch members and zombies", async () => {
    const w = makeWorld(); addTrove(w, TROVE_ID, { batch: BATCH_MANAGER, batchShares: 123n, status: 4 });
    const r = await getTrove(w.chain.client(), "WETH", TROVE_ID);
    expect(r.data.interestBatchManager).toBe(BATCH_MANAGER);
    expect(r.data.batchDebtShares).toBe(123n);
    expect(r.warnings.join(" ")).toMatch(/Zombie/);
    expect(r.warnings.join(" ")).toMatch(/interest batch/);
  });
  it("rejects closed and unknown Troves with TROVE_NOT_FOUND", async () => {
    const w = makeWorld(); addTrove(w, 5n, { status: 2 });
    expect(await codeOf(getTrove(w.chain.client(), "WETH", 5n))).toBe("TROVE_NOT_FOUND");
    expect(await codeOf(getTrove(w.chain.client(), "WETH", 6n))).toBe("TROVE_NOT_FOUND");
  });
  it("rejects prototype-member and unknown branch names", async () => {
    const w = makeWorld();
    for (const bad of ["constructor", "toString", "__proto__", "weth", "", 5]) expect(await codeOf(getTrove(w.chain.client(), bad as never, 1n))).toBe("UNKNOWN_BRANCH");
  });
  it("rejects negative IDs and out-of-range pinned blocks", async () => {
    const w = makeWorld(); addTrove(w, 1n);
    expect(await codeOf(getTrove(w.chain.client(), "WETH", -1n))).toBe("INVALID_INPUT");
    expect(await codeOf(getTrove(w.chain.client(), "WETH", 1n, { blockNumber: w.chain.head + 1n }))).toBe("INVALID_INPUT");
  });
  it("honours an explicitly pinned block", async () => {
    const w = makeWorld(); addTrove(w, 1n);
    const r = await getTrove(w.chain.client(), "WETH", 1n, { blockNumber: w.chain.head - 10n });
    expect(r.provenance.blockNumber).toBe(w.chain.head - 10n);
    expect(new Set(w.chain.calls.filter((c) => c.method === "eth_call").map((c) => BigInt(c.blockTag!)))).toEqual(new Set([w.chain.head - 10n]));
  });
  it("refuses a non-mainnet RPC", async () => {
    const w = makeWorld(); w.chain.chainId = 11155111; addTrove(w, 1n);
    expect(await codeOf(getTrove(w.chain.client(), "WETH", 1n))).toBe("UNSUPPORTED_CHAIN");
  });
});

describe("branch, token, price and pool readers", () => {
  it("reads BOLD token info", async () => {
    const r = await getBoldTokenInfo(makeWorld().chain.client());
    expect(r.data).toMatchObject({ symbol: "BOLD", decimals: 18, totalSupply: 75_000_000n * E18 });
  });
  it("reads branch parameters and warns on shutdown", async () => {
    const w = makeWorld();
    const ok = await getBranchParameters(w.chain.client(), "WETH");
    expect(ok.data).toMatchObject({ mcr: 11n * E18 / 10n, ccr: 15n * E18 / 10n, scr: 11n * E18 / 10n, bcr: E18 / 10n, isShutdown: false });
    expect(ok.warnings).toEqual([]);
    w.shutdown = true;
    expect((await getBranchParameters(w.chain.client(), "WETH")).warnings[0]).toMatch(/shut down/);
  });
  it("reads the oracle price via simulation and flags fallback modes", async () => {
    const w = makeWorld();
    const ok = await getBranchPrice(w.chain.client(), "WETH");
    expect(ok.data).toMatchObject({ price: 2000n * E18, lastGoodPrice: 1990n * E18, priceSource: "primary", oracleFailureDetected: false });
    expect(ok.warnings).toEqual([]);
    w.priceSource = 2; w.oracleFailure = true;
    const bad = await getBranchPrice(w.chain.client(), "WETH");
    expect(bad.data.priceSource).toBe("lastGoodPrice");
    expect(bad.warnings.join(" ")).toMatch(/oracle failure/);
    expect(bad.warnings.join(" ")).toMatch(/not using its primary/);
  });
  it("reads Stability Pool state and a depositor's position", async () => {
    const w = makeWorld();
    expect((await getStabilityPoolState(w.chain.client(), "WETH")).data).toMatchObject({ totalBoldDeposits: 20_000_000n * E18, collBalance: 5n * E18, yieldGainsOwed: 100n * E18, yieldGainsPending: 7n * E18 });
    w.spDeposits.set(OWNER.toLowerCase(), { initial: 1000n * E18, compounded: 900n * E18, collGain: E18 / 2n, yieldGain: 3n * E18, yieldPending: E18, stashed: 0n });
    const r = await getStabilityPoolDeposit(w.chain.client(), "WETH", OWNER);
    expect(r.data).toMatchObject({ compoundedBoldDeposit: 900n * E18, initialDeposit: 1000n * E18, collGain: E18 / 2n, yieldGain: 3n * E18, yieldGainWithPending: 4n * E18 });
    expect(r.warnings).toEqual([]);
    expect((await getStabilityPoolDeposit(w.chain.client(), "WETH", OTHER)).warnings[0]).toMatch(/no deposit/);
    expect(await codeOf(getStabilityPoolDeposit(w.chain.client(), "WETH", "0x123" as never))).toBe("INVALID_INPUT");
  });
});

describe("getWalletTroveDetails", () => {
  it("hydrates discovered Troves at the same pinned block and returns batch-aware fields", async () => {
    const w = makeWorld();
    addTrove(w, 77n, { owner: OWNER, batch: BATCH_MANAGER, batchShares: 44n });
    w.chain.addTransfer(nft, [erc721TransferEvent] as never, "0x0000000000000000000000000000000000000000", OWNER, 77n, 23_999_999n);
    w.nftBalance.set(OWNER.toLowerCase(), 1n);
    const r = await getWalletTroveDetails(w.chain.client(), "WETH", OWNER, { fromBlock: 23_999_990n, maxBlockRange: 20n });
    expect(r.data.discoveryComplete).toBe(true);
    expect(r.data.detailsComplete).toBe(true);
    expect(r.data.troves[0]).toMatchObject({ id: 77n, owner: OWNER, interestBatchManager: BATCH_MANAGER, batchDebtShares: 44n });
    expect(new Set(w.chain.calls.filter((c) => c.method === "eth_call").map((c) => c.blockTag)).size).toBe(1);
  });
  it("validates maxTroves", async () => {
    const w = makeWorld();
    for (const bad of [0, 101, 1.5, Number.NaN]) expect(await codeOf(getWalletTroveDetails(w.chain.client(), "WETH", OWNER, { fromBlock: 23_999_990n, maxTroves: bad }))).toBe("INVALID_INPUT");
  });
  it("marks detail output incomplete when capped", async () => {
    const w = makeWorld();
    for (const id of [71n, 72n]) {
      addTrove(w, id);
      w.chain.addTransfer(nft, [erc721TransferEvent] as never, "0x0000000000000000000000000000000000000000", OWNER, id, 23_999_999n);
    }
    w.nftBalance.set(OWNER.toLowerCase(), 2n);
    const r = await getWalletTroveDetails(w.chain.client(), "WETH", OWNER, { fromBlock: 23_999_990n, maxBlockRange: 20n, maxTroves: 1 });
    expect(r.data.discoveryComplete).toBe(true);
    expect(r.data.detailsComplete).toBe(false);
    expect(r.data.troves).toHaveLength(1);
    expect(r.warnings.join(" ")).toMatch(/Hydrated 1 of 2/);
  });
});

describe("getTroveHealth", () => {
  it("derives ratio and liquidation price from same-block inputs", async () => {
    const w = makeWorld(); addTrove(w, TROVE_ID); // 2 ETH, 1000 BOLD debt, price 2000, MCR 110%
    const r = await getTroveHealth(w.chain.client(), "WETH", TROVE_ID);
    expect(r.data.collateralRatio).toBe(4n * E18);            // 2*2000/1000 = 400%
    expect(r.data.liquidationPrice).toBe(550n * E18);          // 1000*1.1/2
    expect(r.data.isBelowMcr).toBe(false);
    expect(new Set(w.chain.calls.filter((c) => c.method === "eth_call").map((c) => c.blockTag)).size).toBe(1);
    expect(r.warnings.join(" ")).toMatch(/does not by itself show/);
  });
  it("flags a position below MCR and surfaces fallback-oracle warnings", async () => {
    const w = makeWorld(); addTrove(w, TROVE_ID); w.price = 500n * E18; w.priceSource = 2;
    const r = await getTroveHealth(w.chain.client(), "WETH", TROVE_ID);
    expect(r.data.collateralRatio).toBe(1n * E18);
    expect(r.data.isBelowMcr).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/primary oracle/);
  });
});

describe("getSortedTrovesPage", () => {
  it("resolves the collateral index on-chain and returns a block-pinned page with batch metadata", async () => {
    const w = makeWorld();
    const r = await getSortedTrovesPage(w.chain.client(), "WETH", 0n, 1n);
    expect(r.data).toMatchObject({ branch: "WETH", collateralIndex: 0n, startIndex: 0n, countRequested: 1n, hasMore: true, nextStartIndex: 1n });
    expect(r.data.troves[0]).toMatchObject({ id: 101n, debt: 1000n * E18, collateral: 2n * E18, annualInterestRate: 3n * E18 / 100n });
    expect(r.provenance.contractAddresses).toContain(getAddress(LIQUITY_V2_MAINNET.shared.multiTroveGetter.address));
    expect(new Set(w.chain.calls.filter((c) => c.method === "eth_call").map((c) => c.blockTag)).size).toBe(1);
  });
  it("warns when the returned page contains a batch member", async () => {
    const w = makeWorld();
    const r = await getSortedTrovesPage(w.chain.client(), "WETH", 1n, 2n);
    expect(r.data.troves[0]?.interestBatchManager).toBe(BATCH_MANAGER);
    expect(r.warnings.join(" ")).toMatch(/interest batches/);
    expect(r.data.nextStartIndex).toBeNull();
  });
  it("does not invent a cursor for tail-relative (negative) start indexes", async () => {
    const w = makeWorld();
    const r = await getSortedTrovesPage(w.chain.client(), "WETH", -1n, 1n);
    expect(r.data.hasMore).toBe(true);
    expect(r.data.nextStartIndex).toBeNull();
    expect(r.warnings.join(" ")).toMatch(/negative start index/);
  });
  it("fails clearly if the branch collateral is missing from the on-chain registry", async () => {
    const w = makeWorld();
    const reg = w.chain.contracts.get(LIQUITY_V2_MAINNET.shared.collateralRegistry.address.toLowerCase())!;
    const original = reg.call;
    reg.call = (fn, args) => fn === "totalCollaterals" ? 0n : original(fn, args);
    expect(await codeOf(getSortedTrovesPage(w.chain.client(), "WETH", 0n, 1n))).toBe("RPC_READ_FAILED");
  });
  it("rejects invalid page bounds and int256 overflow", async () => {
    const w = makeWorld();
    expect(await codeOf(getSortedTrovesPage(w.chain.client(), "WETH", 0n, 0n))).toBe("INVALID_INPUT");
    expect(await codeOf(getSortedTrovesPage(w.chain.client(), "WETH", 0n, 501n))).toBe("INVALID_INPUT");
    expect(await codeOf(getSortedTrovesPage(w.chain.client(), "WETH", 2n ** 255n, 1n))).toBe("INVALID_INPUT");
  });
});

describe("redemption position and interest-rate analysis", () => {
  // Realistic on-chain order: DESCENDING by rate from the head. Redemption runs tail -> head.
  const descending = () => [
    sortedRow(900n, 900n * E18, 5n * E18 / 100n),   // head: highest rate, redeemed LAST
    sortedRow(202n, 2000n * E18, 4n * E18 / 100n),
    sortedRow(303n, 1500n * E18, 4n * E18 / 100n),  // same rate as 202 but nearer the tail => redeemed before 202
    sortedRow(101n, 1000n * E18, 3n * E18 / 100n)   // tail: lowest rate, redeemed FIRST
  ];
  it("sums only Troves redeemed before the target (tail-first), excluding higher-rate Troves", async () => {
    const w = makeWorld(); w.sortedTroves = descending();
    const r = await getTroveRedemptionPosition(w.chain.client(), "WETH", 202n);
    expect(r.data).toMatchObject({ positionFound: true, rank: 3n, targetDebt: 2000n * E18, trovesAhead: 2n,
      debtAhead: 2500n * E18, lowerRateDebtAhead: 1000n * E18, sameRateDebtAhead: 1500n * E18, positionComplete: true });
    expect(r.warnings.join(" ")).toMatch(/lowest rate first/);
    expect(new Set(w.chain.calls.filter((c) => c.method === "eth_call").map((c) => c.blockTag)).size).toBe(1);
  });
  it("ranks the lowest-rate (tail) Trove first with nothing ahead, and the highest-rate (head) Trove last with everything else ahead", async () => {
    const w = makeWorld(); w.sortedTroves = descending();
    const first = await getTroveRedemptionPosition(w.chain.client(), "WETH", 101n);
    expect(first.data).toMatchObject({ rank: 1n, trovesAhead: 0n, debtAhead: 0n });
    const last = await getTroveRedemptionPosition(w.chain.client(), "WETH", 900n);
    expect(last.data).toMatchObject({ rank: 4n, trovesAhead: 3n, debtAhead: 4500n * E18, lowerRateDebtAhead: 4500n * E18, sameRateDebtAhead: 0n });
  });
  it("pages across the 500-entry page boundary in redemption order", async () => {
    const w = makeWorld();
    w.sortedTroves = Array.from({ length: 1200 }, (_, i) => sortedRow(BigInt(i + 1), E18, BigInt(1200 - i) * 10n ** 12n)); // descending rate, ids 1..1200 head->tail
    const r = await getTroveRedemptionPosition(w.chain.client(), "WETH", 1n);       // head => redeemed last
    expect(r.data).toMatchObject({ positionFound: true, rank: 1200n, trovesAhead: 1199n, debtAhead: 1199n * E18 });
    const mid = await getTroveRedemptionPosition(w.chain.client(), "WETH", 701n);   // 500 Troves sit tailward of it
    expect(mid.data).toMatchObject({ rank: 500n, trovesAhead: 499n });
  });
  it("redeems a pending zombie Trove before any listed Trove, and counts it in debtAhead", async () => {
    const w = makeWorld(); w.sortedTroves = descending();
    addTrove(w, 555n, { status: 4, debt: 300n * E18, recorded: 300n * E18, coll: 2n * E18 }); w.lastZombieTroveId = 555n;
    const r = await getTroveRedemptionPosition(w.chain.client(), "WETH", 202n);
    expect(r.data).toMatchObject({ rank: 4n, trovesAhead: 3n, pendingZombieTroveId: 555n, pendingZombieDebt: 300n * E18,
      debtAhead: 2800n * E18, lowerRateDebtAhead: 1000n * E18, sameRateDebtAhead: 1500n * E18, redeemableDebtAhead: 2800n * E18 });
    expect(r.warnings.join(" ")).toMatch(/Pending zombie Trove 555/);
    const first = await getTroveRedemptionPosition(w.chain.client(), "WETH", 101n);
    expect(first.data).toMatchObject({ rank: 2n, debtAhead: 300n * E18 }); // the zombie goes first even for the lowest-rate listed Trove
  });
  it("ranks the pending zombie itself first even though it is not in the sorted list", async () => {
    const w = makeWorld(); w.sortedTroves = descending();
    addTrove(w, 555n, { status: 4, debt: 300n * E18, recorded: 300n * E18 }); w.lastZombieTroveId = 555n;
    const r = await getTroveRedemptionPosition(w.chain.client(), "WETH", 555n);
    expect(r.data).toMatchObject({ positionFound: true, rank: 1n, debtAhead: 0n, targetStatus: "zombie", positionComplete: true, targetDebt: 300n * E18 });
  });
  it("warns when the pending zombie target is below 100% ICR, because redemptions skip it", async () => {
    const w = makeWorld(); w.sortedTroves = descending();
    addTrove(w, 555n, { status: 4, debt: 3000n * E18, recorded: 3000n * E18, coll: E18 }); w.lastZombieTroveId = 555n; // 1 ETH * $2000 vs 3000 BOLD => ~67% ICR
    const r = await getTroveRedemptionPosition(w.chain.client(), "WETH", 555n);
    expect(r.data).toMatchObject({ positionFound: true, rank: 1n, targetStatus: "zombie" });
    expect(r.warnings.join(" ")).toMatch(/ICR below 100%[\s\S]*skip/);
    const healthy = makeWorld(); healthy.sortedTroves = descending();
    addTrove(healthy, 555n, { status: 4, debt: 300n * E18, recorded: 300n * E18, coll: 2n * E18 }); healthy.lastZombieTroveId = 555n;
    expect((await getTroveRedemptionPosition(healthy.chain.client(), "WETH", 555n)).warnings.join(" ")).not.toMatch(/ICR below 100%/);
  });
  it("does not label Troves unredeemable when the oracle price is zero", async () => {
    const w = makeWorld(); w.sortedTroves = descending(); w.price = 0n;
    const r = await getTroveRedemptionPosition(w.chain.client(), "WETH", 202n);
    expect(r.data.belowParityDebtAhead).toBe(0n);
    expect(r.data.redeemableDebtAhead).toBe(r.data.debtAhead);
    expect(r.warnings.join(" ")).toMatch(/Oracle price is zero/);
    expect(r.warnings.join(" ")).not.toMatch(/belongs to Troves with ICR below 100%/);
  });
  it("separates debt held by Troves below 100% ICR, which redemptions skip", async () => {
    const w = makeWorld();
    w.sortedTroves = [
      sortedRow(202n, 2000n * E18, 4n * E18 / 100n),
      sortedRow(303n, 1500n * E18, 4n * E18 / 100n),
      sortedRow(101n, 1000n * E18, 3n * E18 / 100n, { entireColl: E18 / 10n }) // 0.1 ETH * $2000 vs 1000 BOLD => 20% ICR
    ];
    const r = await getTroveRedemptionPosition(w.chain.client(), "WETH", 202n);
    expect(r.data).toMatchObject({ debtAhead: 2500n * E18, belowParityDebtAhead: 1000n * E18, redeemableDebtAhead: 1500n * E18 });
    expect(r.warnings.join(" ")).toMatch(/ICR below 100%/);
  });
  it("explains why an absent target is absent (zombie that is not pending vs closed vs unknown)", async () => {
    const w = makeWorld(); w.sortedTroves = descending();
    addTrove(w, 777n, { status: 4 });           // zombie, but not the pending one
    addTrove(w, 778n, { status: 2 });           // closed by owner
    const z = await getTroveRedemptionPosition(w.chain.client(), "WETH", 777n);
    expect(z.data).toMatchObject({ positionFound: false, scanComplete: true, targetStatus: "zombie" });
    expect(z.warnings.join(" ")).toMatch(/zombie Trove/);
    expect((await getTroveRedemptionPosition(w.chain.client(), "WETH", 778n)).data.targetStatus).toBe("closedByOwner");
    expect((await getTroveRedemptionPosition(w.chain.client(), "WETH", 12345n)).data.targetStatus).toBe("nonExistent");
  });
  it("surfaces oracle-fallback warnings in the position result", async () => {
    const w = makeWorld(); w.sortedTroves = descending(); w.priceSource = 2;
    expect((await getTroveRedemptionPosition(w.chain.client(), "WETH", 202n)).warnings.join(" ")).toMatch(/primary oracle/);
  });
  it("distinguishes an absent target from a scan capped before the end", async () => {
    const w = makeWorld();
    const absent = await getTroveRedemptionPosition(w.chain.client(), "WETH", 999n);
    expect(absent.data.positionFound).toBe(false);
    expect(absent.data.scanComplete).toBe(true);
    const capped = await getTroveRedemptionPosition(w.chain.client(), "WETH", 999n, { maxTroves: 1 });
    expect(capped.data.positionFound).toBe(false);
    expect(capped.data.scanComplete).toBe(false);
    expect(capped.data.positionComplete).toBe(false);
  });
  it("calculates rate percentiles, means and debt/count buckets", async () => {
    const w = makeWorld();
    w.sortedTroves = [
      sortedRow(202n, 2000n * E18, 4n * E18 / 100n),
      sortedRow(303n, 1500n * E18, 4n * E18 / 100n),
      sortedRow(101n, 1000n * E18, 3n * E18 / 100n)
    ];
    const r = await analyzeBranchInterestRates(w.chain.client(), "WETH");
    expect(r.data.complete).toBe(true);
    expect(r.data.scannedTroves).toBe(3n);
    expect(r.data.totalDebt).toBe(4500n * E18);
    expect(r.data.minRate).toBe(3n * E18 / 100n);
    expect(r.data.maxRate).toBe(4n * E18 / 100n);
    expect(r.data.percentiles).toMatchObject({ p10: 3n * E18 / 100n, p50: 4n * E18 / 100n, p90: 4n * E18 / 100n });
    expect(r.data.meanRate).toBe(11n * E18 / 300n);
    expect(r.data.debtWeightedMeanRate).toBe(17n * E18 / 450n);
    expect(r.data.buckets).toHaveLength(2);
    expect(r.warnings).toEqual([]);
  });
  it("marks rate analysis incomplete when maxTroves truncates the list", async () => {
    const w = makeWorld();
    const r = await analyzeBranchInterestRates(w.chain.client(), "WETH", { maxTroves: 1 });
    expect(r.data.complete).toBe(false);
    expect(r.data.scannedTroves).toBe(1n);
    expect(r.warnings.join(" ")).toMatch(/not the full branch/);
  });
  it("rejects invalid scan bounds and bucket sizes", async () => {
    const w = makeWorld();
    expect(await codeOf(getTroveRedemptionPosition(w.chain.client(), "WETH", 1n, { maxTroves: 0 }))).toBe("INVALID_INPUT");
    expect(await codeOf(analyzeBranchInterestRates(w.chain.client(), "WETH", { maxTroves: 100001 }))).toBe("INVALID_INPUT");
    expect(await codeOf(analyzeBranchInterestRates(w.chain.client(), "WETH", { bucketSize: 0n }))).toBe("INVALID_INPUT");
  });
});

describe("getWalletTroves", () => {
  const A = 11n, B = 22n, C = 33n;
  function scenario() {
    const w = makeWorld();
    addTrove(w, A, { owner: OTHER });             // transferred away
    addTrove(w, B, { status: 2, owner: OWNER });  // closed
    addTrove(w, C, { owner: OWNER });             // open
    const abi = [erc721TransferEvent] as never;
    w.chain.addTransfer(nft, abi, "0x0000000000000000000000000000000000000000", OWNER, A, 23_000_100n);
    w.chain.addTransfer(nft, abi, OWNER, OTHER, A, 23_100_000n);
    w.chain.addTransfer(nft, abi, "0x0000000000000000000000000000000000000000", OWNER, B, 23_200_000n);
    w.chain.addTransfer(nft, abi, "0x0000000000000000000000000000000000000000", OWNER, C, 23_900_000n);
    w.chain.head = 24_000_000n;
    return w;
  }
  it("reconciles logs against status/ownerOf/balanceOf and reports completeness", async () => {
    const w = scenario(); w.nftBalance.set(OWNER.toLowerCase(), 1n);
    const r = await getWalletTroves(w.chain.client(), "WETH", OWNER, { fromBlock: 23_000_000n, maxBlockRange: 500_000n });
    expect(r.data.troves).toEqual([{ id: C, status: "active" }]);
    expect(r.data.complete).toBe(true);
    expect(r.warnings).toEqual([]);
    expect(w.chain.calls.filter((c) => c.method === "eth_getLogs").length).toBe(3); // 1,000,001 blocks at 500k per request
  });
  it("marks the result incomplete when the scan start is too late", async () => {
    const w = scenario(); w.nftBalance.set(OWNER.toLowerCase(), 2n); // a Trove minted before fromBlock would explain the gap
    const r = await getWalletTroves(w.chain.client(), "WETH", OWNER, { fromBlock: 23_500_000n, maxBlockRange: 1_000_000n });
    expect(r.data.complete).toBe(false);
    expect(r.warnings[0]).toMatch(/incomplete/);
  });
  it("covers the range exactly with no gaps or overlaps", async () => {
    const w = scenario(); w.nftBalance.set(OWNER.toLowerCase(), 1n);
    await getWalletTroves(w.chain.client(), "WETH", OWNER, { fromBlock: 23_999_990n, maxBlockRange: 4n });
    const ranges = w.chain.calls.filter((c) => c.method === "eth_getLogs").map((c) => c.blockTag!.split("-").map(BigInt) as [bigint, bigint]).sort((a, b) => Number(a[0] - b[0]));
    expect(ranges[0]![0]).toBe(23_999_990n);
    expect(ranges.at(-1)![1]).toBe(24_000_000n);
    for (let i = 1; i < ranges.length; i++) expect(ranges[i]![0]).toBe(ranges[i - 1]![1] + 1n);
  });
  it("fails instead of silently truncating when the scan exceeds maxRequests", async () => {
    const w = scenario();
    expect(await codeOf(getWalletTroves(w.chain.client(), "WETH", OWNER, { fromBlock: 0n, maxBlockRange: 10_000n, maxRequests: 10 }))).toBe("INVALID_INPUT");
    expect(w.chain.calls.filter((c) => c.method === "eth_getLogs").length).toBe(0);
  });
  it("validates inputs", async () => {
    const w = scenario();
    expect(await codeOf(getWalletTroves(w.chain.client(), "WETH", "nope" as never, { fromBlock: 0n }))).toBe("INVALID_INPUT");
    expect(await codeOf(getWalletTroves(w.chain.client(), "WETH", OWNER, { fromBlock: w.chain.head + 5n }))).toBe("INVALID_INPUT");
    expect(await codeOf(getWalletTroves(w.chain.client(), "WETH", OWNER, undefined as never))).not.toBe("no error");
  });
});
