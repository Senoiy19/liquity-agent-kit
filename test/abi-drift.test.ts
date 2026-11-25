import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { toEventSelector, toFunctionSelector } from "viem";
import { abiFunctions, canonicalFunction, type AbiFn } from "../scripts/lib/abi-signature.js";
import { borrowerOperationsReadAbi } from "../src/abis/borrower-operations.js";
import { erc20Abi } from "../src/abis/erc20.js";
import { collateralRegistryReadAbi, multiTroveGetterAbi } from "../src/abis/multi-trove-getter.js";
import { priceFeedAbi } from "../src/abis/price-feed.js";
import { stabilityPoolReadAbi } from "../src/abis/stability-pool.js";
import { erc721TransferEvent, troveNftReadAbi } from "../src/abis/trove-nft.js";
import { troveManagerReadAbi } from "../src/abis/trove-manager.js";
import { LIQUITY_V2_MAINNET } from "../src/evm/deployments.js";

/**
 * The hand-written ABI fragments must agree with the upstream Solidity at the pinned commit.
 * The fixture is produced by `npm run abi:extract -- <liquity/bold checkout>` (scripts/extract-upstream-signatures.ts);
 * regenerate it whenever `sourceCommit` changes. This catches drift that the mock-RPC tests cannot, because the
 * mock encodes with the same ABIs the code decodes with.
 */
const fixture = JSON.parse(readFileSync(new URL("./fixtures/upstream-abi-signatures.json", import.meta.url), "utf8")) as { _commit: string; groups: Record<string, Record<string, string>> };
const groups: Record<string, readonly AbiFn[]> = {
  troveManagerReadAbi: troveManagerReadAbi as readonly AbiFn[],
  borrowerOperationsReadAbi: borrowerOperationsReadAbi as readonly AbiFn[],
  priceFeedAbi: priceFeedAbi as readonly AbiFn[],
  stabilityPoolReadAbi: stabilityPoolReadAbi as readonly AbiFn[],
  multiTroveGetterAbi: multiTroveGetterAbi as readonly AbiFn[],
  collateralRegistryReadAbi: collateralRegistryReadAbi as readonly AbiFn[]
};

describe("ABI fragments vs upstream Solidity", () => {
  it("fixture was extracted at the registry's pinned commit", () => {
    expect(fixture._commit).toBe(LIQUITY_V2_MAINNET.sourceCommit);
  });
  it("covers exactly the functions in each hand-written ABI", () => {
    expect(Object.keys(fixture.groups).sort()).toEqual(Object.keys(groups).sort());
    for (const [group, abi] of Object.entries(groups)) {
      expect(Object.keys(fixture.groups[group]!).sort(), group).toEqual(abiFunctions(abi).map((f) => f.name!).sort());
    }
  });
  for (const [group, abi] of Object.entries(groups)) {
    describe(group, () => {
      for (const fn of abiFunctions(abi)) {
        it(`${fn.name} matches upstream (types, tuple layout, mutability)`, () => {
          expect(canonicalFunction(fn)).toBe(fixture.groups[group]![fn.name!]);
        });
      }
    });
  }

  describe("the check detects real drift", () => {
    const clone = <T,>(x: T): T => structuredClone(x);
    it("a wrong integer width in a flattened struct getter", () => {
      const abi = clone(troveManagerReadAbi) as unknown as AbiFn[];
      const troves = abi.find((f) => f.name === "Troves")!;
      (troves.outputs as { type: string }[])[4]!.type = "uint256"; // arrayIndex is uint64 upstream
      expect(canonicalFunction(troves)).not.toBe(fixture.groups.troveManagerReadAbi!.Troves);
    });
    it("view declared for a state-changing function", () => {
      const f = { ...(abiFunctions(priceFeedAbi as readonly AbiFn[]).find((x) => x.name === "fetchPrice")!), stateMutability: "view" };
      expect(canonicalFunction(f)).not.toBe(fixture.groups.priceFeedAbi!.fetchPrice);
    });
    it("reordered struct components", () => {
      const abi = clone(multiTroveGetterAbi) as unknown as AbiFn[];
      const comps = abi[0]!.outputs![0]!.components as unknown as { type: string }[];
      [comps[0], comps[1]] = [comps[1]!, comps[0]!]; [comps[12], comps[13]] = [comps[13]!, comps[12]!];
      expect(canonicalFunction(abi[0]!)).not.toBe(fixture.groups.multiTroveGetterAbi!.getMultipleSortedTroves);
    });
    it("a dropped struct component", () => {
      const abi = clone(troveManagerReadAbi) as unknown as AbiFn[];
      (abi.find((f) => f.name === "getLatestTroveData")!.outputs![0]!.components as unknown[]).pop();
      expect(canonicalFunction(abi.find((f) => f.name === "getLatestTroveData")!)).not.toBe(fixture.groups.troveManagerReadAbi!.getLatestTroveData);
    });
  });

  describe("standard token interfaces (not in the upstream repo; pinned by well-known selectors)", () => {
    const sel = (abi: readonly AbiFn[], name: string) => toFunctionSelector(abi.find((f) => f.type === "function" && f.name === name) as never);
    it("ERC-20 reads used for BOLD", () => {
      expect(sel(erc20Abi as readonly AbiFn[], "symbol")).toBe("0x95d89b41");
      expect(sel(erc20Abi as readonly AbiFn[], "decimals")).toBe("0x313ce567");
      expect(sel(erc20Abi as readonly AbiFn[], "totalSupply")).toBe("0x18160ddd");
    });
    it("ERC-721 reads and Transfer event used for TroveNFT", () => {
      expect(sel(troveNftReadAbi as readonly AbiFn[], "ownerOf")).toBe("0x6352211e");
      expect(sel(troveNftReadAbi as readonly AbiFn[], "balanceOf")).toBe("0x70a08231");
      expect(toEventSelector(erc721TransferEvent)).toBe("0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef");
    });
  });
});
