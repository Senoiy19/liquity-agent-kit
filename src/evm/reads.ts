import { getAddress, zeroAddress, type Address, type PublicClient } from "viem";
import { getBranchDeployment, LIQUITY_V2_MAINNET } from "./deployments.js";
import { parseAddress, pinBlock, provenanceFor, type PinnedBlock } from "./pin.js";
import { erc20Abi } from "../abis/erc20.js";
import { troveManagerReadAbi } from "../abis/trove-manager.js";
import { borrowerOperationsReadAbi } from "../abis/borrower-operations.js";
import { erc721TransferEvent, troveNftReadAbi } from "../abis/trove-nft.js";
import { priceFeedAbi } from "../abis/price-feed.js";
import { stabilityPoolReadAbi } from "../abis/stability-pool.js";
import { collateralRegistryReadAbi, multiTroveGetterAbi } from "../abis/multi-trove-getter.js";
import { LiquityAgentKitError } from "../core/errors.js";
import { parseBranchId, parseUint } from "../core/branches.js";
import { collateralRatio, liquidationPrice, WAD } from "../core/math.js";
import type {
  BranchId, BranchParameters, BranchPrice, PriceSource, ReadOptions, ReadResult, StabilityPoolDeposit,
  StabilityPoolState, SortedTrovesPage, Trove, TroveHealth, TroveStatus, WalletTroves, WalletTroveDetails, TroveRedemptionPosition, BranchInterestRateAnalysis, InterestRateBucket
} from "../core/types.js";

function statusFromCode(code: number): TroveStatus {
  // ITroveManager.Status: nonExistent=0, active=1, closedByOwner=2, closedByLiquidation=3, zombie=4.
  return ([ "nonExistent", "active", "closedByOwner", "closedByLiquidation", "zombie" ] as const)[code] ?? "unknown";
}
function priceSourceFromCode(code: number): PriceSource {
  // IMainnetPriceFeed.PriceSource: primary=0, ETHUSDxCanonical=1, lastGoodPrice=2.
  return ([ "primary", "ETHUSDxCanonical", "lastGoodPrice" ] as const)[code] ?? "unknown";
}
async function rpc<T>(what: string, run: () => Promise<T>): Promise<T> {
  try { return await run(); } catch (error) {
    if (error instanceof LiquityAgentKitError) throw error;
    throw new LiquityAgentKitError("RPC_READ_FAILED", `RPC read failed: ${what}.`, error);
  }
}

export async function getBoldTokenInfo(client: PublicClient, options?: ReadOptions): Promise<ReadResult<{ address: Address; symbol: string; decimals: number; totalSupply: bigint }>> {
  const pin = await pinBlock(client, options);
  const { blockNumber } = pin;
  const address = getAddress(LIQUITY_V2_MAINNET.shared.boldToken.address);
  const [symbol, decimals, totalSupply] = await rpc("BOLD token", () => Promise.all([
    client.readContract({ address, abi: erc20Abi, functionName: "symbol", blockNumber }),
    client.readContract({ address, abi: erc20Abi, functionName: "decimals", blockNumber }),
    client.readContract({ address, abi: erc20Abi, functionName: "totalSupply", blockNumber })
  ]));
  return { data: { address, symbol, decimals: Number(decimals), totalSupply }, provenance: provenanceFor(pin, [address]), warnings: [] };
}

async function readTrove(client: PublicClient, pin: PinnedBlock, branch: BranchId, troveId: bigint): Promise<{ data: Trove; warnings: string[]; contracts: Address[] }> {
  const { blockNumber } = pin;
  const deployment = getBranchDeployment(branch);
  const manager = getAddress(deployment.contracts.troveManager);
  const nft = getAddress(deployment.contracts.troveNFT);
  const rawStatus = Number(await rpc(`Trove status ${troveId} on ${branch}`, () =>
    client.readContract({ address: manager, abi: troveManagerReadAbi, functionName: "getTroveStatus", args: [troveId], blockNumber })));
  const status = statusFromCode(rawStatus);
  if (status !== "active" && status !== "zombie") {
    throw new LiquityAgentKitError("TROVE_NOT_FOUND", `Trove ${troveId} on ${branch} is not an open Trove (status: ${status}).`);
  }
  const [latest, rawRecorded, owner] = await rpc(`Trove ${troveId} details on ${branch}`, () => Promise.all([
    client.readContract({ address: manager, abi: troveManagerReadAbi, functionName: "getLatestTroveData", args: [troveId], blockNumber }),
    client.readContract({ address: manager, abi: troveManagerReadAbi, functionName: "Troves", args: [troveId], blockNumber }),
    client.readContract({ address: nft, abi: troveNftReadAbi, functionName: "ownerOf", args: [troveId], blockNumber })
  ]));
  const batchManager = rawRecorded[8];
  const data: Trove = {
    id: troveId, branch, owner, status,
    collateral: latest.entireColl, debt: latest.entireDebt, recordedDebt: latest.recordedDebt,
    // getLatestTroveData already reflects batch-level rates, so it is the authoritative rate; Troves() would be stale for batch members.
    annualInterestRate: latest.annualInterestRate,
    accruedInterest: latest.accruedInterest,
    accruedBatchManagementFee: latest.accruedBatchManagementFee,
    interestBatchManager: batchManager, batchDebtShares: rawRecorded[9]
  };
  const warnings: string[] = [];
  if (status === "zombie") warnings.push("This Trove is in Zombie status; do not treat it as an ordinary active Trove.");
  if (batchManager !== zeroAddress) warnings.push("This Trove belongs to an interest batch; batch-level management fees and rate controls may apply.");
  return { data, warnings, contracts: [manager, nft] };
}

