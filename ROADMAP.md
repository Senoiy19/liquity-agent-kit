# Roadmap

## Phase 0 — Product and source mapping

- [x] Define Agent Kit as a standalone toolkit, separate from BOLD Guardian and Guardian MCP.
- [x] Set V1 scope to read-only Liquity V2 on Ethereum mainnet.
- [x] Define package boundaries and safety/data rules.
- [x] Pin the exact upstream Liquity `bold` repository commit used for V1 (`d262669e`, 2026-11-24).
- [x] Verify deployment addresses (32/32 match upstream manifest) and ABI signatures (hand-checked against upstream interfaces) from the pinned commit.
- [x] Machine-check hand-written ABI fragments against the pinned upstream Solidity (`abi:extract` + `test/abi-drift.test.ts`).
- [ ] Generate ABIs from compiled upstream artifacts instead of hand-written fragments (stronger than signature parsing; needs the Foundry toolchain).
- [x] Node >= 20.11 (run locally on Node 22; no CI configured yet), TypeScript ^5.8.

## Phase 1 — Core and EVM foundation

- [x] Implement domain types, units, provenance metadata, and errors.
- [x] Implement a versioned deployment registry (pinned to upstream commit).
- [x] Implement public RPC client and block-pinned contract reads.
- [x] Add tests for registry integrity and numeric conversions (passing).

## Phase 2 — First useful read capabilities

- [x] Resolve shared and branch contracts.
- [x] Read Trove by ID.
- [x] Resolve wallet-owned Troves (log scan + reconciliation).
- [x] Hydrate discovered wallet Troves with full debt, collateral, rate and batch fields at one pinned block.
- [x] Read branch parameters and oracle/price-feed state with fallback status.
- [x] Read Stability Pool state and account deposits.
- [x] Add deterministic health and simple-interest calculations.
- [x] Live mainnet validation (`npm run smoke`, `npm run live:redemption`) passes.
- [ ] **Release gate remainder:** live check of `liquity_get_trove_health` on a real Trove and `liquity_get_wallet_troves` on a real wallet.
- [x] Bounded sorted-Trove pages via `MultiTroveGetter`, with collateral index resolved from the on-chain registry.
- [ ] Debt-in-front and rate-distribution reads.

## Phase 3 — Agent interface

- [x] Publish JSON Schemas and tool descriptions (generated, sync-tested).
- [x] Add example agent workflows and a framework-neutral tool loop.
- [x] Add MCP adapter over the shared tool functions (`src/mcp`, `npm run mcp`).
- [ ] Test with MCP Inspector and at least one agent client (in-process and stdio client tests pass; no real agent client yet).

## Phase 4 — Write planning (not automatic execution)

- [ ] Build unsigned transaction request builders.
- [ ] Add precondition checks, quote freshness, and simulation hooks.
- [ ] Require explicit caller-controlled signing and submission outside the kit.

## Release gates

A capability is not marked supported until it has unit tests, mocked integration tests, verified ABI/address provenance, and at least one live read check against its stated network. A deployment entry is not marked verified merely because an address appears in documentation.


## v0.3.2 / v0.3.3 completed

- Redemption position and branch-local debt-ahead calculation, walking the on-chain list tail-first (lowest rate is redeemed first). v0.3.2 walked from the head, which inverted the result; fixed in v0.3.3.
- Branch interest-rate distribution: nearest-rank percentiles, simple mean, debt-weighted mean and histogram.
- Both scans are bounded and expose completeness flags.

## Remaining validation

- Run the existing mainnet smoke checks and add live redemption-position/rate-analysis checks against a configured Ethereum RPC.
- Do not treat branch-local debt ahead as a forecast of the amount that will be redeemed; branch routing and transaction-time eligibility remain external factors.
