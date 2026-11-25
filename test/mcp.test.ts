import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { PublicClient } from "viem";
import { agentTools } from "../src/agent-tools/tools.js";
import { createLiquityMcpServer } from "../src/mcp/server.js";

async function connect(client?: PublicClient) {
  const server = createLiquityMcpServer(client ? { client } : {});
  const [a, b] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(a), mcp.connect(b)]);
  return mcp;
}
const parse = (r: { content: unknown }) => JSON.parse((r.content as Array<{ text: string }>)[0]!.text);
const fakeClient = {} as PublicClient; // listing never touches the client

describe("MCP adapter", () => {
  it("without an RPC client exposes only tools that need none", async () => {
    const mcp = await connect();
    const names = (await mcp.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(agentTools.filter((t) => !t.requiresClient).map((t) => t.name).sort());
    expect(names.length).toBeGreaterThan(0);
  });

  it("with an RPC client exposes every read/compute tool, all marked read-only, with the original schemas", async () => {
    const mcp = await connect(fakeClient);
    const { tools } = await mcp.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(agentTools.map((t) => t.name).sort());
    for (const t of tools) {
      expect(t.annotations?.readOnlyHint).toBe(true);
      expect(t.annotations?.destructiveHint).toBe(false);
      const src = agentTools.find((x) => x.name === t.name)!;
      expect(t.inputSchema).toMatchObject({ type: "object", additionalProperties: false, properties: src.inputSchema.properties });
    }
  });

  it("runs an RPC-free calculation and returns JSON text", async () => {
    const mcp = await connect();
    const r = await mcp.callTool({ name: "liquity_estimate_simple_interest", arguments: { debt: "10000000000000000000000", annualRate: "50000000000000000", days: "30" } });
    expect(r.isError).toBe(false);
    const out = parse(r as never);
    expect(out.ok).toBe(true);
    expect(typeof out.result.interest).toBe("string"); // bigint rendered as a decimal string
  });

  it("returns validation failures as tool errors with a stable code, not protocol errors", async () => {
    const mcp = await connect();
    const r = await mcp.callTool({ name: "liquity_estimate_simple_interest", arguments: { debt: "-1", annualRate: "1", days: "1" } });
    expect(r.isError).toBe(true);
    expect(parse(r as never)).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    const extra = await mcp.callTool({ name: "liquity_estimate_simple_interest", arguments: { debt: "1", annualRate: "1", days: "1", bogus: "x" } });
    expect(extra.isError).toBe(true);
  });

  it("refuses tools that need an RPC when none is configured, and unknown tools", async () => {
    const mcp = await connect();
    const needsRpc = agentTools.find((t) => t.requiresClient)!;
    const r = await mcp.callTool({ name: needsRpc.name, arguments: {} });
    expect(r.isError).toBe(true);
    expect(parse(r as never).error.message).toContain("ETH_RPC_URL");
    const u = await mcp.callTool({ name: "does_not_exist", arguments: {} });
    expect(u.isError).toBe(true);
    expect(parse(u as never).error.code).toBe("UNKNOWN_TOOL");
  });

  it("never exposes a tool that is not read or compute", () => {
    for (const t of agentTools) expect(["read", "compute"]).toContain(t.sideEffects);
  });
});
