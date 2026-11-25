import type { Address, PublicClient } from "viem";
import { LiquityAgentKitError, type LiquityAgentKitErrorCode } from "../core/errors.js";
import { parseBranchId, parseUint } from "../core/branches.js";
import { collateralRatio, estimateSimpleInterest, liquidationPrice } from "../core/math.js";
import { BRANCH_IDS, type SideEffect } from "../core/types.js";
import { LIQUITY_V2_MAINNET } from "../evm/deployments.js";
import { parseAddress } from "../evm/pin.js";
import {
  getBoldTokenInfo, getBranchParameters, getBranchPrice, getStabilityPoolDeposit, getStabilityPoolState,
  getTrove, getTroveHealth, getWalletTroves, getWalletTroveDetails, getSortedTrovesPage, getTroveRedemptionPosition, analyzeBranchInterestRates
} from "../evm/reads.js";

export interface JsonSchemaObject {
  type: "object";
  properties: Record<string, { type: "string"; description?: string; enum?: readonly string[]; pattern?: string }>;
  required?: readonly string[];
  additionalProperties: false;
}
export interface AgentTool {
  name: string;
  group: "discovery" | "read" | "calculate";
  sideEffects: SideEffect;
  description: string;
  inputSchema: JsonSchemaObject;
  /** Needs an RPC client. Compute and discovery tools do not. */
  requiresClient: boolean;
  run(args: Record<string, unknown>, client: PublicClient | undefined): Promise<unknown>;
}
export type ToolOutcome =
  | { ok: true; result: unknown }
  | { ok: false; error: { code: LiquityAgentKitErrorCode; message: string } };

const UINT = "^[0-9]+$";
const branchProp = { type: "string", enum: BRANCH_IDS, description: "Collateral branch." } as const;
const blockProp = { type: "string", pattern: UINT, description: "Optional block number (decimal string) to pin the read to. Defaults to the latest block." } as const;
const addressProp = (what: string) => ({ type: "string", pattern: "^0x[0-9a-fA-F]{40}$", description: `${what} (0x-prefixed, 20 bytes).` }) as const;
const intProp = (what: string) => ({ type: "string", pattern: "^-?[0-9]+$", description: `${what}. Signed decimal integer string; never a JSON number.` }) as const;
const uintProp = (what: string) => ({ type: "string", pattern: UINT, description: `${what}. Non-negative decimal integer string; never a JSON number.` }) as const;

/** Recursively converts bigint to decimal strings so results are JSON-safe without precision loss. */
export function toJsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toJsonSafe(v)]));
  return value;
}

function validateAgainstSchema(schema: JsonSchemaObject, args: Record<string, unknown>) {
  for (const key of Object.keys(args)) {
    if (!(key in schema.properties)) throw new LiquityAgentKitError("INVALID_INPUT", `Unexpected input "${key}".`);
  }
  for (const key of schema.required ?? []) {
    if (args[key] === undefined) throw new LiquityAgentKitError("INVALID_INPUT", `Missing required input "${key}".`);
  }
  for (const [key, prop] of Object.entries(schema.properties)) {
    const v = args[key];
    if (v === undefined) continue;
    if (typeof v !== "string") throw new LiquityAgentKitError("INVALID_INPUT", `Input "${key}" must be a string.`);
    if (prop.enum && !prop.enum.includes(v)) throw new LiquityAgentKitError("INVALID_INPUT", `Input "${key}" must be one of ${prop.enum.join(", ")}.`);
    if (prop.pattern && !new RegExp(prop.pattern).test(v)) throw new LiquityAgentKitError("INVALID_INPUT", `Input "${key}" has an invalid format.`);
  }
}

const opt = (args: Record<string, unknown>) => (args.blockNumber === undefined ? {} : { blockNumber: parseUint(args.blockNumber, "blockNumber") });
const need = (client: PublicClient | undefined): PublicClient => {
  if (!client) throw new LiquityAgentKitError("INVALID_INPUT", "This tool reads on-chain state and needs an RPC client.");
  return client;
};
const schema = (properties: JsonSchemaObject["properties"], required: string[] = []): JsonSchemaObject => ({ type: "object", properties, required, additionalProperties: false });

