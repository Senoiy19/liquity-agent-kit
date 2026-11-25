import type { Address, Hash } from "viem";

export const BRANCH_IDS = ["WETH", "wstETH", "rETH"] as const;
export type BranchId = (typeof BRANCH_IDS)[number];
export type TroveStatus = "nonExistent" | "active" | "closedByOwner" | "closedByLiquidation" | "zombie" | "unknown";

/** Side-effect classes from docs/SAFETY_AND_DATA.md. Only `read` and `compute` exist in v0.x. */
export type SideEffect = "read" | "compute" | "plan" | "write";

export interface ReadProvenance {
  chainId: 1;
  blockNumber: bigint;
  blockHash: Hash;
  /** ISO-8601 timestamp of the pinned block (from the chain, not the local clock). */
  blockTimestamp: string;
  /** ISO-8601 local wall-clock time at which the read completed. */
  observedAt: string;
  /** Contracts that were queried to produce the result. */
  contractAddresses: Address[];
  source: "ethereum-rpc";
}

export type DeploymentVerification = "official-docs" | "official-repository-env";
export interface DeploymentContract { address: Address; sourceUrl: string; verification: DeploymentVerification; }
export interface BranchDeployment {
  id: BranchId;
  collateralSymbol: "WETH" | "wstETH" | "rETH";
  collateralToken: Address;
  contracts: {
    addressesRegistry: Address;
    troveManager: Address;
    troveNFT: Address;
    borrowerOperations: Address;
    stabilityPool: Address;
    sortedTroves: Address;
    priceFeed: Address;
    activePool: Address;
  };
}
export interface LiquityDeployment {
  chainId: 1;
  protocolVersion: "v2";
  deploymentLabel: string;
  sourceObservedAt: string;
  /** Immutable upstream commit of liquity/bold that the manifest was cross-checked against. */
  sourceCommit: string;
  sourceCommitNote: string;
  shared: {
    collateralRegistry: DeploymentContract;
    boldToken: DeploymentContract;
    hintHelpers: DeploymentContract;
    multiTroveGetter: DeploymentContract;
    exchangeHelpers: DeploymentContract;
  };
  branches: Record<BranchId, BranchDeployment>;
}
export interface Trove {
  id: bigint;
  branch: BranchId;
  owner: Address;
  status: TroveStatus;
  collateral: bigint;
  debt: bigint;
  recordedDebt: bigint;
  annualInterestRate: bigint;
  accruedInterest: bigint;
  accruedBatchManagementFee: bigint;
  interestBatchManager: Address;
  /** Batch debt shares recorded for this Trove; zero for non-batch Troves. */
  batchDebtShares: bigint;
}
export interface BranchParameters {
  branch: BranchId; mcr: bigint; ccr: bigint; scr: bigint; bcr: bigint;
  totalDebt: bigint; totalCollateral: bigint; isShutdown: boolean;
}
export type PriceSource = "primary" | "ETHUSDxCanonical" | "lastGoodPrice" | "unknown";
export interface BranchPrice {
  branch: BranchId;
  /** Protocol oracle price of one unit of collateral in USD, 18-decimal fixed point (from PriceFeed.fetchPrice via eth_call). */
  price: bigint;
  /** PriceFeed.lastGoodPrice(). */
  lastGoodPrice: bigint;
  priceSource: PriceSource;
  /** True when this call detected a new oracle failure. The price is then the last good price. */
  oracleFailureDetected: boolean;
}
export interface StabilityPoolState {
  branch: BranchId;
  totalBoldDeposits: bigint;
  collBalance: bigint;
  yieldGainsOwed: bigint;
  yieldGainsPending: bigint;
}
export interface StabilityPoolDeposit {
  branch: BranchId;
  depositor: Address;
  /** Compounded BOLD deposit after liquidation losses. */
  compoundedBoldDeposit: bigint;
  /** Initial deposit value as recorded by the pool (before compounding). */
  initialDeposit: bigint;
  collGain: bigint;
  /** Yield gain not counting yield still pending distribution. */
  yieldGain: bigint;
  yieldGainWithPending: bigint;
  stashedColl: bigint;
}
export interface TroveHealth {
  trove: Trove;
  price: BranchPrice;
  mcr: bigint;
  /** Collateral ratio, 1e18 = 100%. null when debt is zero. */
  collateralRatio: bigint | null;
  /** USD price (1e18) at which ICR falls to MCR. null when collateral is zero. */
  liquidationPrice: bigint | null;
  isBelowMcr: boolean;
}
export interface SortedTrove {
  id: bigint;
  debt: bigint;
  collateral: bigint;
  redistBoldDebtGain: bigint;
  redistCollGain: bigint;
  accruedInterest: bigint;
  recordedDebt: bigint;
  annualInterestRate: bigint;
  accruedBatchManagementFee: bigint;
  lastInterestRateAdjTime: bigint;
  stake: bigint;
  lastDebtUpdateTime: bigint;
  interestBatchManager: Address;
  batchDebtShares: bigint;
  snapshotCollateral: bigint;
  snapshotBoldDebt: bigint;
}
export interface SortedTrovesPage {
  branch: BranchId;
  collateralIndex: bigint;
  /** Contract-native signed start index. Pass the returned nextStartIndex to continue from the same end of the list. */
  startIndex: bigint;
  countRequested: bigint;
  troves: SortedTrove[];
  nextStartIndex: bigint | null;
  hasMore: boolean;
}

