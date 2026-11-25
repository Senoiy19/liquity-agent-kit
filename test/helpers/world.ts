import { encodeAbiParameters, getAddress, keccak256, parseAbiParameters, zeroAddress, type Address } from "viem";
import { MockChain } from "./mock-chain.js";
import { LIQUITY_V2_MAINNET } from "../../src/evm/deployments.js";
import { borrowerOperationsReadAbi } from "../../src/abis/borrower-operations.js";
import { priceFeedAbi } from "../../src/abis/price-feed.js";
import { stabilityPoolReadAbi } from "../../src/abis/stability-pool.js";
import { erc721TransferEvent, troveNftReadAbi } from "../../src/abis/trove-nft.js";
import { troveManagerReadAbi } from "../../src/abis/trove-manager.js";
import { erc20Abi } from "../../src/abis/erc20.js";
import { collateralRegistryReadAbi, multiTroveGetterAbi } from "../../src/abis/multi-trove-getter.js";

export const E18 = 10n ** 18n;
export const OWNER = getAddress("0x1111111111111111111111111111111111111111");
export const OTHER = getAddress("0x2222222222222222222222222222222222222222");
export const BATCH_MANAGER = getAddress("0x3333333333333333333333333333333333333333");
export const TROVE_ID = BigInt(keccak256(encodeAbiParameters(parseAbiParameters("address, address, uint256"), [OWNER, OWNER, 0n]))); // same derivation as BorrowerOperations.openTrove

export interface TroveState { status: number; coll: bigint; debt: bigint; recorded: bigint; rate: bigint; batch: Address; batchShares: bigint; owner: Address }
export type MockSortedTrove = { id: bigint; entireDebt: bigint; entireColl: bigint; redistBoldDebtGain: bigint; redistCollGain: bigint; accruedInterest: bigint; recordedDebt: bigint; annualInterestRate: bigint; accruedBatchManagementFee: bigint; lastInterestRateAdjTime: bigint; stake: bigint; lastDebtUpdateTime: bigint; interestBatchManager: Address; batchDebtShares: bigint; snapshotETH: bigint; snapshotBoldDebt: bigint };
export interface World {
  chain: MockChain;
  sortedTroves: MockSortedTrove[];
  lastZombieTroveId: bigint;
  troves: Map<bigint, TroveState>;
  priceSource: number; oracleFailure: boolean; price: bigint; lastGood: bigint; shutdown: boolean;
  nftBalance: Map<string, bigint>;
  spDeposits: Map<string, { initial: bigint; compounded: bigint; collGain: bigint; yieldGain: bigint; yieldPending: bigint; stashed: bigint }>;
}