export async function getTrove(client: PublicClient, branch: BranchId, troveId: bigint, options?: ReadOptions): Promise<ReadResult<Trove>> {
  const id = parseUint(troveId, "Trove ID");
  const b = parseBranchId(branch);
  const pin = await pinBlock(client, options);
  const { data, warnings, contracts } = await readTrove(client, pin, b, id);
  return { data, provenance: provenanceFor(pin, contracts), warnings };
}

async function readBranchParameters(client: PublicClient, pin: PinnedBlock, branch: BranchId) {
  const { blockNumber } = pin;
  const address = getAddress(getBranchDeployment(branch).contracts.borrowerOperations);
  const call = { address, abi: borrowerOperationsReadAbi, blockNumber } as const;
  const [mcr, ccr, scr, bcr, totalDebt, totalCollateral, isShutdown] = await rpc(`branch parameters for ${branch}`, () => Promise.all([
    client.readContract({ ...call, functionName: "MCR" }),
    client.readContract({ ...call, functionName: "CCR" }),
    client.readContract({ ...call, functionName: "SCR" }),
    client.readContract({ ...call, functionName: "BCR" }),
    client.readContract({ ...call, functionName: "getEntireBranchDebt" }),
    client.readContract({ ...call, functionName: "getEntireBranchColl" }),
    client.readContract({ ...call, functionName: "hasBeenShutDown" })
  ]));
  const data: BranchParameters = { branch, mcr, ccr, scr, bcr, totalDebt, totalCollateral, isShutdown };
  const warnings = isShutdown ? ["This collateral branch is shut down. Borrowing and ordinary adjustments may be unavailable, and liquidation thresholds differ."] : [];
  return { data, warnings, contracts: [address] };
}

export async function getBranchParameters(client: PublicClient, branch: BranchId, options?: ReadOptions): Promise<ReadResult<BranchParameters>> {
  const b = parseBranchId(branch);
  const pin = await pinBlock(client, options);
  const { data, warnings, contracts } = await readBranchParameters(client, pin, b);
  return { data, provenance: provenanceFor(pin, contracts), warnings };
}

async function readBranchPrice(client: PublicClient, pin: PinnedBlock, branch: BranchId) {
  const { blockNumber } = pin;
  const address = getAddress(getBranchDeployment(branch).contracts.priceFeed);
  const [sim, lastGoodPrice, source] = await rpc(`price feed for ${branch}`, () => Promise.all([
    // fetchPrice is state-changing upstream; this is an eth_call simulation and sends nothing.
    client.simulateContract({ address, abi: priceFeedAbi, functionName: "fetchPrice", blockNumber }),
    client.readContract({ address, abi: priceFeedAbi, functionName: "lastGoodPrice", blockNumber }),
    client.readContract({ address, abi: priceFeedAbi, functionName: "priceSource", blockNumber })
  ]));
  const [price, oracleFailureDetected] = sim.result;
  const priceSource = priceSourceFromCode(Number(source));
  const warnings: string[] = [];
  if (oracleFailureDetected) warnings.push("The price feed detected a new oracle failure in this call; the price shown is the last good price and the branch would be shut down on the next state-changing call.");
  if (priceSource !== "primary") warnings.push(`Price feed is not using its primary oracle setup (source: ${priceSource}). Do not treat this as a normal live price.`);
  if (price === 0n) warnings.push("Oracle price is zero; derived ratios are not meaningful.");
  const data: BranchPrice = { branch, price, lastGoodPrice, priceSource, oracleFailureDetected };
  return { data, warnings, contracts: [address] };
}

