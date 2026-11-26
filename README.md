# Liquity Agent Kit

**A developer toolkit for building AI agents and applications that understand and integrate with Liquity.**

> Status: v0.3.5, read-only. Typed viem readers, a pinned deployment manifest, deterministic math, 16 agent tools and a stdio MCP server, covered by 100+ tests against a mock JSON-RPC node. `npm run smoke` and `npm run live:redemption` have passed against Ethereum mainnet. Not yet exercised live: the pending-zombie-Trove and below-100%-ICR redemption paths (no branch had either at test time). Not audited.
>
> **Unofficial.** This project is not published by, affiliated with or endorsed by Liquity. Outputs are point-in-time reads, not financial advice or redemption forecasts; verify anything you rely on.

## Why it exists

Liquity integrations currently require developers to understand protocol concepts, locate the correct contracts, interpret on-chain state, handle branch-specific behavior, and build their own agent-facing interfaces. The Agent Kit aims to provide reusable, typed building blocks for those tasks.

The first target is **Liquity V2 on Ethereum mainnet**. The architecture should leave room for Liquity V1 and additional deployments later, without implying that every deployment has the same contract surface.

## What it is — and is not

- **Agent Kit:** reusable SDKs, typed protocol models, verified deployment metadata, machine-readable capability descriptions, examples, and optional agent adapters.
- **BOLD Guardian:** an application that can consume the Agent Kit for monitoring, rate intelligence, and borrower-focused analysis.
- **Guardian MCP:** a specific service exposing Guardian's own data and calculations.
- **Liquity documentation MCP:** Liquity's documentation site already exposes an MCP endpoint for documentation retrieval. The Agent Kit is not intended to duplicate that documentation search service; it focuses on reusable integration primitives and executable workflows.

This is an independent community project unless and until an official relationship is established. It must not imply endorsement by Liquity.

## Design principles

1. **Correctness before convenience.** Every value must identify its source, chain, block, units, and freshness where relevant.
2. **Read-only first.** V1 will read protocol state and perform local deterministic calculations. It will not hold keys, sign transactions, or submit transactions.
3. **Explicit branch awareness.** Shared contracts and collateral-branch contracts must not be conflated.
4. **Agent-readable, developer-usable.** Provide ordinary typed APIs and machine-readable schemas, not only prompts.
5. **No silent assumptions.** Unknown, stale, unavailable, or estimated values remain distinguishable from zero or verified on-chain values.
6. **Generated from authoritative sources where possible.** Contract ABIs, deployment addresses, and protocol constants must be traceable to pinned upstream revisions and independently checked.

## Package layout

A single package for now (`liquity-agent-kit`); the modules below are directories, not separately published packages.

| Package | Responsibility | Initial status |
|---|---|---|
| `core` (`src/core`) | Domain types, units, errors, branch/number parsing, fixed-point math | Implemented |
| `evm` (`src/evm`) | Mainnet client, deployment registry, block-pinned readers | Implemented |
| `agent-tools` (`src/agent-tools`) | Executable tool definitions, JSON Schemas, generated catalog | Implemented |
| `mcp-adapter` (`src/mcp`) | Stdio MCP server over the same tool functions; read/compute tools only, all marked read-only | Implemented (tested in-process and over stdio; not yet tried in a real agent client) |

## V1 target — status

| Capability | Status |
|---|---|
| Versioned deployment registry, pinned to an upstream commit | Done (manifest cross-checked against upstream; code confirmed at every address on mainnet) |
| Shared vs branch contracts resolved separately | Done (`liquity_get_protocol_contracts`) |
| BOLD token and branch parameters | Done |
| Trove by ID, Trove health (ratio, liquidation price) | Done |
| Oracle price with fallback detection | Done |
| Wallet-owned Troves | Done (bounded log scan, owner/status reconciliation, completeness check; needs `fromBlock`) |
| Sorted Trove pages | Done (`MultiTroveGetter`, on-chain collateral-index resolution, bounded page reads) |
| Stability Pool state and account deposits | Done |
| Collateral ratio, liquidation price, simple interest | Done |
| JSON Schemas + executable tools | Done (`executeTool`, `schemas/capability-catalog.json`) |
| MCP adapter | Done (`npm run mcp`; see below) |
| Write planning | Not started |
| Live mainnet validation | **Partial** — `npm run smoke`, `npm run live:redemption` and `liquity_get_trove_health` pass live; wallet-Trove scan (needs a wide-`eth_getLogs` RPC) and interest-rate tool not yet verified live |

### Running the MCP server