/** Mock WETH branch + BOLD token. Values are deliberately round so expected results are checkable by hand. */
export function makeWorld(): World {
  const chain = new MockChain();
  const b = LIQUITY_V2_MAINNET.branches.WETH.contracts;
  const w: World = { chain, sortedTroves: [], lastZombieTroveId: 0n, troves: new Map(), priceSource: 0, oracleFailure: false, price: 2000n * E18, lastGood: 1990n * E18, shutdown: false, nftBalance: new Map(), spDeposits: new Map() };
  const t = (id: bigint) => w.troves.get(id) ?? { status: 0, coll: 0n, debt: 0n, recorded: 0n, rate: 0n, batch: zeroAddress, batchShares: 0n, owner: zeroAddress };

  chain.add(LIQUITY_V2_MAINNET.shared.boldToken.address, { abi: erc20Abi, call: (fn) => ({ symbol: "BOLD", decimals: 18, totalSupply: 75_000_000n * E18, balanceOf: 0n } as Record<string, unknown>)[fn] });
  chain.add(LIQUITY_V2_MAINNET.shared.collateralRegistry.address, { abi: collateralRegistryReadAbi, call(fn, [index]) {
    if (fn === "totalCollaterals") return 3n;
    const tokens = [
      LIQUITY_V2_MAINNET.branches.WETH.collateralToken,
      LIQUITY_V2_MAINNET.branches.wstETH.collateralToken,
      LIQUITY_V2_MAINNET.branches.rETH.collateralToken
    ];
    return tokens[Number(index)];
  } });
  chain.add(LIQUITY_V2_MAINNET.shared.multiTroveGetter.address, { abi: multiTroveGetterAbi, call(fn, [collIndex, startIndex, count]) {
    if (fn !== "getMultipleSortedTroves" || collIndex !== 0n) throw new Error("unexpected MultiTroveGetter call");
    const all = w.sortedTroves.length ? w.sortedTroves : [
      { id: 101n, entireDebt: 1000n * E18, entireColl: 2n * E18, redistBoldDebtGain: 0n, redistCollGain: 0n, accruedInterest: 1n * E18, recordedDebt: 999n * E18, annualInterestRate: 3n * E18 / 100n, accruedBatchManagementFee: 0n, lastInterestRateAdjTime: 10n, stake: 2n * E18, lastDebtUpdateTime: 10n, interestBatchManager: zeroAddress, batchDebtShares: 0n, snapshotETH: 0n, snapshotBoldDebt: 0n },
      { id: 202n, entireDebt: 2000n * E18, entireColl: 3n * E18, redistBoldDebtGain: 0n, redistCollGain: 0n, accruedInterest: 2n * E18, recordedDebt: 1998n * E18, annualInterestRate: 4n * E18 / 100n, accruedBatchManagementFee: 1n, lastInterestRateAdjTime: 11n, stake: 3n * E18, lastDebtUpdateTime: 11n, interestBatchManager: BATCH_MANAGER, batchDebtShares: 5n, snapshotETH: 0n, snapshotBoldDebt: 0n }
    ];
    // Mirrors MultiTroveGetter: idx >= 0 walks from the head; idx < 0 walks from the tail starting at -(idx+1).
    const idx = startIndex as bigint;
    if (idx >= 0n) return all.slice(Number(idx), Number(idx) + Number(count));
    const fromTail = Number(-(idx + 1n));
    return [...all].reverse().slice(fromTail, fromTail + Number(count));
  } });
  chain.add(b.troveManager, { abi: troveManagerReadAbi, call(fn, [id]) {
    if (fn === "lastZombieTroveId") return w.lastZombieTroveId;
    const s = t(id as bigint);
    switch (fn) {
      case "getTroveStatus": return s.status;
      case "getTroveAnnualInterestRate": return s.rate;
      case "getLatestTroveData": return { entireDebt: s.debt, entireColl: s.coll, redistBoldDebtGain: 0n, redistCollGain: 0n, accruedInterest: s.debt - s.recorded, recordedDebt: s.recorded, annualInterestRate: s.rate, weightedRecordedDebt: 0n, accruedBatchManagementFee: 0n, lastInterestRateAdjTime: 1n };
      case "Troves": return [s.recorded, s.coll, 0n, s.status, 0n, 0n, 0n, /* stale per-Trove rate on purpose */ 1n, s.batch, s.batchShares];
      default: throw new Error(fn);
    }
  } });
  chain.add(b.troveNFT, { abi: troveNftReadAbi, call(fn, [arg]) {
    if (fn === "ownerOf") { const s = w.troves.get(arg as bigint); if (!s) throw new Error("ERC721NonexistentToken"); return s.owner; }
    return w.nftBalance.get(String(arg).toLowerCase()) ?? 0n;
  } });
  chain.add(b.borrowerOperations, { abi: borrowerOperationsReadAbi, call: (fn) => ({ MCR: 11n * E18 / 10n, CCR: 15n * E18 / 10n, SCR: 11n * E18 / 10n, BCR: 10n * E18 / 100n, getEntireBranchDebt: 100_000_000n * E18, getEntireBranchColl: 90_000n * E18, hasBeenShutDown: w.shutdown } as Record<string, unknown>)[fn] });
  chain.add(b.priceFeed, { abi: priceFeedAbi, call: (fn) => fn === "fetchPrice" ? [w.price, w.oracleFailure] : fn === "lastGoodPrice" ? w.lastGood : w.priceSource });
  chain.add(b.stabilityPool, { abi: stabilityPoolReadAbi, call(fn, [who]) {
    const d = w.spDeposits.get(String(who).toLowerCase());
    switch (fn) {
      case "getTotalBoldDeposits": return 20_000_000n * E18;
      case "getCollBalance": return 5n * E18;
      case "getYieldGainsOwed": return 100n * E18;
      case "getYieldGainsPending": return 7n * E18;
      case "deposits": return d?.initial ?? 0n;
      case "stashedColl": return d?.stashed ?? 0n;
      case "getDepositorCollGain": return d?.collGain ?? 0n;
      case "getDepositorYieldGain": return d?.yieldGain ?? 0n;
      case "getDepositorYieldGainWithPending": return (d?.yieldGain ?? 0n) + (d?.yieldPending ?? 0n);
      case "getCompoundedBoldDeposit": return d?.compounded ?? 0n;
      default: throw new Error(fn);
    }
  } });
  return w;
}

export function addTrove(w: World, id: bigint, patch: Partial<TroveState> = {}) {
  w.troves.set(id, { status: 1, coll: 2n * E18, debt: 1000n * E18, recorded: 990n * E18, rate: 5n * E18 / 100n, batch: zeroAddress, batchShares: 0n, owner: OWNER, ...patch });
}
export { erc721TransferEvent };

export function sortedRow(id: bigint, debt: bigint, rate: bigint, patch: Partial<MockSortedTrove> = {}): MockSortedTrove {
  return {
    id, entireDebt: debt, entireColl: 2n * E18, redistBoldDebtGain: 0n, redistCollGain: 0n,
    accruedInterest: 0n, recordedDebt: debt, annualInterestRate: rate, accruedBatchManagementFee: 0n,
    lastInterestRateAdjTime: 1n, stake: E18, lastDebtUpdateTime: 1n, interestBatchManager: zeroAddress,
    batchDebtShares: 0n, snapshotETH: 0n, snapshotBoldDebt: 0n, ...patch
  };
}