/** Protocol oracle price (USD, 1e18) for a branch, via an eth_call simulation of PriceFeed.fetchPrice. Not a market price. */
export async function getBranchPrice(client: PublicClient, branch: BranchId, options?: ReadOptions): Promise<ReadResult<BranchPrice>> {
  const b = parseBranchId(branch);
  const pin = await pinBlock(client, options);
  const { data, warnings, contracts } = await readBranchPrice(client, pin, b);
  return { data, provenance: provenanceFor(pin, contracts), warnings };
}

export async function getStabilityPoolState(client: PublicClient, branch: BranchId, options?: ReadOptions): Promise<ReadResult<StabilityPoolState>> {
  const b = parseBranchId(branch);
  const pin = await pinBlock(client, options);
  const { blockNumber } = pin;
  const address = getAddress(getBranchDeployment(b).contracts.stabilityPool);
  const read = (functionName: "getTotalBoldDeposits" | "getCollBalance" | "getYieldGainsOwed" | "getYieldGainsPending") =>
    client.readContract({ address, abi: stabilityPoolReadAbi, functionName, blockNumber });
  const [totalBoldDeposits, collBalance, yieldGainsOwed, yieldGainsPending] = await rpc(`Stability Pool state for ${b}`, () =>
    Promise.all([read("getTotalBoldDeposits"), read("getCollBalance"), read("getYieldGainsOwed"), read("getYieldGainsPending")]));
  return { data: { branch: b, totalBoldDeposits, collBalance, yieldGainsOwed, yieldGainsPending }, provenance: provenanceFor(pin, [address]), warnings: [] };
}

export async function getStabilityPoolDeposit(client: PublicClient, branch: BranchId, depositor: Address, options?: ReadOptions): Promise<ReadResult<StabilityPoolDeposit>> {
  const b = parseBranchId(branch);
  const who = parseAddress(depositor, "depositor");
  const pin = await pinBlock(client, options);
  const { blockNumber } = pin;
  const address = getAddress(getBranchDeployment(b).contracts.stabilityPool);
  const read = (functionName: "deposits" | "stashedColl" | "getDepositorCollGain" | "getDepositorYieldGain" | "getDepositorYieldGainWithPending" | "getCompoundedBoldDeposit") =>
    client.readContract({ address, abi: stabilityPoolReadAbi, functionName, args: [who], blockNumber });
  const [initialDeposit, stashedColl, collGain, yieldGain, yieldGainWithPending, compoundedBoldDeposit] = await rpc(`Stability Pool deposit for ${who} on ${b}`, () =>
    Promise.all([read("deposits"), read("stashedColl"), read("getDepositorCollGain"), read("getDepositorYieldGain"), read("getDepositorYieldGainWithPending"), read("getCompoundedBoldDeposit")]));
  const warnings: string[] = [];
  if (initialDeposit === 0n && stashedColl === 0n && compoundedBoldDeposit === 0n) warnings.push("This address has no deposit and no stashed collateral in this pool at the pinned block.");
  return { data: { branch: b, depositor: who, compoundedBoldDeposit, initialDeposit, collGain, yieldGain, yieldGainWithPending, stashedColl }, provenance: provenanceFor(pin, [address]), warnings };
}

/**
 * Read a bounded page from Liquity's protocol-sorted Trove list. The collateral index is
 * resolved on-chain from CollateralRegistry.getToken(), not inferred from a hard-coded order.
 * `startIndex` is the signed index accepted by MultiTroveGetter; for forward pagination use
 * the returned nextStartIndex. This reports the contract's list order, not a prediction of
 * redemption execution or eligibility.
 */
async function resolveCollateralIndex(client: PublicClient, pin: PinnedBlock, branch: BranchId): Promise<{ registry: Address; getter: Address; collateralIndex: bigint }> {
  const registry = getAddress(LIQUITY_V2_MAINNET.shared.collateralRegistry.address);
  const token = getAddress(getBranchDeployment(branch).collateralToken);
  const total = await rpc("collateral registry size", () => client.readContract({ address: registry, abi: collateralRegistryReadAbi, functionName: "totalCollaterals", blockNumber: pin.blockNumber }));
  let collateralIndex: bigint | null = null;
  for (let i = 0n; i < total; i++) {
    const candidate = await rpc(`collateral registry token ${i}`, () => client.readContract({
      address: registry, abi: collateralRegistryReadAbi, functionName: "getToken", args: [i], blockNumber: pin.blockNumber
    }));
    if (candidate.toLowerCase() === token.toLowerCase()) { collateralIndex = i; break; }
  }
  if (collateralIndex === null) throw new LiquityAgentKitError("RPC_READ_FAILED", `Collateral token for ${branch} was not found in the on-chain collateral registry.`);
  return { registry, getter: getAddress(LIQUITY_V2_MAINNET.shared.multiTroveGetter.address), collateralIndex };
}