```
ETH_RPC_URL=https://... npm run mcp      # all read tools
npm run mcp                              # without an RPC: calculation and discovery tools only
```

Configure an MCP client to launch that command (stdio) from the project folder. The server exposes only tools whose side effect is `read` or `compute`, marks them read-only, and never prints the RPC URL. Optional live checks: `npm run smoke` and `npm run live:redemption`.

See [the product specification](docs/PRODUCT_SPEC.md), [architecture](docs/ARCHITECTURE.md), [roadmap](ROADMAP.md) and [implementation status](docs/IMPLEMENTATION_STATUS.md).

## Install and check

```bash
npm install
npm run check      # typecheck (src, tests, scripts, examples) + tests
npm run build
npm run catalog    # regenerate schemas/capability-catalog.json after editing tools
npm run abi:extract -- /path/to/liquity-bold   # regenerate test/fixtures/upstream-abi-signatures.json after changing sourceCommit
ETH_RPC_URL=https://... npm run smoke   # live checks: contract code at every registry address, readers, oracle
```

Requires Node >= 20.11.

## Use it as a library

```ts
import { createLiquityClient, getTroveHealth, getWalletTroves, getSortedTrovesPage } from "liquity-agent-kit";

const client = createLiquityClient({ rpcUrl: process.env.ETH_RPC_URL! });

// Trove IDs are 256-bit hashes (not small integers). Find yours with getWalletTroves or the Liquity app.
// fromBlock must be at or before the branch was deployed; look the deployment block up on a block explorer.
const DEPLOYMENT_BLOCK = 0n; // placeholder: 0n is correct but slow, and most providers cap log ranges
const owned = await getWalletTroves(client, "WETH", "0xYourWallet...", { fromBlock: DEPLOYMENT_BLOCK, maxBlockRange: 10_000n, maxRequests: 5_000 });
if (!owned.data.complete) console.warn("list may be incomplete", owned.warnings);

const health = await getTroveHealth(client, "WETH", owned.data.troves[0]!.id);
const page = await getSortedTrovesPage(client, "WETH", 0n, 50n);
if (page.data.nextStartIndex !== null) { /* request the next page with that index */ }
console.log(health.data.collateralRatio, health.data.liquidationPrice, health.provenance, health.warnings);
```

Every reader takes `{ blockNumber }` to pin the read; composite readers such as `getTroveHealth` read everything at one block and return that block's number, hash and timestamp.

## Use it from an agent

```ts
import { agentToolCatalog, executeTool, createLiquityClient } from "liquity-agent-kit";
// give agentToolCatalog to your LLM API as tool definitions, then:
const outcome = await executeTool("liquity_get_branch_price", { branch: "WETH" }, { client });
// -> { ok: true, result: { data, provenance, warnings } }  or  { ok: false, error: { code, message } }
```

All integers cross the tool boundary as decimal strings. Inputs are validated against the schema and rejected (not coerced) when wrong, including JSON numbers for amounts and non-listed branch names. See `examples/` for complete scripts and `examples/agent-workflows.md` for suggested agent procedures.

## Tools

| Tool | Class | Purpose |
|---|---|---|
| `liquity_get_supported_deployments` | compute | Supported networks/versions and source commit |
| `liquity_get_protocol_contracts` | compute | Shared + branch contract addresses |
| `liquity_get_bold_token_info` | read | BOLD metadata and supply |
| `liquity_get_trove` | read | Trove state by branch and ID |
| `liquity_get_trove_health` | read | Trove + oracle price + MCR at one block, with ratio and liquidation price |
| `liquity_get_branch_parameters` | read | MCR/CCR/SCR/BCR, branch debt/collateral, shutdown |
| `liquity_get_branch_price` | read | Protocol oracle price, last good price, price source |
| `liquity_get_stability_pool_state` | read | Pool totals |
| `liquity_get_stability_pool_position` | read | One address's deposit and gains |
| `liquity_get_wallet_troves` | read | Open Troves for a wallet on a branch |
| `liquity_get_wallet_trove_details` | read | Discover and hydrate a wallet’s Troves with debt, collateral, rate and batch data |
| `liquity_get_sorted_troves_page` | read | Bounded page from the protocol-sorted Trove list, including batch metadata |
| `liquity_calculate_trove_metrics` | compute | Ratio and liquidation price from supplied numbers |
| `liquity_estimate_simple_interest` | compute | Simple-interest estimate (assumptions returned) |

## Known limits