export interface TroveRedemptionPosition {
  branch: BranchId;
  troveId: bigint;
  positionFound: boolean;
  /** One-based position in the branch's redemption order (1 = redeemed first). A pending zombie Trove, if any, counts as first. Null if not found. */
  rank: bigint | null;
  targetAnnualInterestRate: bigint | null;
  targetDebt: bigint | null;
  /** Status of the target when it could not be found in the list (zombie, closed, nonExistent...). "active" when found in the list. */
  targetStatus: TroveStatus | null;
  /** Partially redeemed zombie Trove redeemed before any listed Trove, if one is pending on this branch. */
  pendingZombieTroveId: bigint | null;
  pendingZombieDebt: bigint;
  /** Troves redeemed before the target (pending zombie included). */
  trovesAhead: bigint;
  /** Sum of entireDebt of Troves redeemed before the target: pendingZombieDebt + lowerRateDebtAhead + sameRateDebtAhead. */
  debtAhead: bigint;
  /** Listed Troves with a strictly lower rate than the target. */
  lowerRateDebtAhead: bigint;
  /** Listed Troves with the same rate that sit nearer the tail than the target. */
  sameRateDebtAhead: bigint;
  /** Part of debtAhead held by Troves with ICR < 100% at the oracle price; redemptions skip these. */
  belowParityDebtAhead: bigint;
  /** debtAhead minus belowParityDebtAhead: the debt actually reachable before the target right now. */
  redeemableDebtAhead: bigint;
  scannedTroves: bigint;
  scanComplete: boolean;
  /** True when the target was found; debtAhead is then complete for this block. */
  positionComplete: boolean;
}
export interface InterestRateBucket {
  lowerRate: bigint;
  upperRateExclusive: bigint;
  troveCount: bigint;
  totalDebt: bigint;
}
export interface BranchInterestRateAnalysis {
  branch: BranchId;
  complete: boolean;
  scannedTroves: bigint;
  totalDebt: bigint;
  minRate: bigint | null;
  maxRate: bigint | null;
  meanRate: bigint | null;
  debtWeightedMeanRate: bigint | null;
  /** Nearest-rank percentiles by Trove count (1e18 = 100%). */
  percentiles: { p10: bigint | null; p25: bigint | null; p50: bigint | null; p75: bigint | null; p90: bigint | null };
  bucketSize: bigint;
  buckets: InterestRateBucket[];
}

export interface WalletTroveDetails {
  owner: Address;
  branch: BranchId;
  discoveredCount: bigint;
  nftBalance: bigint;
  discoveryComplete: boolean;
  detailsComplete: boolean;
  troves: Trove[];
  scannedFromBlock: bigint;
  scannedToBlock: bigint;
}
export interface WalletTroves {
  owner: Address;
  branch: BranchId;
  troves: Array<{ id: bigint; status: TroveStatus }>;
  /** NFT balance at the pinned block. Compare against troves.length. */
  nftBalance: bigint;
  /** True only if the scanned range covered fromBlock..blockNumber and found as many open Troves as nftBalance. */
  complete: boolean;
  scannedFromBlock: bigint;
  scannedToBlock: bigint;
}
export interface ReadResult<T> { data: T; provenance: ReadProvenance; warnings: string[]; }
export interface ReadOptions {
  /** Pin the read to this block instead of the latest one. Use it to keep several reads consistent. */
  blockNumber?: bigint;
}