async function readSortedTrovesPageAtPin(
  client: PublicClient, pin: PinnedBlock, branch: BranchId, startIndex: bigint, count: bigint,
  resolved: { registry: Address; getter: Address; collateralIndex: bigint }
): Promise<ReadResult<SortedTrovesPage>> {
  const raw = await rpc(`sorted Trove page for ${branch}`, () => client.readContract({
    address: resolved.getter, abi: multiTroveGetterAbi, functionName: "getMultipleSortedTroves",
    args: [resolved.collateralIndex, startIndex, count], blockNumber: pin.blockNumber
  }));
  const troves = raw.map((t) => ({
    id: t.id, debt: t.entireDebt, collateral: t.entireColl,
    redistBoldDebtGain: t.redistBoldDebtGain, redistCollGain: t.redistCollGain,
    accruedInterest: t.accruedInterest, recordedDebt: t.recordedDebt,
    annualInterestRate: t.annualInterestRate, accruedBatchManagementFee: t.accruedBatchManagementFee,
    lastInterestRateAdjTime: t.lastInterestRateAdjTime, stake: t.stake,
    lastDebtUpdateTime: t.lastDebtUpdateTime, interestBatchManager: t.interestBatchManager,
    batchDebtShares: t.batchDebtShares, snapshotCollateral: t.snapshotETH, snapshotBoldDebt: t.snapshotBoldDebt
  }));
  const hasMore = BigInt(troves.length) === count;
  const nextStartIndex = hasMore && startIndex >= 0n ? startIndex + count : null;
  const warnings = troves.some((t) => t.interestBatchManager !== zeroAddress)
    ? ["This page includes Troves in interest batches. Their effective rate and fees may be managed at batch level."] : [];
  if (hasMore && startIndex < 0n) warnings.push("A full page was returned from a negative start index. Supply the next signed index explicitly; this SDK does not infer tail-relative cursor semantics.");
  return { data: { branch, collateralIndex: resolved.collateralIndex, startIndex, countRequested: count, troves, nextStartIndex, hasMore }, provenance: provenanceFor(pin, [resolved.registry, resolved.getter]), warnings };
}

export async function getSortedTrovesPage(
  client: PublicClient, branch: BranchId, startIndex: bigint, count: bigint, options?: ReadOptions
): Promise<ReadResult<SortedTrovesPage>> {
  const b = parseBranchId(branch);
  if (typeof startIndex !== "bigint" || startIndex < -(2n ** 255n) || startIndex >= 2n ** 255n) throw new LiquityAgentKitError("INVALID_INPUT", "startIndex must fit int256.");
  if (typeof count !== "bigint" || count < 1n || count > 500n) throw new LiquityAgentKitError("INVALID_INPUT", "count must be between 1 and 500.");
  const pin = await pinBlock(client, options);
  const resolved = await resolveCollateralIndex(client, pin, b);
  return readSortedTrovesPageAtPin(client, pin, b, startIndex, count, resolved);
}

/**
 * Calculates a Trove's current position in its branch's redemption queue.
 *
 * SortedTroves is ordered by annual interest rate in DESCENDING order (head = highest rate) and
 * TroveManager.redeemCollateral starts at the TAIL (getLast) and moves toward the head (getPrev), so the
 * lowest-rate Troves are redeemed first. This therefore walks the list from the tail (MultiTroveGetter's
 * negative, tail-relative start index) and sums the entireDebt of every Trove that would be redeemed
 * BEFORE the target: all lower-rate Troves, plus same-rate Troves that sit nearer the tail.
 * Higher-rate Troves (redeemed after the target) are never counted. `rank` is one-based, 1 = first redeemed.
 * The scan is block-pinned and bounded; if the cap is reached before the target, the result is
 * explicitly incomplete rather than guessing.
 */
