/**
 * Framework-neutral wiring: expose the catalog to any LLM tool-calling API and dispatch its calls.
 * `agentToolCatalog` entries map directly onto { name, description, input_schema/parameters }.
 */
import { agentToolCatalog, createLiquityClient, executeTool } from "../src/index.js";

const client = process.env.ETH_RPC_URL ? createLiquityClient({ rpcUrl: process.env.ETH_RPC_URL }) : undefined;

// 1) Give the model these definitions (shown here for an Anthropic-style API; OpenAI uses `parameters`).
export const toolsForModel = agentToolCatalog.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));

// 2) When the model emits a tool call, run it and return the JSON as the tool result. Errors come back as data, never exceptions.
export async function handleToolCall(name: string, input: Record<string, unknown>) {
  return JSON.stringify(await executeTool(name, input, client ? { client } : {}));
}

// Demo that needs no RPC: a pure calculation.
console.log(await handleToolCall("liquity_estimate_simple_interest", { debt: "10000000000000000000000", annualRate: "50000000000000000", days: "30" }));
