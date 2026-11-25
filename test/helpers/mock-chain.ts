import { createPublicClient, custom, decodeFunctionData, encodeEventTopics, encodeFunctionResult, numberToHex, pad, type Abi, type Address, type Hex, type PublicClient } from "viem";
import { mainnet } from "viem/chains";

export interface MockContract { abi: Abi; call(fn: string, args: readonly unknown[]): unknown }
export interface MockLog { address: Address; blockNumber: bigint; topics: Hex[]; data: Hex; logIndex: number }
export interface MockChainOptions { chainId?: number; head?: bigint; timestamp?: bigint }

/** In-memory JSON-RPC node: viem still performs real ABI encoding/decoding and block-tag handling. */
export class MockChain {
  readonly contracts = new Map<string, MockContract>();
  readonly logs: MockLog[] = [];
  readonly calls: Array<{ method: string; blockTag?: string; to?: string; fn?: string }> = [];
  chainId: number; head: bigint; timestamp: bigint;
  constructor(o: MockChainOptions = {}) { this.chainId = o.chainId ?? 1; this.head = o.head ?? 24_000_000n; this.timestamp = o.timestamp ?? 1_790_000_000n; }

  add(address: Address, contract: MockContract) { this.contracts.set(address.toLowerCase(), contract); }
  addTransfer(nft: Address, abi: Abi, from: Address, to: Address, tokenId: bigint, blockNumber: bigint) {
    const topics = encodeEventTopics({ abi, eventName: "Transfer", args: { from, to, tokenId } }) as Hex[];
    this.logs.push({ address: nft, blockNumber, topics, data: "0x", logIndex: this.logs.length });
  }
  blockHash(n: bigint): Hex { return pad(numberToHex(n + 0xabc000n), { size: 32 }); }

  client(): PublicClient {
    return createPublicClient({ chain: mainnet, transport: custom({ request: async ({ method, params }: { method: string; params?: unknown }) => this.handle(method, (params ?? []) as any[]) }) }) as PublicClient;
  }

  private handle(method: string, params: any[]): unknown {
    switch (method) {
      case "eth_chainId": return numberToHex(this.chainId);
      case "eth_blockNumber": this.calls.push({ method }); return numberToHex(this.head);
      case "eth_getBlockByNumber": {
        this.calls.push({ method, blockTag: params[0] });
        const n = BigInt(params[0]);
        return { number: numberToHex(n), hash: this.blockHash(n), parentHash: this.blockHash(n - 1n), timestamp: numberToHex(this.timestamp), transactions: [], uncles: [], nonce: "0x0000000000000000", sha3Uncles: pad("0x0", { size: 32 }), logsBloom: "0x" + "00".repeat(256), transactionsRoot: pad("0x0", { size: 32 }), stateRoot: pad("0x0", { size: 32 }), receiptsRoot: pad("0x0", { size: 32 }), miner: "0x0000000000000000000000000000000000000000", difficulty: "0x0", totalDifficulty: "0x0", extraData: "0x", size: "0x0", gasLimit: "0x1c9c380", gasUsed: "0x0", mixHash: pad("0x0", { size: 32 }), baseFeePerGas: "0x1" };
      }
      case "eth_call": {
        const tx = params[0] as { to: Address; data?: Hex; input?: Hex };
        const data = (tx.data ?? tx.input) as Hex;
        const c = this.contracts.get(tx.to.toLowerCase());
        if (!c) throw new Error(`MockChain: no contract at ${tx.to}`);
        const { functionName, args } = decodeFunctionData({ abi: c.abi, data });
        this.calls.push({ method, blockTag: params[1], to: tx.to, fn: functionName });
        return encodeFunctionResult({ abi: c.abi, functionName, result: c.call(functionName, (args ?? []) as readonly unknown[]) as never });
      }
      case "eth_getLogs": {
        const f = params[0] as { address?: Address; fromBlock: Hex; toBlock: Hex; topics?: Array<Hex | null> };
        this.calls.push({ method, blockTag: `${BigInt(f.fromBlock)}-${BigInt(f.toBlock)}` });
        const from = BigInt(f.fromBlock), to = BigInt(f.toBlock);
        return this.logs.filter((l) => l.blockNumber >= from && l.blockNumber <= to
          && (!f.address || l.address.toLowerCase() === String(f.address).toLowerCase())
          && (f.topics ?? []).every((t, i) => t === null || t === undefined || (Array.isArray(t) ? t.includes(l.topics[i]!) : t.toLowerCase() === l.topics[i]!.toLowerCase())))
          .map((l) => ({ address: l.address, topics: l.topics, data: l.data, blockNumber: numberToHex(l.blockNumber), blockHash: this.blockHash(l.blockNumber), transactionHash: pad(numberToHex(l.blockNumber), { size: 32 }), transactionIndex: "0x0", logIndex: numberToHex(l.logIndex), removed: false }));
      }
      default: throw new Error(`MockChain: unsupported method ${method}`);
    }
  }
}