export async function getTroveRedemptionPosition(
  client: PublicClient, branch: BranchId, troveId: bigint,
  options?: ReadOptions & { maxTroves?: number }
): Promise<ReadResult<TroveRedemptionPosition>> {
  const b = parseBranchId(branch);
  const id = parseUint(troveId, "Trove ID");
  const maxTroves = options?.maxTroves ?? 10_000;
  if (!Number.isSafeInteger(maxTroves) || maxTroves < 1 || maxTroves > 100_000) {
    throw new LiquityAgentKitError("INVALID_INPUT", "maxTroves must be a safe integer between 1 and 100000.");
  }
  const pin = await pinBlock(client, options);
  const { blockNumber } = pin;
  const resolved = await resolveCollateralIndex(client, pin, b);
  const manager = getAddress(getBranchDeployment(b).contracts.troveManager);
  const [priceRead, zombieId] = await Promise.all([
    readBranchPrice(client, pin, b),
    rpc(`lastZombieTroveId for ${b}`, () => client.readContract({ address: manager, abi: troveManagerReadAbi, functionName: "lastZombieTroveId", blockNumber }))
  ]);
  const price = priceRead.data.price;
  // Redemption skips Troves whose ICR (at the normal oracle price) is below 100% (TroveManager.redeemCollateral).
  const belowParity = (coll: bigint, debt: bigint) => { const icr = collateralRatio(coll, price, debt); return icr !== null && icr < WAD; };
  const warnings: string[] = [...priceRead.warnings];
  const contracts = [resolved.registry, resolved.getter, manager, ...priceRead.contracts];

  // A partially redeemed "zombie" Trove is removed from SortedTroves but is redeemed FIRST in the next redemption (lastZombieTroveId).
  let pendingZombieId: bigint | null = null, pendingZombieDebt = 0n, zombieBelowParity = 0n;
  if (zombieId !== 0n) {
    const z = await rpc(`pending zombie Trove ${zombieId}`, () => client.readContract({ address: manager, abi: troveManagerReadAbi, functionName: "getLatestTroveData", args: [zombieId], blockNumber }));
    if (zombieId === id) {
      warnings.push("This Trove is the branch's pending zombie Trove: it is removed from the sorted list but is redeemed before any listed Trove.");
      return {
        data: { branch: b, troveId: id, positionFound: true, rank: 1n, targetAnnualInterestRate: z.annualInterestRate, targetDebt: z.entireDebt, targetStatus: "zombie",
          pendingZombieTroveId: zombieId, pendingZombieDebt: 0n, trovesAhead: 0n, debtAhead: 0n, lowerRateDebtAhead: 0n, sameRateDebtAhead: 0n, belowParityDebtAhead: 0n, redeemableDebtAhead: 0n,
          scannedTroves: 0n, scanComplete: true, positionComplete: true },
        provenance: provenanceFor(pin, contracts), warnings
      };
    }
    if (z.entireDebt > 0n) {
      pendingZombieId = zombieId; pendingZombieDebt = z.entireDebt;
      if (belowParity(z.entireColl, z.entireDebt)) zombieBelowParity = z.entireDebt;
    }
  }

  let start = 0n, scanned = 0n, lowerRateDebtAhead = 0n, sameRateDebtAhead = 0n, listDebtAhead = 0n, listBelowParity = 0n;
  let listAhead = 0n, targetRate: bigint | null = null, targetDebt: bigint | null = null;
  let found = false, scanComplete = false;
  const prefix: Array<{ rate: bigint; debt: bigint }> = [];
  const pageSize = 500n;
  while (scanned < BigInt(maxTroves)) {
    const requested = BigInt(maxTroves) - scanned < pageSize ? BigInt(maxTroves) - scanned : pageSize;
    // Negative start indexes are tail-relative in MultiTroveGetter: -1 is the tail, -(n+1) skips n Troves from the tail.
    const page = await readSortedTrovesPageAtPin(client, pin, b, -(start + 1n), requested, resolved);
    for (const t of page.data.troves) {
      scanned += 1n;
      if (t.id === id) { found = true; targetRate = t.annualInterestRate; targetDebt = t.debt; break; }
      listDebtAhead += t.debt;
      if (belowParity(t.collateral, t.debt)) listBelowParity += t.debt;
      prefix.push({ rate: t.annualInterestRate, debt: t.debt });
      listAhead += 1n;
    }
    if (found) break;
    if (page.data.troves.length < Number(requested)) { scanComplete = true; break; }
    start += BigInt(page.data.troves.length);
  }
  if (found) for (const t of prefix) {
    if (t.rate < targetRate!) lowerRateDebtAhead += t.debt;
    else if (t.rate === targetRate!) sameRateDebtAhead += t.debt;
  }

  let targetStatus: TroveStatus | null = null;
  if (!found && scanComplete) {
    targetStatus = statusFromCode(Number(await rpc(`Trove status ${id}`, () => client.readContract({ address: manager, abi: troveManagerReadAbi, functionName: "getTroveStatus", args: [id], blockNumber }))));
  } else if (found) targetStatus = "active";

  const zombieCount = pendingZombieId === null ? 0n : 1n;
  const debtAhead = pendingZombieDebt + listDebtAhead;
  const belowParityDebtAhead = zombieBelowParity + listBelowParity;
  const data: TroveRedemptionPosition = {
    branch: b, troveId: id, positionFound: found, rank: found ? listAhead + zombieCount + 1n : null,
    targetAnnualInterestRate: targetRate, targetDebt, targetStatus,
    pendingZombieTroveId: pendingZombieId, pendingZombieDebt,
    trovesAhead: listAhead + zombieCount, debtAhead, lowerRateDebtAhead, sameRateDebtAhead,
    belowParityDebtAhead, redeemableDebtAhead: debtAhead - belowParityDebtAhead,
    scannedTroves: scanned, scanComplete, positionComplete: found
  };
  if (found) {
    warnings.push("Debt ahead is the debt of Troves redeemed before the target in this branch (lowest rate first) at the pinned block. It is a point-in-time, branch-local figure, not a forecast: actual redemptions also depend on cross-branch routing, redemption amount, fees, branch status and transaction-time state.");
    if (pendingZombieId !== null) warnings.push(`Pending zombie Trove ${pendingZombieId} (debt ${pendingZombieDebt}) is redeemed before every listed Trove and is included in debtAhead.`);
    if (belowParityDebtAhead > 0n) warnings.push(`${belowParityDebtAhead} of debtAhead belongs to Troves with ICR below 100% at the current oracle price, which redemptions skip; use redeemableDebtAhead for the amount actually reachable now.`);
  } else if (scanComplete) {
    warnings.push(targetStatus === "zombie"
      ? "The Trove is a zombie Trove. Zombie Troves are removed from the sorted list and are redeemable only while they are the branch's pending zombie, which this Trove is not."
      : `The Trove was not found in this branch's sorted list (status: ${targetStatus}). It may be closed, never opened on this branch, or on another branch.`);
  } else {
    warnings.push(`Scan stopped at maxTroves=${maxTroves} before finding the target. Increase maxTroves; debtAhead is not complete.`);
  }
  return { data, provenance: provenanceFor(pin, contracts), warnings };
}

