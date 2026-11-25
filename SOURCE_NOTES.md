# Source notes and implementation provenance

Reviewed and updated 2026-11-24.

## Authoritative references used

1. Liquity V2 Technical Docs & Audits (contract addresses and protocol architecture): https://docs.liquity.org/v2-documentation/technical-docs-and-audits
2. Official Liquity V2 core repository: https://github.com/liquity/bold
3. Official repository frontend environment manifest (cross-check for shared contract addresses and current rETH branch contracts): https://github.com/liquity/bold/blob/main/frontend/app/.env
4. Etherscan verified ABI page for Liquity V2 MultiTroveGetter: https://etherscan.io/address/0xfa61db085510c64b83056db3a7acf3b6f631d235
5. Etherscan verified ABI page for the current WETH BorrowerOperations deployment (branch constants and aggregate branch read functions): https://etherscan.io/address/0x372ABD1810eAF23Cb9D941BbE7596DFb2c46BC65
6. Etherscan verified ABI page for an earlier Liquity V2 TroveManager deployment, used to inspect the Trove read method and struct shape: https://etherscan.io/address/0x81D78814DF42DA2caB0E8870C477bC3Ed861DE66
7. Codeslaw ABI listing for current WETH BorrowerOperations, cross-checking `getEntireBranchDebt`, `getEntireBranchColl`, MCR, CCR, SCR and BCR: https://www.codeslaw.app/contracts/ethereum/0x372abd1810eaf23cb9d941bbe7596dfb2c46bc65

## Important source distinction

Liquity's docs have a separate page titled "Legacy V2 and Testnet". That page lists a legacy deployment with different addresses. This SDK registry uses the addresses from the current `Technical Docs & Audits` page, not the legacy page. Do not mix those registries.

## Pinned source

- Repository: https://github.com/liquity/bold
- Commit: `d262669ef3c4d37bf0544df3bb2624c07b8a5ee0` (merge of PR #1206, committed 2026-09-26; `main` HEAD when checked).
- Used for: (a) address cross-check against `frontend/app/.env`, (b) ABI signatures read from `contracts/src/Interfaces/*.sol`, `Types/LatestTroveData.sol`, `BorrowerOperations.sol`, `PriceFeeds/*.sol`, `TroveManager.sol`.

## What "verified" means here

| Claim | Basis |
|---|---|
| Registry addresses | Compared programmatically to the upstream `.env` at the pinned commit: 32/32 equal. This matches a repository manifest; it is not an on-chain check. |
| ABI fragments | Read against the upstream Solidity interfaces by hand. Not generated from compiled artifacts. |
| Live behaviour | Not checked (no RPC reachable from the build sandbox). Use `npm run smoke`. |

## Facts established from source (not memory)

- `SortedTroves` is sorted descending by annual rate (head = highest); `TroveManager.redeemCollateral` starts at `getLast()` (tail) and steps with `getPrev`, after first redeeming `lastZombieTroveId` if set. It skips Troves with ICR < 100% at the normal oracle price. Zombie Troves are removed from the sorted list (`sortedTroves.remove` / `removeFromBatch` when a redemption leaves a Trove below `MIN_DEBT`).
- Function signatures used by the kit are machine-checked against the pinned commit (see `test/abi-drift.test.ts`).

- Trove IDs are `uint256(keccak256(abi.encode(msg.sender, _owner, _ownerIndex)))` (`BorrowerOperations.sol`), i.e. 256-bit hashes. Small integers are not valid IDs.
- `TroveNFT` is a plain ERC-721 (no enumeration); closed Troves are burned, so wallet discovery uses `Transfer` logs plus `ownerOf`/`balanceOf` reconciliation.
- `PriceFeed.fetchPrice()` is non-view and can switch the branch to last-good-price mode; the kit only simulates it with `eth_call`. `priceSource`: 0 primary, 1 ETHUSDxCanonical, 2 lastGoodPrice.
- `getLatestTroveData` and `getTroveAnnualInterestRate` both return the batch's rate for batch members; `Troves(id).annualInterestRate` does not.
- `Status` enum: nonExistent, active, closedByOwner, closedByLiquidation, zombie.

## Docs pages (earlier research)

1. https://docs.liquity.org/v2-documentation/technical-docs-and-audits — current address manifest. A separate "Legacy V2 and Testnet" page lists older addresses; never mix them.
2. https://github.com/liquity/bold/blob/main/frontend/app/.env — manifest used for the cross-check.
3. Etherscan pages for MultiTroveGetter, WETH BorrowerOperations and an earlier TroveManager were used for the initial ABI inspection and have since been superseded by the Solidity sources above.


## v0.3 MultiTroveGetter ABI

- `getMultipleSortedTroves(uint256 _collIndex, int256 _startIdx, uint256 _count)` and its `CombinedTroveData[]` return tuple were transcribed from the verified Ethereum mainnet MultiTroveGetter ABI: https://etherscan.io/address/0xfa61db085510c64b83056db3a7acf3b6f631d235
- `CollateralRegistry.totalCollaterals()` and `getToken(uint256)` were transcribed from the verified Ethereum mainnet CollateralRegistry ABI: https://etherscan.io/address/0xf949982b91c8c61e952b3ba942cbbfaef5386684
- The SDK resolves the collateral index at the requested pinned block. It does not hard-code the order of WETH, wstETH and rETH. The ABI transcription and address manifest still require a live-RPC smoke test before a stable release; ABI publication alone does not prove deployed bytecode matches the source revision.

- v0.3.1 cross-check: the `getMultipleSortedTroves` signature, `CombinedTroveData` field order, signed `_startIdx` behaviour (>= 0 walks from the head, < 0 from the tail via `-(idx+1)`) and `CollateralRegistry.totalCollaterals()/getToken(uint256)` were also read in `liquity/bold` at `d262669e` and match the Etherscan transcription.
