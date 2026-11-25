import { createPublicClient, http, type PublicClient } from "viem";
import { mainnet } from "viem/chains";
import { LiquityAgentKitError } from "../core/errors.js";

export interface LiquityClientOptions { rpcUrl: string; timeoutMs?: number; }
export function createLiquityClient(options: LiquityClientOptions): PublicClient {
  let url: URL;
  try { url = new URL(options.rpcUrl); } catch { throw new LiquityAgentKitError("INVALID_RPC_URL", "A valid Ethereum RPC URL is required."); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new LiquityAgentKitError("INVALID_RPC_URL", "RPC URL must use HTTP or HTTPS.");
  return createPublicClient({ chain: mainnet, transport: http(options.rpcUrl, { timeout: options.timeoutMs ?? 15_000, retryCount: 2 }) });
}

export async function assertMainnet(client: PublicClient): Promise<bigint> {
  const chainId = await client.getChainId();
  if (chainId !== 1) throw new LiquityAgentKitError("UNSUPPORTED_CHAIN", `Expected Ethereum mainnet (1), received chain ${chainId}.`);
  return client.getBlockNumber();
}