/**
 * Full-branch interest-rate distribution using the protocol's current sorted list.
 * Percentiles use nearest-rank by Trove count. The debt-weighted mean weights each
 * effective annual rate by the Trove's current entireDebt. Results are marked incomplete
 * if maxTroves is reached before the list ends.
 */
export async function analyzeBranchInterestRates(
  client: PublicClient, branch: BranchId,
  options?: ReadOptions & { maxTroves?: number; bucketSize?: bigint }
): Promise<ReadResult<BranchInterestRateAnalysis>> {
  const b = parseBranchId(branch);
  const maxTroves = options?.maxTroves ?? 10_000;
  const bucketSize = options?.bucketSize ?? 10n ** 16n; // 1 percentage point when 1e18 = 100%
  if (!Number.isSafeInteger(maxTroves) || maxTroves < 1 || maxTroves > 100_000) throw new LiquityAgentKitError("INVALID_INPUT", "maxTroves must be a safe integer between 1 and 100000.");
  if (typeof bucketSize !== "bigint" || bucketSize <= 0n) throw new LiquityAgentKitError("INVALID_INPUT", "bucketSize must be a positive 1e18-scaled annual rate.");
  const pin = await pinBlock(client, options);
  const resolved = await resolveCollateralIndex(client, pin, b);
  const rates: bigint[] = [];
  const bucketMap = new Map<bigint, { count: bigint; debt: bigint }>();
  let totalDebt = 0n, weightedRateSum = 0n, scanned = 0n, start = 0n, complete = false;
  const pageSize = 500n;
  while (scanned < BigInt(maxTroves)) {
    const requested = BigInt(maxTroves) - scanned < pageSize ? BigInt(maxTroves) - scanned : pageSize;
    const page = await readSortedTrovesPageAtPin(client, pin, b, start, requested, resolved);
    for (const t of page.data.troves) {
      rates.push(t.annualInterestRate);
      totalDebt += t.debt;
      weightedRateSum += t.debt * t.annualInterestRate;
      const lowerRate = (t.annualInterestRate / bucketSize) * bucketSize;
      const bucket = bucketMap.get(lowerRate) ?? { count: 0n, debt: 0n };
      bucket.count += 1n; bucket.debt += t.debt; bucketMap.set(lowerRate, bucket);
    }
    scanned += BigInt(page.data.troves.length);
    if (page.data.troves.length < Number(requested)) { complete = true; break; }
    start += BigInt(page.data.troves.length);
  }
  rates.sort((a, b2) => a < b2 ? -1 : a > b2 ? 1 : 0);
  const percentile = (p: bigint): bigint | null => rates.length ? rates[Number(((p * BigInt(rates.length) + 99n) / 100n) - 1n)]! : null;
  const buckets: InterestRateBucket[] = [...bucketMap.entries()].sort(([a], [b2]) => a < b2 ? -1 : a > b2 ? 1 : 0).map(([lowerRate, v]) => ({
    lowerRate, upperRateExclusive: lowerRate + bucketSize, troveCount: v.count, totalDebt: v.debt
  }));
  const data: BranchInterestRateAnalysis = {
    branch: b, complete, scannedTroves: scanned, totalDebt,
    minRate: rates[0] ?? null, maxRate: rates.at(-1) ?? null,
    meanRate: rates.length ? rates.reduce((sum, r) => sum + r, 0n) / BigInt(rates.length) : null,
    debtWeightedMeanRate: totalDebt > 0n ? weightedRateSum / totalDebt : null,
    percentiles: { p10: percentile(10n), p25: percentile(25n), p50: percentile(50n), p75: percentile(75n), p90: percentile(90n) },
    bucketSize, buckets
  };
  const warnings = complete ? [] : [`Analysis stopped at maxTroves=${maxTroves}; counts, debt totals, averages and percentiles describe only the scanned prefix, not the full branch.`];
  return { data, provenance: provenanceFor(pin, [resolved.registry, resolved.getter]), warnings };
}

