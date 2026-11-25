import { agentTools } from "./tools.js";
import { LIQUITY_V2_MAINNET } from "../evm/deployments.js";

/** Builds schemas/capability-catalog.json from the executable tool definitions (see scripts/generate-catalog.ts). */
export function buildCapabilityCatalog() {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "Liquity Agent Kit capability catalog",
    description: "Generated from src/agent-tools/tools.ts. Every entry is implemented; do not edit by hand (npm run catalog).",
    version: "0.3.5",
    protocolScope: ["Liquity V2"],
    initialNetwork: { name: "Ethereum Mainnet", chainId: 1 },
    upstreamSourceCommit: LIQUITY_V2_MAINNET.sourceCommit,
    conventions: {
      integers: "All token amounts, prices and block numbers are decimal strings of base-unit integers. Amounts and prices are scaled 1e18; ratios and rates use 1e18 = 100%.",
      results: "Read tools return { data, provenance, warnings }. Failures return { ok: false, error: { code, message } }.",
      sideEffects: "read = reads chain state; compute = local deterministic calculation or static data. No tool signs or sends transactions."
    },
    capabilities: agentTools.map((t) => ({
      name: t.name, group: t.group, sideEffect: t.sideEffects, status: "implemented", requiresRpc: t.requiresClient,
      description: t.description, inputSchema: t.inputSchema
    }))
  };
}
