# Product specification

## Problem

An AI agent can read prose about Liquity, but that does not automatically give it reliable access to the protocol. It still needs to know which contracts are shared, which are branch-specific, how Troves are identified, how values are denominated, what must be read at a consistent block, and which calculations are approximations.

The Agent Kit should turn those integration details into reusable interfaces.

## Primary users

- Developers building AI agents that monitor or interact with Liquity.
- Builders integrating Liquity into wallets, dashboards, bots, research agents, and automation systems.
- Agent-framework developers who need machine-readable tools and predictable return types.

## Product promise

Give developers a consistent, typed way to discover Liquity deployments, read protocol state, run deterministic calculations, and expose those capabilities to agents without each project reimplementing protocol plumbing.

## V1 scope

### Included

- Liquity V2 core on Ethereum mainnet as the first supported protocol deployment.
- Versioned deployment metadata with source links and verification status.
- Read-only contract access.
- Typed domain models for branches, Troves, BOLD, and Stability Pools.
- Deterministic calculations whose inputs and assumptions are visible.
- JSON Schemas and tool descriptions suitable for agent frameworks.
- Examples for common read and analysis workflows.

### Explicitly excluded from V1

- Private-key storage, wallet custody, transaction signing, or transaction submission.
- Autonomous borrowing, repayment, collateral withdrawal, liquidation, redemption, or rate changes.
- Claims that a Trove is safe based on a single health metric.
- Risk-adjusted yield rankings without a separately specified risk model and data sources.
- Automatic support for every chain where BOLD is bridged or deployed. A BOLD token deployment does not by itself mean the full Liquity V2 core is deployed there.
- Replacing Liquity's official documentation or documentation MCP.

## Capability groups

1. **Discovery:** supported networks, protocol version, shared contracts, branch contracts, ABI/deployment provenance.
2. **Read:** BOLD token metadata and balances; branch parameters; Trove state; wallet-owned Troves; Stability Pool state and deposits.
3. **Calculate:** collateral ratio, liquidation price, debt/collateral conversions, borrowing-cost scenarios, and operation precondition checks where all required inputs are available.
4. **Agent interface:** stable tool names, JSON Schema inputs, structured outputs, explicit side effects, and error codes.
5. **Future write planning:** construct unsigned transaction requests and simulation plans only after read-only V1 is reliable. Signing/submission remains outside the core kit initially.

## Non-functional requirements

- Pin upstream source revisions for ABIs and deployment manifests.
- Include chain ID and block number/hash in on-chain read results.
- Use integer/decimal-safe arithmetic; never use JavaScript floating point for token amounts or protocol math.
- Make RPC provider errors and partial data visible.
- Bound pagination and multicall sizes.
- Test deterministic math independently from RPC integration.
- Document every approximation and every unsupported protocol state.


### Redemption and interest-rate intelligence (v0.3.2)

The kit can locate a Trove in its branch's redemption order (lowest interest rate first, from the tail of the sorted list) and sum the debt that would be redeemed before it. It also provides a bounded branch-wide rate distribution with count percentiles, arithmetic/debt-weighted means and a rate histogram. These are block-pinned snapshots. The debt-ahead metric is branch-local, not a cross-branch redemption forecast.