export interface WalletTrovesOptions extends ReadOptions {
  /** First block to scan for TroveNFT transfers. Required: use a block at or before the branch was deployed. */
  fromBlock: bigint;
  /** Blocks per eth_getLogs request. Lower it if your provider caps log ranges. Default 10_000. */
  maxBlockRange?: bigint;
  /** Upper bound on eth_getLogs requests; the call fails rather than silently truncating. Default 500. */
  maxRequests?: number;
}

/**
 * Finds open Troves owned by `owner` on a branch. TroveNFT is not enumerable, so this scans Transfer(to=owner)
 * logs from `fromBlock`, then reconciles each candidate against the current Trove status and `ownerOf`, and
 * finally against `balanceOf`. `complete` is true only when the reconciliation agrees.
 */
export async function getWalletTroves(client: PublicClient, branch: BranchId, owner: Address, options: WalletTrovesOptions): Promise<ReadResult<WalletTroves>> {
  const b = parseBranchId(branch);
  const who = parseAddress(owner, "owner");
  const fromBlock = parseUint(options?.fromBlock, "fromBlock");
  const range = options.maxBlockRange ?? 10_000n;
  const maxRequests = options.maxRequests ?? 500;
  if (range <= 0n || !Number.isSafeInteger(maxRequests) || maxRequests <= 0) throw new LiquityAgentKitError("INVALID_INPUT", "maxBlockRange must be positive and maxRequests must be a positive safe integer.");
  const pin = await pinBlock(client, options);
  const { blockNumber } = pin;
  if (fromBlock > blockNumber) throw new LiquityAgentKitError("INVALID_INPUT", `fromBlock ${fromBlock} is after the pinned block ${blockNumber}.`);
  const requests = (blockNumber - fromBlock) / range + 1n;
  if (requests > BigInt(maxRequests)) {
    throw new LiquityAgentKitError("INVALID_INPUT", `Scanning ${fromBlock}..${blockNumber} needs ${requests} log requests (limit ${maxRequests}). Raise maxRequests or maxBlockRange, or start from a later fromBlock.`);
  }
  const dep = getBranchDeployment(b);
  const nft = getAddress(dep.contracts.troveNFT);
  const manager = getAddress(dep.contracts.troveManager);

  const windows: Array<[bigint, bigint]> = [];
  for (let start = fromBlock; start <= blockNumber; start += range) windows.push([start, start + range - 1n > blockNumber ? blockNumber : start + range - 1n]);
  const candidates = new Set<bigint>();
  const CONCURRENCY = 4;
  for (let i = 0; i < windows.length; i += CONCURRENCY) {
    const batch = windows.slice(i, i + CONCURRENCY);
    const logs = await rpc(`TroveNFT transfer logs for ${who} on ${b}`, () => Promise.all(batch.map(([f, t]) =>
      client.getLogs({ address: nft, event: erc721TransferEvent, args: { to: who }, fromBlock: f, toBlock: t }))));
    for (const chunk of logs) for (const log of chunk) if (log.args.tokenId !== undefined) candidates.add(log.args.tokenId);
  }

  const troves: WalletTroves["troves"] = [];
  const ids = [...candidates].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  // Bound concurrent RPC calls: avoids one request per candidate serially while remaining
  // conservative with providers that impose request/concurrency limits.
  const VERIFY_CONCURRENCY = 8;
  for (let i = 0; i < ids.length; i += VERIFY_CONCURRENCY) {
    const batch = ids.slice(i, i + VERIFY_CONCURRENCY);
    const verified = await Promise.all(batch.map(async (id) => {
      const status = statusFromCode(Number(await rpc(`Trove status ${id}`, () =>
        client.readContract({ address: manager, abi: troveManagerReadAbi, functionName: "getTroveStatus", args: [id], blockNumber }))));
      if (status !== "active" && status !== "zombie") return null;
      const current = await rpc(`ownerOf ${id}`, () => client.readContract({ address: nft, abi: troveNftReadAbi, functionName: "ownerOf", args: [id], blockNumber }));
      return current.toLowerCase() === who.toLowerCase() ? { id, status } : null;
    }));
    for (const item of verified) if (item) troves.push(item);
  }
  const nftBalance = await rpc("TroveNFT balanceOf", () => client.readContract({ address: nft, abi: troveNftReadAbi, functionName: "balanceOf", args: [who], blockNumber }));
  const complete = BigInt(troves.length) === nftBalance;
  const warnings: string[] = [];
  if (!complete) warnings.push(`Found ${troves.length} open Troves but the NFT balance is ${nftBalance}. The scan is incomplete (try an earlier fromBlock); do not treat this list as exhaustive.`);
  if (troves.some((t) => t.status === "zombie")) warnings.push("At least one Trove is in Zombie status.");
  return { data: { owner: who, branch: b, troves, nftBalance, complete, scannedFromBlock: fromBlock, scannedToBlock: blockNumber }, provenance: provenanceFor(pin, [nft, manager]), warnings };
}