export const agentTools: readonly AgentTool[] = [
  {
    name: "liquity_get_supported_deployments", group: "discovery", sideEffects: "compute", requiresClient: false,
    description: "List the Liquity deployments this kit supports (currently V2 on Ethereum mainnet) with the upstream source commit and per-address verification label. Use first to confirm network support. Static data; no RPC.",
    inputSchema: schema({}),
    async run() {
      const d = LIQUITY_V2_MAINNET;
      return { deployments: [{ chainId: d.chainId, protocolVersion: d.protocolVersion, label: d.deploymentLabel, sourceCommit: d.sourceCommit, sourceCommitNote: d.sourceCommitNote, branches: BRANCH_IDS }] };
    }
  },
  {
    name: "liquity_get_protocol_contracts", group: "discovery", sideEffects: "compute", requiresClient: false,
    description: "Return shared contract addresses and the addresses of one branch's contracts (TroveManager, BorrowerOperations, StabilityPool, PriceFeed, ...). Shared and branch contracts are returned separately. Addresses are from the pinned repository manifest, not live-verified. Static data; no RPC.",
    inputSchema: schema({ branch: branchProp }, ["branch"]),
    async run(args) {
      const branch = parseBranchId(args.branch);
      return { shared: LIQUITY_V2_MAINNET.shared, branch: LIQUITY_V2_MAINNET.branches[branch], sourceCommit: LIQUITY_V2_MAINNET.sourceCommit };
    }
  },
  {
    name: "liquity_get_bold_token_info", group: "read", sideEffects: "read", requiresClient: true,
    description: "Read BOLD token symbol, decimals and total supply (base units, 18 decimals) on Ethereum mainnet.",
    inputSchema: schema({ blockNumber: blockProp }),
    run: (args, client) => getBoldTokenInfo(need(client), opt(args))
  },
  {
    name: "liquity_get_trove", group: "read", sideEffects: "read", requiresClient: true,
    description: "Read an open Liquity V2 Trove by branch and Trove ID. Returns owner, status, collateral and debt (1e18 base units), annual interest rate (1e18 = 100%), accrued interest and batch manager. Trove IDs are 256-bit hashes, not small sequential numbers: pass them as decimal strings.",
    inputSchema: schema({ branch: branchProp, troveId: uintProp("Trove NFT ID"), blockNumber: blockProp }, ["branch", "troveId"]),
    run: (args, client) => getTrove(need(client), parseBranchId(args.branch), parseUint(args.troveId, "troveId"), opt(args))
  },
  {
    name: "liquity_get_trove_health", group: "read", sideEffects: "read", requiresClient: true,
    description: "Read a Trove, its branch's protocol oracle price and MCR at ONE block, and derive collateral ratio (1e18 = 100%) and liquidation price (USD, 1e18). Price is the protocol oracle, not a market price. A ratio above MCR does not prove the position is safe.",
    inputSchema: schema({ branch: branchProp, troveId: uintProp("Trove NFT ID"), blockNumber: blockProp }, ["branch", "troveId"]),
    run: (args, client) => getTroveHealth(need(client), parseBranchId(args.branch), parseUint(args.troveId, "troveId"), opt(args))
  },
  {
    name: "liquity_get_branch_parameters", group: "read", sideEffects: "read", requiresClient: true,
    description: "Read on-chain MCR, CCR, SCR, BCR (1e18 = 100%), total branch debt and collateral (1e18 base units) and shutdown status for a branch.",
    inputSchema: schema({ branch: branchProp, blockNumber: blockProp }, ["branch"]),
    run: (args, client) => getBranchParameters(need(client), parseBranchId(args.branch), opt(args))
  },
  {
    name: "liquity_get_branch_price", group: "read", sideEffects: "read", requiresClient: true,
    description: "Read the protocol oracle price for a branch's collateral (USD, 1e18) via an eth_call simulation of PriceFeed.fetchPrice, plus lastGoodPrice and price source. Warns when the feed is not on its primary oracle. Nothing is sent on-chain.",
    inputSchema: schema({ branch: branchProp, blockNumber: blockProp }, ["branch"]),
    run: (args, client) => getBranchPrice(need(client), parseBranchId(args.branch), opt(args))
  },
  {
    name: "liquity_get_stability_pool_state", group: "read", sideEffects: "read", requiresClient: true,
    description: "Read a branch's Stability Pool totals: total BOLD deposits, collateral balance and yield gains owed/pending (1e18 base units).",
    inputSchema: schema({ branch: branchProp, blockNumber: blockProp }, ["branch"]),
    run: (args, client) => getStabilityPoolState(need(client), parseBranchId(args.branch), opt(args))
  },
  {
    name: "liquity_get_stability_pool_position", group: "read", sideEffects: "read", requiresClient: true,
    description: "Read one address's Stability Pool position on a branch: compounded BOLD deposit, initial deposit, collateral gain, yield gain (with and without pending) and stashed collateral (1e18 base units).",
    inputSchema: schema({ branch: branchProp, depositor: addressProp("Depositor address"), blockNumber: blockProp }, ["branch", "depositor"]),
    run: (args, client) => getStabilityPoolDeposit(need(client), parseBranchId(args.branch), parseAddress(args.depositor, "depositor") as Address, opt(args))
  },
  {
    name: "liquity_get_sorted_troves_page", group: "read", sideEffects: "read", requiresClient: true,
    description: "Read a bounded page from Liquity V2's on-chain sorted Trove list for a collateral branch using MultiTroveGetter. Returns Trove IDs, current aggregate debt/collateral, effective annual rate, accrued interest/fees and batch metadata at one pinned block. The startIndex is the contract's signed list index; continue with nextStartIndex when returned. List order is protocol state, not a prediction of redemption execution.",
    inputSchema: schema({ branch: branchProp, startIndex: intProp("Signed MultiTroveGetter start index"), count: uintProp("Number of Troves to return, 1–500"), blockNumber: blockProp }, ["branch", "startIndex", "count"]),
    run: (args, client) => getSortedTrovesPage(need(client), parseBranchId(args.branch), BigInt(args.startIndex as string), parseUint(args.count, "count"), opt(args))
  },
  {
    name: "liquity_get_wallet_troves", group: "read", sideEffects: "read", requiresClient: true,
    description: "Find open Troves owned by a wallet on one branch by scanning TroveNFT Transfer logs from fromBlock, then reconciling with current status, ownerOf and balanceOf. Check `complete`: false means the list may be missing Troves. Bounded by maxRequests; fails rather than truncating.",
    inputSchema: schema({
      branch: branchProp, owner: addressProp("Wallet address"),
      fromBlock: uintProp("First block to scan for transfers (at or before the branch deployment)"),
      maxBlockRange: uintProp("Optional blocks per log request, default 10000"),
      maxRequests: uintProp("Optional cap on log requests, default 500"),
      blockNumber: blockProp
    }, ["branch", "owner", "fromBlock"]),
    run: (args, client) => getWalletTroves(need(client), parseBranchId(args.branch), parseAddress(args.owner, "owner"), {
      fromBlock: parseUint(args.fromBlock, "fromBlock"),
      ...(args.maxBlockRange === undefined ? {} : { maxBlockRange: parseUint(args.maxBlockRange, "maxBlockRange") }),
      ...(args.maxRequests === undefined ? {} : { maxRequests: Number(parseUint(args.maxRequests, "maxRequests")) }),
      ...opt(args)
    })
  },
  {
    name: "liquity_get_wallet_trove_details", group: "read", sideEffects: "read", requiresClient: true,
    description: "Discover a wallet's open Troves on one branch and hydrate each with full Trove data (collateral, debt, recorded debt, effective annual rate, accrued interest, batch management fee, batch manager and batch debt shares). All reads use one pinned block. Requires fromBlock; check discoveryComplete and detailsComplete before treating the result as exhaustive. Hydration is capped at maxTroves (default 25, maximum 100).",
    inputSchema: schema({ branch: branchProp, owner: addressProp("Wallet address"), fromBlock: uintProp("First block to scan for transfers (at or before branch deployment)"), maxBlockRange: uintProp("Optional blocks per log request"), maxRequests: uintProp("Optional cap on log requests"), maxTroves: uintProp("Optional maximum Troves to hydrate, 1–100"), blockNumber: blockProp }, ["branch", "owner", "fromBlock"]),
    run: (args, client) => getWalletTroveDetails(need(client), parseBranchId(args.branch), parseAddress(args.owner, "owner"), {
      fromBlock: parseUint(args.fromBlock, "fromBlock"),
      ...(args.maxBlockRange === undefined ? {} : { maxBlockRange: parseUint(args.maxBlockRange, "maxBlockRange") }),
      ...(args.maxRequests === undefined ? {} : { maxRequests: Number(parseUint(args.maxRequests, "maxRequests")) }),
      ...(args.maxTroves === undefined ? {} : { maxTroves: Number(parseUint(args.maxTroves, "maxTroves")) }),
      ...opt(args)
    })
  },
  {
    name: "liquity_get_trove_redemption_position", group: "read", sideEffects: "read", requiresClient: true,
    description: "Walk a branch's on-chain sorted Trove list from its tail (the end redeemed first: lowest interest rate) and calculate a Trove's branch-local redemption rank (1 = redeemed first) and the BOLD debt redeemed before it. Includes lower-rate Troves, same-rate Troves ordered nearer the tail, and the branch's pending partially-redeemed zombie Trove (redeemed first); higher-rate Troves are excluded. Debt held by Troves with ICR below 100% (skipped by redemptions) is reported separately: use redeemableDebtAhead for what is reachable now. Point-in-time, branch-local figure, not a redemption forecast; bounded by maxTroves (default 10000, maximum 100000). Check positionComplete.",
    inputSchema: schema({ branch: branchProp, troveId: uintProp("Trove NFT ID"), maxTroves: uintProp("Maximum Troves to scan, default 10000, maximum 100000"), blockNumber: blockProp }, ["branch", "troveId"]),
    run: (args, client) => getTroveRedemptionPosition(need(client), parseBranchId(args.branch), parseUint(args.troveId, "troveId"), {
      ...(args.maxTroves === undefined ? {} : { maxTroves: Number(parseUint(args.maxTroves, "maxTroves")) }), ...opt(args)
    })
  },
  {
    name: "liquity_analyze_branch_interest_rates", group: "read", sideEffects: "read", requiresClient: true,
    description: "Scan the branch's on-chain sorted Trove list and calculate rate min/max, nearest-rank p10/p25/p50/p75/p90, arithmetic and debt-weighted mean, and a debt/count histogram. Rates use 1e18 = 100%; default histogram width is 1 percentage point. Bounded by maxTroves (default 10000, maximum 100000); check complete before treating statistics as branch-wide.",
    inputSchema: schema({ branch: branchProp, maxTroves: uintProp("Maximum Troves to scan, default 10000, maximum 100000"), bucketSize: uintProp("Optional histogram bucket width in 1e18-scaled annual-rate units; default 10000000000000000 (1 percentage point)"), blockNumber: blockProp }, ["branch"]),
    run: (args, client) => analyzeBranchInterestRates(need(client), parseBranchId(args.branch), {
      ...(args.maxTroves === undefined ? {} : { maxTroves: Number(parseUint(args.maxTroves, "maxTroves")) }),
      ...(args.bucketSize === undefined ? {} : { bucketSize: parseUint(args.bucketSize, "bucketSize") }), ...opt(args)
    })
  },
  {
    name: "liquity_calculate_trove_metrics", group: "calculate", sideEffects: "compute", requiresClient: false,
    description: "Pure calculation. collateralRatio = collateral*price/debt (1e18 = 100%, rounded down; null if debt is 0). liquidationPrice = debt*mcr/collateral (USD 1e18, rounded up; null if collateral is 0). Inputs are 1e18-scaled integers. Does not read chain state.",
    inputSchema: schema({ collateral: uintProp("Collateral amount, 1e18 base units"), debt: uintProp("Debt in BOLD, 1e18 base units"), price: uintProp("Collateral price in USD, 1e18"), mcr: uintProp("Minimum collateral ratio, 1e18 = 100%") }, ["collateral", "debt", "price", "mcr"]),
    async run(args) {
      const collateral = parseUint(args.collateral, "collateral"), debt = parseUint(args.debt, "debt");
      const price = parseUint(args.price, "price"), mcr = parseUint(args.mcr, "mcr");
      const ratio = collateralRatio(collateral, price, debt);
      return { collateralRatio: ratio, liquidationPrice: liquidationPrice(debt, mcr, collateral), isBelowMcr: ratio !== null && ratio < mcr,
        assumptions: ["Inputs are caller-supplied; no on-chain state was read.", "Point-in-time figure; does not predict liquidation."] };
    }
  },
  {
    name: "liquity_estimate_simple_interest", group: "calculate", sideEffects: "compute", requiresClient: false,
    description: "Pure calculation. Simple-interest estimate: debt*annualRate*days/(1e18*365), rounded down, in BOLD base units. Excludes compounding, batch management fees, upfront fees and any future debt change. Does not read chain state.",
    inputSchema: schema({ debt: uintProp("Debt in BOLD, 1e18 base units"), annualRate: uintProp("Annual interest rate, 1e18 = 100%"), days: uintProp("Number of days") }, ["debt", "annualRate", "days"]),
    async run(args) {
      const interest = estimateSimpleInterest(parseUint(args.debt, "debt"), parseUint(args.annualRate, "annualRate"), parseUint(args.days, "days"));
      return { interest, assumptions: ["Simple (non-compounded) interest on constant debt.", "Excludes batch management fees, upfront fees and redemptions."] };
    }
  }
];

export function getAgentTool(name: string): AgentTool | undefined {
  return agentTools.find((t) => t.name === name);
}

/** Validates input, runs the tool and returns JSON-safe output. Known failures come back as `{ ok: false }` with a stable error code. */
export async function executeTool(name: string, args: Record<string, unknown>, context: { client?: PublicClient } = {}): Promise<ToolOutcome> {
  try {
    const tool = getAgentTool(name);
    if (!tool) throw new LiquityAgentKitError("UNKNOWN_TOOL", `Unknown tool: ${name}.`);
    validateAgainstSchema(tool.inputSchema, args ?? {});
    return { ok: true, result: toJsonSafe(await tool.run(args ?? {}, context.client)) };
  } catch (error) {
    if (error instanceof LiquityAgentKitError) return { ok: false, error: { code: error.code, message: error.message } };
    return { ok: false, error: { code: "INTERNAL_ERROR", message: error instanceof Error ? error.message : "Unexpected error." } };
  }
}
