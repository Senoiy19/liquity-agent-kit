import type { PublicClient } from "viem";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { agentTools, executeTool, type AgentTool } from "../agent-tools/tools.js";

export interface McpServerOptions {
  /** Read client. Without one, only tools that do not need an RPC (calculations, discovery) are exposed. */
  client?: PublicClient;
  version?: string;
}

/** Only tools that cannot change anything on-chain are ever exposed over MCP, regardless of what tools.ts later gains. */
const SAFE_EFFECTS = new Set<AgentTool["sideEffects"]>(["read", "compute"]);

export function exposedTools(client: PublicClient | undefined): AgentTool[] {
  return agentTools.filter((t) => SAFE_EFFECTS.has(t.sideEffects) && (client !== undefined || !t.requiresClient));
}

/** MCP server over the shared tool definitions. Same validation, same error codes and same JSON-safe output as executeTool. */
export function createLiquityMcpServer(options: McpServerOptions = {}): Server {
  const server = new Server(
    { name: "liquity-agent-kit", version: options.version ?? "0.3.5" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: exposedTools(options.client).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as unknown as { type: "object"; [k: string]: unknown },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: t.requiresClient }
    }))
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const allowed = exposedTools(options.client).some((t) => t.name === name);
    const outcome = allowed
      ? await executeTool(name, (args ?? {}) as Record<string, unknown>, options.client ? { client: options.client } : {})
      : { ok: false as const, error: { code: "UNKNOWN_TOOL", message: `Unknown or unavailable tool: ${name}.${options.client ? "" : " Set ETH_RPC_URL to enable on-chain reads."}` } };
    return { content: [{ type: "text" as const, text: JSON.stringify(outcome) }], isError: !outcome.ok };
  });

  return server;
}
