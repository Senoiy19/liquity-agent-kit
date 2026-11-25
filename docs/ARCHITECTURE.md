# Architecture

## High-level flow

```text
AI agent / application
        |
        v
Agent tools (typed functions + JSON Schemas)
        |
        v
Protocol services (read operations + deterministic calculations)
        |
        +------ Core domain models / units / errors
        |
        v
EVM adapters (viem clients, ABI bindings, block-pinned reads)
        |
        v
Versioned deployment registry + pinned upstream ABI artifacts
        |
        v
Ethereum RPC provider
```

An optional MCP adapter should wrap the same agent-tool functions. MCP is an adapter, not the business-logic layer. A future REST API or framework-specific adapter should also reuse those functions.

## Contract topology

Liquity V2 has a shared layer and branch-level systems. The kit must model this explicitly:

- Shared layer: `CollateralRegistry`, `BOLDToken`, and shared helper contracts.
- Branch layer: contracts such as `BorrowerOperations`, `TroveManager`, `StabilityPool`, `SortedTroves`, `ActivePool`, and branch-specific price feeds.

A branch is not just a collateral symbol. It is a deployment context with its own addresses, parameters, state, and price-feed behavior.

## Proposed module boundaries

### `core`

- Branded integer types for wei/token base units and rates.
- Protocol-neutral result metadata: `chainId`, `blockNumber`, `blockHash`, `source`, `observedAt`.
- Domain models for `Deployment`, `Branch`, `Trove`, `StabilityPool`, and `ReadResult<T>`.
- Typed errors such as unsupported chain, unknown branch, RPC failure, stale data, and inconsistent snapshot.

### `evm`

- Public-client construction and RPC configuration.
- Deployment registry lookup.
- ABI loading and contract read adapters.
- Block-pinned reads and bounded multicall support.
- No private key or wallet-client dependency in V1.

### `agent-tools`

- One deterministic function per capability.
- JSON Schema for each input and output.
- Descriptions written for agents: purpose, when to use, required inputs, units, caveats, and side effects.
- Tool outputs include provenance and warnings, not just values.

### `mcp-adapter`

- Registers `agent-tools` functions as MCP tools/resources.
- Contains no duplicate protocol calculations.
- Can be hosted independently or run locally over stdio.

## Data-source policy

- **On-chain contract reads:** authoritative for contract state at the specified block.
- **Subgraph/indexer:** useful for discovery, history, and pagination; indexed results must identify indexer/source and indexing lag where available.
- **External market data:** never silently substituted for the protocol's own oracle value. Label market price and protocol price separately.
- **Documentation:** explanatory source, not live state.

## Consistent snapshots

A multi-contract read should use a common block tag when the provider supports it. If the kit cannot guarantee a consistent block across calls, the result must disclose that limitation.
