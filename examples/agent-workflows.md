# Agent workflows

These use tools that exist in `src/agent-tools/tools.ts` (names are authoritative; see `schemas/capability-catalog.json`).
All amounts are decimal strings of 1e18 base units; ratios and rates use 1e18 = 100%.

## 1. Inspect a borrower's Troves

1. `liquity_get_supported_deployments` — confirm Ethereum mainnet / V2 is supported.
2. For each branch (`WETH`, `wstETH`, `rETH`): `liquity_get_wallet_troves` with the wallet and a `fromBlock` at or before the branch deployment.
   - If `complete` is `false`, say the list may be missing Troves and retry with an earlier `fromBlock`; never present it as exhaustive.
3. For each Trove: `liquity_get_trove_health` (Trove, oracle price and MCR are read at one block).
4. Report collateral ratio, liquidation price, interest rate and every warning (zombie, batch membership, fallback oracle, branch shutdown). Quote `provenance.blockNumber`.
5. Do not call a position "safe" from one ratio; the ratio is a point-in-time figure at the protocol oracle price.

## 2. Compare borrowing-rate scenarios

1. `liquity_get_trove` for current debt and rate (note any batch-manager warning: batch fees apply and are not modelled).
2. Ask the user for the proposed rate and period.
3. `liquity_estimate_simple_interest` for each rate. State the assumptions returned: simple interest, constant debt, no fees.
4. Show the difference in BOLD. Do not recommend a rate without noting redemption-order trade-offs, which this kit does not model.

## 3. Check Stability Pool exposure

1. `liquity_get_stability_pool_state` for pool totals.
2. `liquity_get_stability_pool_position` for the wallet: compounded deposit, collateral gain, yield gain.
3. Report figures as read; do not infer APR or risk-adjusted returns (no documented model exists in this kit).

## 4. Preparing a Trove operation (not supported)

The kit never signs or sends transactions and does not yet build unsigned ones (roadmap Phase 4). An agent should explain what it can verify (health, price, parameters) and hand execution to the user's own wallet.