export interface WalletTroveDetailsOptions extends WalletTrovesOptions {
  /** Maximum Troves to hydrate (1-100). Default 25. Discovery is unaffected; only hydration is capped. */
  maxTroves?: number;
}

/**
 * Discovers a wallet's open Troves (see getWalletTroves) and hydrates each with full Trove data.
 * Discovery and hydration share one pinned block. `detailsComplete` is false when the cap truncated hydration;
 * `discoveryComplete` mirrors the NFT-balance reconciliation from getWalletTroves.
 */
export async function getWalletTroveDetails(client: PublicClient, branch: BranchId, owner: Address, options: WalletTroveDetailsOptions): Promise<ReadResult<WalletTroveDetails>> {
  const b = parseBranchId(branch);
  const who = parseAddress(owner, "owner");
  const maxTroves = options?.maxTroves ?? 25;
  if (!Number.isSafeInteger(maxTroves) || maxTroves < 1 || maxTroves > 100) throw new LiquityAgentKitError("INVALID_INPUT", "maxTroves must be an integer between 1 and 100.");
  const pin = await pinBlock(client, options);
  const found = await getWalletTroves(client, b, who, { ...options, blockNumber: pin.blockNumber });
  const targets = found.data.troves.slice(0, maxTroves);
  const HYDRATE_CONCURRENCY = 5;
  const troves: Trove[] = [];
  const warnings = [...found.warnings];
  const contracts: Address[] = [...found.provenance.contractAddresses];
  for (let i = 0; i < targets.length; i += HYDRATE_CONCURRENCY) {
    const batch = await Promise.all(targets.slice(i, i + HYDRATE_CONCURRENCY).map((t) => readTrove(client, pin, b, t.id)));
    for (const r of batch) {
      troves.push(r.data);
      contracts.push(...r.contracts);
      for (const w of r.warnings) warnings.push(`Trove ${r.data.id}: ${w}`);
    }
  }
  const detailsComplete = targets.length === found.data.troves.length;
  if (!detailsComplete) warnings.push(`Hydrated ${targets.length} of ${found.data.troves.length} discovered Troves (maxTroves cap). Raise maxTroves (max 100) to see the rest.`);
  return {
    data: { owner: who, branch: b, discoveredCount: BigInt(found.data.troves.length), nftBalance: found.data.nftBalance, discoveryComplete: found.data.complete, detailsComplete, troves, scannedFromBlock: found.data.scannedFromBlock, scannedToBlock: found.data.scannedToBlock },
    provenance: provenanceFor(pin, contracts), warnings
  };
}

/** Trove + oracle price + branch MCR, all read at one block, with collateral ratio and liquidation price derived locally. */
export async function getTroveHealth(client: PublicClient, branch: BranchId, troveId: bigint, options?: ReadOptions): Promise<ReadResult<TroveHealth>> {
  const id = parseUint(troveId, "Trove ID");
  const b = parseBranchId(branch);
  const pin = await pinBlock(client, options);
  const [t, p, params] = await Promise.all([readTrove(client, pin, b, id), readBranchPrice(client, pin, b), readBranchParameters(client, pin, b)]);
  const ratio = collateralRatio(t.data.collateral, p.data.price, t.data.debt);
  const liq = liquidationPrice(t.data.debt, params.data.mcr, t.data.collateral);
  const warnings = [...t.warnings, ...p.warnings, ...params.warnings,
    "Collateral ratio uses the protocol oracle price and the Trove's current debt; it is a point-in-time figure, not a prediction of liquidation, and does not by itself show the position is safe."];
  return {
    data: { trove: t.data, price: p.data, mcr: params.data.mcr, collateralRatio: ratio, liquidationPrice: liq, isBelowMcr: ratio !== null && ratio < params.data.mcr },
    provenance: provenanceFor(pin, [...t.contracts, ...p.contracts, ...params.contracts]),
    warnings
  };
}
