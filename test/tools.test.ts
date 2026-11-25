import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { agentTools, agentToolCatalog, buildCapabilityCatalog, executeTool } from "../src/index.js";
import { addTrove, E18, erc721TransferEvent, makeWorld, OWNER, TROVE_ID, sortedRow } from "./helpers/world.js";
import { LIQUITY_V2_MAINNET } from "../src/evm/deployments.js";

describe("tool definitions", () => {
  it("have unique liquity_-prefixed names, valid side-effect classes and closed schemas", () => {
    const names = agentTools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of agentTools) {
      expect(t.name).toMatch(/^liquity_[a-z_]+$/);
      expect(["read", "compute"]).toContain(t.sideEffects);
      expect(t.inputSchema.additionalProperties).toBe(false);
      for (const r of t.inputSchema.required ?? []) expect(t.inputSchema.properties).toHaveProperty(r);
      expect(t.description.length).toBeGreaterThan(40);
      expect(t.requiresClient).toBe(t.sideEffects === "read");
    }
    expect(agentToolCatalog).toHaveLength(agentTools.length);
  });
  it("committed schemas/capability-catalog.json is in sync (run `npm run catalog` if this fails)", () => {
    const committed = JSON.parse(readFileSync(new URL("../schemas/capability-catalog.json", import.meta.url), "utf8"));
    expect(committed).toEqual(JSON.parse(JSON.stringify(buildCapabilityCatalog())));
  });
});

describe("executeTool", () => {
  it("returns bigint-free JSON for read tools", async () => {
    const w = makeWorld(); addTrove(w, TROVE_ID);
    const out = await executeTool("liquity_get_trove_health", { branch: "WETH", troveId: TROVE_ID.toString() }, { client: w.chain.client() });
    expect(out.ok).toBe(true);
    const json = JSON.stringify(out); // would throw on a raw bigint
    expect(JSON.parse(json).result.data.collateralRatio).toBe((4n * E18).toString());
    expect(JSON.parse(json).result.data.trove.owner).toBe(OWNER);
  });

  it("exposes sorted Trove pages through the JSON-safe agent tool", async () => {
    const w = makeWorld();
    const out = await executeTool("liquity_get_sorted_troves_page", { branch: "WETH", startIndex: "0", count: "1" }, { client: w.chain.client() });
    expect(out.ok).toBe(true);
    expect(JSON.parse(JSON.stringify(out)).result.data.troves[0].id).toBe("101");
  });

  it("exposes redemption position and rate analysis as JSON-safe tools", async () => {
    const w = makeWorld();
    w.sortedTroves = [sortedRow(202n, 2000n * E18, 4n * E18 / 100n), sortedRow(101n, 1000n * E18, 3n * E18 / 100n)]; // head (highest rate) first
    const position = await executeTool("liquity_get_trove_redemption_position", { branch: "WETH", troveId: "202" }, { client: w.chain.client() });
    expect(position.ok).toBe(true);
    expect(JSON.parse(JSON.stringify(position)).result.data.debtAhead).toBe((1000n * E18).toString());
    const analysis = await executeTool("liquity_analyze_branch_interest_rates", { branch: "WETH" }, { client: w.chain.client() });
    expect(analysis.ok).toBe(true);
    expect(JSON.parse(JSON.stringify(analysis)).result.data.complete).toBe(true);
  });
  it("exposes wallet Trove hydration as a JSON-safe tool", async () => {
    const w = makeWorld(); addTrove(w, 88n);
    w.chain.addTransfer(LIQUITY_V2_MAINNET.branches.WETH.contracts.troveNFT, [erc721TransferEvent] as never, "0x0000000000000000000000000000000000000000", OWNER, 88n, 23_999_999n);
    w.nftBalance.set(OWNER.toLowerCase(), 1n);
    const out = await executeTool("liquity_get_wallet_trove_details", { branch: "WETH", owner: OWNER, fromBlock: "23999990" }, { client: w.chain.client() });
    expect(out.ok).toBe(true);
    expect(JSON.parse(JSON.stringify(out)).result.data.troves[0].id).toBe("88");
  });
  it("runs compute tools without a client", async () => {
    const calc = await executeTool("liquity_calculate_trove_metrics", { collateral: (2n * E18).toString(), debt: (1000n * E18).toString(), price: (2000n * E18).toString(), mcr: (11n * E18 / 10n).toString() });
    expect(calc).toMatchObject({ ok: true, result: { collateralRatio: (4n * E18).toString(), liquidationPrice: (550n * E18).toString(), isBelowMcr: false } });
    const interest = await executeTool("liquity_estimate_simple_interest", { debt: (10_000n * E18).toString(), annualRate: (5n * E18 / 100n).toString(), days: "365" });
    expect(interest).toMatchObject({ ok: true, result: { interest: (500n * E18).toString() } });
    expect(await executeTool("liquity_get_supported_deployments", {})).toMatchObject({ ok: true });
    const contracts = await executeTool("liquity_get_protocol_contracts", { branch: "rETH" });
    expect(contracts).toMatchObject({ ok: true });
  });
  it("returns stable error codes instead of throwing", async () => {
    const w = makeWorld(); const client = w.chain.client();
    const code = async (name: string, args: Record<string, unknown>, c = client) => { const o = await executeTool(name, args, { client: c }); return o.ok ? "ok" : o.error.code; };
    expect(await code("nope", {})).toBe("UNKNOWN_TOOL");
    expect(await code("liquity_get_trove", { branch: "constructor", troveId: "1" })).toBe("INVALID_INPUT");  // schema enum rejects it first
    expect(await code("liquity_get_trove", { branch: "WETH" })).toBe("INVALID_INPUT");                       // missing required
    expect(await code("liquity_get_trove", { branch: "WETH", troveId: "1", extra: "x" })).toBe("INVALID_INPUT");
    expect(await code("liquity_get_trove", { branch: "WETH", troveId: 1 as never })).toBe("INVALID_INPUT");  // numbers refused
    expect(await code("liquity_get_trove", { branch: "WETH", troveId: "-1" })).toBe("INVALID_INPUT");
    expect(await code("liquity_get_trove", { branch: "WETH", troveId: "999" })).toBe("TROVE_NOT_FOUND");
    const noClient = await executeTool("liquity_get_branch_price", { branch: "WETH" });
    expect(noClient).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });                          // no RPC client supplied
    w.chain.chainId = 5;
    expect(await code("liquity_get_bold_token_info", {})).toBe("UNSUPPORTED_CHAIN");
  });
  it("passes the pinned block through to the read", async () => {
    const w = makeWorld(); addTrove(w, 1n);
    const out = await executeTool("liquity_get_branch_parameters", { branch: "WETH", blockNumber: (w.chain.head - 5n).toString() }, { client: w.chain.client() });
    expect(out).toMatchObject({ ok: true, result: { provenance: { blockNumber: (w.chain.head - 5n).toString() } } });
  });
});