- **ABIs are machine-checked against upstream source, not generated from it.** `npm run abi:extract -- <bold checkout>` parses the pinned `liquity/bold` Solidity into a signature fixture, and `test/abi-drift.test.ts` compares every function in the hand-written ABIs (types, tuple layout, mutability) to it. Regenerate the fixture whenever `sourceCommit` changes.
- **Live validation is partial.** `npm run smoke` and `npm run live:redemption` pass against Ethereum mainnet (see `docs/IMPLEMENTATION_STATUS.md`). Not yet run live: the wallet-Trove log scan (blocked by a Free-tier RPC log-range cap), the interest-rate analysis tool, and any state with a pending zombie Trove or a Trove below 100% ICR (those paths are verified against a mock JSON-RPC node only; the mock uses the same ABIs as the code, so ABI drift is guarded separately by `test/abi-drift.test.ts`, which compares against upstream Solidity at the pinned commit, not the deployed bytecode).
- **Upstream `main` may be ahead of what is deployed.** The pinned commit is the manifest's source, not a guarantee of the deployed bytecode.
- **Oracle price is a simulation.** `PriceFeed.fetchPrice` is state-changing upstream; the kit calls it with `eth_call` only. If your RPC provider rejects simulating it, the price tools fail rather than substituting another source.
- **Sorted Trove pages are bounded.** `liquity_get_sorted_troves_page` reads at most 500 entries per call. It resolves the branch collateral index from the on-chain CollateralRegistry at the same pinned block. The contract-native signed index is returned; consumers should use `nextStartIndex` rather than guessing pagination semantics.
- **Wallet discovery is log-based.** It depends on `eth_getLogs` range limits of your provider and on a correct `fromBlock`; it reports `complete: false` when the NFT balance disagrees with what was found.
- **Estimates are estimates.** Interest is simple, excludes batch and upfront fees; collateral ratio is point-in-time at the protocol oracle price.
- No writes, wallet clients, keys, signing or transaction submission, and none planned before Phase 4.

See `SOURCE_NOTES.md` for provenance.


## Redemption position and interest-rate analysis

- `liquity_get_trove_redemption_position` walks the branch's sorted list from the **tail** (lowest interest rate, redeemed first) and sums the entire debt of every Trove redeemed before the target. `SortedTroves` is descending by rate and `redeemCollateral` starts at `getLast()`, so higher-rate Troves are never counted. It separates strictly lower-rate debt from equal-rate Troves that sit nearer the tail. `rank` 1 = first to be redeemed. It also follows two rules from `TroveManager.redeemCollateral`: a pending partially-redeemed *zombie* Trove (`lastZombieTroveId`, removed from the list) is redeemed before everything else and is counted in `debtAhead`; and Troves with ICR below 100% at the oracle price are skipped, so their debt is reported as `belowParityDebtAhead` and excluded from `redeemableDebtAhead`.
- `liquity_analyze_branch_interest_rates` scans a branch and reports min/max, nearest-rank p10/p25/p50/p75/p90, arithmetic mean, debt-weighted mean and a configurable rate histogram (default bucket width 1 percentage point).
- Both scans are pinned to one block and bounded by `maxTroves` (default 10,000; maximum 100,000). Check `positionComplete` or `complete`; truncated results must not be presented as full-branch results.
- Each page read walks the list inside one `eth_call`, so deep scans cost more gas per call; large `maxTroves` values may hit your provider's `eth_call` gas limit. This is untested live.
- Debt ahead is branch-local and point-in-time. It is not a redemption prediction: actual redemption depends on cross-branch routing, redemption size and fee, branch status, eligibility and transaction-time state.

## Known issues

- `npm audit` reports 3 findings (1 moderate, 2 critical) in the **dev-only** test tooling (`vitest`, `@vitest/mocker`, `tinypool`). They do not ship in the library or the MCP server. The suggested fix is vitest 5, which requires Node 22.12 or newer, so it was not applied here (the kit supports Node 20.11+); an attempt to move to a 4.x release failed in this environment with an npm error and was not pursued further.
- The redemption-position tools describe the **current branch queue only**. They do not model cross-branch routing, redemption fees or future state changes.
- `liquity_get_wallet_troves` finds Troves by scanning `eth_getLogs`. Some RPC plans (notably free tiers) cap the block range or result size of a log query, which makes a wide scan fail. Errors now include the provider's reason. Confirmed live: Alchemy's **Free tier allows only 10 blocks per `eth_getLogs` request**, so wallet discovery over a wide range cannot run on that plan (it needs a paid plan or a provider with wider log ranges). Start `fromBlock` close to when the Trove was opened, lower `maxBlockRange` to what your plan allows, or use a provider that permits wide log ranges.
