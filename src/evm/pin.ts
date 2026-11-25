import type { Address, Block, PublicClient } from "viem";
import { getAddress } from "viem";
import { LiquityAgentKitError } from "../core/errors.js";
import type { ReadOptions, ReadProvenance } from "../core/types.js";
import { assertMainnet } from "./client.js";

export interface PinnedBlock { blockNumber: bigint; block: Block }

/** Verifies mainnet, picks the block (latest unless pinned) and loads its header once. */
export async function pinBlock(client: PublicClient, options?: ReadOptions): Promise<PinnedBlock> {
  const latest = await assertMainnet(client);
  const blockNumber = options?.blockNumber ?? latest;
  if (blockNumber < 0n || blockNumber > latest) {
    throw new LiquityAgentKitError("INVALID_INPUT", `Block ${blockNumber} is outside the chain range 0..${latest}.`);
  }
  try {
    const block = await client.getBlock({ blockNumber });
    return { blockNumber, block };
  } catch (error) {
    throw new LiquityAgentKitError("RPC_READ_FAILED", `Could not load block ${blockNumber}.`, error);
  }
}

export function provenanceFor(pin: PinnedBlock, contracts: Address[]): ReadProvenance {
  if (!pin.block.hash) throw new LiquityAgentKitError("RPC_READ_FAILED", "RPC returned a pending block without a hash.");
  return {
    chainId: 1,
    blockNumber: pin.blockNumber,
    blockHash: pin.block.hash,
    blockTimestamp: new Date(Number(pin.block.timestamp) * 1000).toISOString(),
    observedAt: new Date().toISOString(),
    contractAddresses: [...new Set(contracts.map((a) => getAddress(a)))],
    source: "ethereum-rpc"
  };
}

export function parseAddress(value: unknown, label: string): Address {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new LiquityAgentKitError("INVALID_INPUT", `${label} must be a 20-byte hex address.`);
  }
  try { return getAddress(value); } catch (error) {
    throw new LiquityAgentKitError("INVALID_INPUT", `${label} has an invalid EIP-55 checksum.`, error);
  }
}
