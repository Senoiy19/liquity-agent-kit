# Safety and data semantics

## Side-effect classes

Every exposed capability must declare one of:

- `read`: reads external state; no transaction is created.
- `compute`: deterministic local calculation; no external side effect.
- `plan`: prepares an unsigned transaction description; does not sign or submit.
- `write`: signs or submits a transaction. Not available in V1.

## V1 safety boundary

- No private keys, seed phrases, signing APIs, or transaction submission.
- No hidden fallback from an on-chain read to an indexer or external price source.
- No treating missing data as zero.
- No treating a fallback oracle price as a normal live oracle price.
- No claiming liquidation probability from collateral ratio alone.
- No calling an APR figure safe or risk-adjusted unless a documented risk model supports that claim.

## Provenance required in results

Where applicable, every on-chain result should carry:

- `chainId`
- `blockNumber`
- `blockHash`
- `blockTimestamp` (from the chain)
- `contractAddresses` (every contract queried)
- `source` (for example, `ethereum_rpc` or a named indexer)
- `observedAt` (local wall clock)
- `warnings[]`

## Rules the code enforces

- Untrusted identifiers (branch names, Trove IDs, addresses) are validated against an allow-list or strict pattern; JSON numbers are refused for integers.
- `PriceFeed.fetchPrice` is state-changing upstream and is only ever called through `eth_call`.
- A price that comes from a fallback source, or from a feed that just detected an oracle failure, always produces a warning.
- Wallet discovery fails rather than truncating, and returns `complete: false` when it cannot reconcile with the NFT balance.

## Numeric rules

- Token quantities remain integer base units in raw responses.
- Human-readable formatting is a separate presentation operation.
- Rates use an explicitly documented scale and unit.
- Calculations use integer or decimal arithmetic, never binary floating point for financial values.
- Rounding is directional and documented: collateral ratio and interest round down; liquidation price rounds up.
- Every estimate states its assumptions, such as constant debt, simple interest, and excluded fees.
