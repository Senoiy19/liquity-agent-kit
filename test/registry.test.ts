import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { getAddress } from "viem";
import { BRANCH_IDS, getBranchDeployment, LIQUITY_V2_MAINNET, parseBranchId } from "../src/index.js";

const upstream = JSON.parse(readFileSync(new URL("./fixtures/upstream-manifest.json", import.meta.url), "utf8")) as { _commit: string; entries: Record<string, string> };
const idx = { WETH: 0, wstETH: 1, rETH: 2 } as const;
const fieldToEnv = { addressesRegistry: "ADDRESSES_REGISTRY", troveManager: "TROVE_MANAGER", troveNFT: "TROVE_NFT", borrowerOperations: "BORROWER_OPERATIONS", stabilityPool: "STABILITY_POOL", sortedTroves: "SORTED_TROVES", priceFeed: "PRICE_FEED", activePool: "ACTIVE_POOL" } as const;

describe("mainnet deployment registry", () => {
  it("contains exactly the three documented collateral branches", () => {
    expect(Object.keys(LIQUITY_V2_MAINNET.branches).sort()).toEqual([...BRANCH_IDS].sort());
  });
  it("contains valid, EIP-55-normalisable addresses with no duplicates", () => {
    const all: string[] = [];
    for (const c of Object.values(LIQUITY_V2_MAINNET.shared)) all.push(getAddress(c.address));
    for (const b of Object.values(LIQUITY_V2_MAINNET.branches)) {
      all.push(getAddress(b.collateralToken));
      for (const a of Object.values(b.contracts)) all.push(getAddress(a));
    }
    expect(new Set(all.map((a) => a.toLowerCase())).size).toBe(all.length);
  });
  it("pins an immutable 40-hex upstream commit", () => {
    expect(LIQUITY_V2_MAINNET.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(LIQUITY_V2_MAINNET.sourceCommit).toBe(upstream._commit);
  });
  it("matches the upstream manifest snapshot for every address", () => {
    const e = upstream.entries;
    const eq = (a: string, b: string | undefined) => expect(a.toLowerCase()).toBe(b);
    for (const [branch, i] of Object.entries(idx)) {
      const dep = LIQUITY_V2_MAINNET.branches[branch as keyof typeof idx];
      for (const [field, env] of Object.entries(fieldToEnv)) eq(dep.contracts[field as keyof typeof fieldToEnv], e[`NEXT_PUBLIC_COLL_${i}_CONTRACT_${env}`]);
      eq(dep.collateralToken, e[`NEXT_PUBLIC_COLL_${i}_CONTRACT_COLL_TOKEN`]);
    }
    const s = LIQUITY_V2_MAINNET.shared;
    eq(s.boldToken.address, e.NEXT_PUBLIC_CONTRACT_BOLD_TOKEN);
    eq(s.collateralRegistry.address, e.NEXT_PUBLIC_CONTRACT_COLLATERAL_REGISTRY);
    eq(s.hintHelpers.address, e.NEXT_PUBLIC_CONTRACT_HINT_HELPERS);
    eq(s.multiTroveGetter.address, e.NEXT_PUBLIC_CONTRACT_MULTI_TROVE_GETTER);
    eq(s.exchangeHelpers.address, e.NEXT_PUBLIC_CONTRACT_EXCHANGE_HELPERS);
  });
  it("labels every address with its verification level honestly (repository manifest, not live-verified)", () => {
    for (const c of Object.values(LIQUITY_V2_MAINNET.shared)) expect(c.verification).toBe("official-repository-env");
  });
});

describe("branch lookup", () => {
  it("resolves the supported branches", () => {
    for (const b of BRANCH_IDS) expect(getBranchDeployment(b).id).toBe(b);
  });
  it("rejects prototype members and unknown names", () => {
    for (const bad of ["constructor", "toString", "hasOwnProperty", "__proto__", "WETH ", "weth", undefined, null, 0]) {
      expect(() => parseBranchId(bad)).toThrow(/Unsupported branch/);
      expect(() => getBranchDeployment(bad)).toThrow();
    }
  });
});
