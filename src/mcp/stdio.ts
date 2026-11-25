#!/usr/bin/env node
/**
 * Stdio MCP server. Usage:
 *   ETH_RPC_URL=https://... npx tsx src/mcp/stdio.ts        (or `npm run mcp`)
 * Without ETH_RPC_URL only the RPC-free tools are exposed. stdout carries the protocol, so all logging goes to stderr,
 * and the RPC URL (which often embeds an API key) is never printed.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createLiquityClient } from "../evm/client.js";
import { createLiquityMcpServer, exposedTools } from "./server.js";

const rpcUrl = process.env.ETH_RPC_URL;
const client = rpcUrl ? createLiquityClient({ rpcUrl }) : undefined;
const server = createLiquityMcpServer(client ? { client } : {});
await server.connect(new StdioServerTransport());
console.error(`liquity-agent-kit MCP server ready: ${exposedTools(client).length} read-only tools${client ? "" : " (no ETH_RPC_URL: RPC-free tools only)"}.`);
