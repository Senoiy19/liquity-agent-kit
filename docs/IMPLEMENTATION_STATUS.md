# Implementation and verification status (v0.3.5)

## Implemented

- Mainnet-only viem client; every read verifies chain ID 1.
- Deployment registry pinned to `liquity/bold` commit `d262669ef3c4d37bf0544df3bb2624c07b8a5ee0`.
- Readers: BOLD token, Trove by ID, Trove health, branch parameters, oracle price (eth_call simulation of `fetchPrice` + `lastGoodPrice` + `priceSource`), Stability Pool state and per-address deposit, wallet-owned Troves and wallet Trove detail hydration; bounded sorted-Trove pages via `MultiTroveGetter`.
- Every reader accepts `{ blockNumber }`; composite reads use one block. Provenance carries chain, block number/hash, block timestamp, local observation time and the contracts queried.
- Fixed-point math (collateral ratio rounds down; liquidation price rounds up; simple interest rounds down).
- 16 agent tools with closed JSON Schemas, one executor (`executeTool`) with schema validation, bigint-safe JSON output and stable error codes. `schemas/capability-catalog.json` is generated from the tool definitions and a test fails if it drifts.

## Verification in this workspace (2026-11-24)

| Check | Result |
|---|---|
| Clean `npm ci`, full typecheck (src, tests, scripts, examples) | clean |
| Vitest unit + mock-RPC suite | all passing (`npm test`) |
| Registry addresses vs upstream `frontend/app/.env` at the pinned commit | 32/32 match (frozen in `test/fixtures/upstream-manifest.json`) |
| `MultiTroveGetter.getMultipleSortedTroves`, `CombinedTroveData`, `CollateralRegistry.totalCollaterals/getToken` vs upstream Solidity at the pinned commit | matched by reading source, including signed-index semantics (>=0 from head, <0 from tail) |
| Live Ethereum mainnet RPC | `npm run smoke` passed (code at all 28 manifest addresses, BOLD token, branch parameters, oracle price, Stability Pool, sorted-list head/tail ordering, tail Trove rank 1 on WETH/wstETH/rETH). `npm run live:redemption` passed on all three branches (rank, debt ahead, rate split and redeemable debt cross-checked against an independent list walk at depths 0, 1 and 10 where the list was deep enough). Run 2026-11-24/25 by the maintainer against an Alchemy endpoint. |

v0.3.0 as first delivered did not compile: `getWalletTroveDetails` was documented, registered as a tool and tested but not implemented, and one type was misnamed. v0.3.1 implements it and fixes the names; the 0.3.0 "not run" status above is superseded.

## Not verified

- **Live coverage is partial.** Not yet run against a live chain: `liquity_get_trove_health`, `liquity_get_wallet_troves` (log scan), `liquity_analyze_branch_interest_rates`, Stability Pool account deposits, and any state with a **pending zombie Trove** or a **Trove below 100% ICR ahead of the target** (neither existed on any branch when the live checks ran, so those code paths are verified against mocks only).
- That deployed bytecode matches `main` at the pinned commit (the manifest, not the Solidity, was matched).
- Behaviour of specific RPC providers (log-range limits, simulating `fetchPrice`).
- `MultiTroveGetter.getMultipleSortedTroves` has a bounded page reader. Its ABI matches the upstream Solidity at the pinned commit; deployed-bytecode and live-call behaviour still need validation. `HintHelpers` and `ExchangeHelpers` remain registered but have no readers.

## v0.3 additions

- Added `liquity_get_sorted_troves_page` using the ABI published for the verified `MultiTroveGetter.getMultipleSortedTroves` contract. The branch collateral index is resolved from `CollateralRegistry.getToken(i)` at the same pinned block.
- Added `liquity_get_wallet_trove_details`, which discovers and hydrates a bounded wallet Trove list at one pinned block.
- Exposed batch debt shares in single-Trove reads.
- Wallet candidate reconciliation now uses bounded concurrency (8 candidates at a time) rather than serial RPC calls. Detail hydration is bounded to five concurrent Troves.
- Added tests for page reads, batch metadata, bounds and JSON-safe tool output.

## Release gate

Do not tag a stable release or call capabilities production-ready until `npm run smoke` passes against a mainnet RPC (**done**), with at least one real Trove checked end-to-end through `liquity_get_trove_health` and one wallet through `liquity_get_wallet_troves` (**not yet done**).


## v0.3.2 additions

- `liquity_get_trove_redemption_position`: scans from the **tail** of a branch's on-chain sorted list (negative, tail-relative `MultiTroveGetter` index), finds the target Trove and sums the entireDebt of every Trove redeemed before it. Reports lower-rate and same-rate debt separately; same-rate Troves count only if they sit nearer the tail. Branch-local, point-in-time and bounded.
- `liquity_analyze_branch_interest_rates`: scans a branch's sorted list and calculates min/max, nearest-rank count percentiles (p10/p25/p50/p75/p90), arithmetic mean, debt-weighted mean and configurable histogram buckets.
- Both tools use one pinned block, default to a 10,000 Trove scan cap, and expose completeness flags rather than silently presenting truncated data as complete.
- These are current-state analyses, not predictions. Actual redemption execution depends on collateral-branch routing, redemption amount/fee, branch status, eligibility and transaction-time state.

## v0.3.5 verification status

| Check | Result |
|---|---|
| Clean typecheck (src, tests, scripts, examples) | clean |
| Vitest unit + mock-RPC suite | all passing (`npm test`) |
| ABI fragments vs upstream Solidity at the pinned commit | 28/28 functions match (types, tuple layout, mutability) via `test/abi-drift.test.ts`; the test is proven to detect wrong widths, wrong mutability, reordered and dropped struct fields |
| Redemption direction vs upstream source | `SortedTroves.sol`: "sorted in descending order"; `TroveManager.redeemCollateral` starts at `sortedTroves.getLast()` and steps with `getPrev` |
| Tests detect the v0.3.2 inversion | yes: restoring the head-first walk makes 3 tests fail |
| Live Ethereum RPC | **Not run.** `npm run smoke` now also checks list ordering live (head non-increasing, tail non-decreasing, tail Trove ranks 1). |

### Correction to v0.3.2

v0.3.2 walked the list from the head and treated the Troves in front of the target as "ahead" in the redemption queue. Because the list is descending by rate and redemption starts at the tail, those are the Troves redeemed *after* the target, so `debtAhead` was inverted and `lowerRateDebtAhead` would have been zero on real data. Its test passed only because the mock list was ascending. v0.3.3 walks from the tail and the tests use the real descending order.

### v0.3.5: MCP adapter and live redemption check

- Added `src/mcp` (`npm run mcp`): a stdio MCP server over the shared tool definitions. It exposes only `read`/`compute` tools, annotates them read-only, lists RPC-needing tools only when `ETH_RPC_URL` is set, and returns validation errors as tool errors with the kit's stable codes. Verified with in-memory client tests and a real stdio round trip; not yet tried in MCP Inspector or an agent client.
- Added `npm run live:redemption`: queries Troves at several depths from the tail on each branch and cross-checks rank, debt ahead, lower/same-rate split, below-100% debt and redeemable debt against an independent walk of the sorted list at one pinned block. Run against mainnet and passed on all three branches; the pending-zombie and below-100%-ICR branches of the check were not triggered because no branch had either condition at the time.

- Pre-submission audit fixes (no version bump): a pending-zombie **target** below 100% ICR now warns that redemptions skip it (upstream applies the ICR check to the zombie too); a **zero oracle price** no longer marks every Trove as below 100% ICR (the filter is skipped, `redeemableDebtAhead` equals `debtAhead`, and a warning says so); stale "not live-validated" claims in the README, roadmap and this file were corrected. Two new tests (109 total).

### v0.3.4: redemption rules and ABI drift check

- Reading the redemption loop in `TroveManager.redeemCollateral` showed two rules v0.3.3 ignored. **Pending zombie:** `lastZombieTroveId` is redeemed before the tail, and zombies are removed from `SortedTroves`, so they never appear in a list scan. **ICR < 100%:** such Troves are skipped. v0.3.4 reads `lastZombieTroveId` and the oracle price, counts the pending zombie in `debtAhead`/`rank`, reports `belowParityDebtAhead` and `redeemableDebtAhead`, and says why an absent target is absent (`targetStatus`: zombie / closed / nonExistent).
- Added `scripts/extract-upstream-signatures.ts` and `test/abi-drift.test.ts`. The extractor handles interface functions, public-variable getters (including struct flattening for `Troves`) and mutability, and fails if a function cannot be found upstream. The mock-RPC tests cannot catch ABI drift because they encode with the same ABIs the code decodes with; this test does.
- ERC-20/721 pieces are not in the upstream repo and are pinned by their well-known selectors instead.

### Known limits

- Each `getMultipleSortedTroves` call walks `startIdx` nodes on-chain, so scanning deep into a large branch costs growing gas per page and may hit a provider's `eth_call` gas cap.
- Zombie Troves and Troves absent from the list are reported as "not found", not ranked.
