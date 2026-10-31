# Global Smart Contract Engineering Policy

Status: AUTHORITATIVE
Version: 1.0 (2026-10-28)
Applies to: Domains, Token Standards, AMM / DEX, Liquidity Pools, Launchpad, Predictions, DeFi, and all future on-chain integrations.

---

## 1. Core Principle: Mainnet-Ready Engineering

This repository produces production software intended to custody and transfer real assets on the Thru L1 Mainnet. Betanet is an operational testing environment, not an excuse for compromised security, unverified protocol assumptions, simulated balances, or bypasses of cryptographic verification.

Every contract integration, transaction builder, parameter encoder, and signing route must be built under the assumption that real funds are permanently at risk.

---

## 2. Inspect Before Deciding to Reuse or Build

Before implementing or modifying any feature that interacts with on-chain programs:

1. **Protocol & SDK Inspection**: Inspect the official `@thru/sdk`, `@thru/programs`, protocol specifications, official repository sources, and existing wallet implementations.
2. **Capability Audit**: Identify exact supported methods, instruction opcodes, memory layouts, account derivations (PDAs), role permissions, event emissions, gas/state unit bounds, and failure modes.
3. **Behavior Comparison**: Compare the desired user experience against verified on-chain capabilities.
4. **Gap Identification**: Explicitly record whether the protocol supports the operation natively, partially, or not at all.
5. **Architectural Selection**: Choose the safest maintainable architecture and document the trade-offs in `docs/DECISIONS.md`.

### Absolute Prohibitions:
- **Never fabricate protocol behavior**: Unsupported operations must be reported honestly as unsupported. Never simulate or invent state transitions in the UI.
- **Never hand-roll protocol crypto or instruction encoding**: Reuse `@thru/sdk` and verified `@thru/programs` packages.
- **Never assume a deployed contract is sufficient**: Existing deployments must be verified against current node versions, instruction sets, and account layouts.

---

## 3. Contract Reuse Versus Deploying a New Contract

Prefer official protocol interfaces and standard SDK methods whenever they satisfy feature requirements.

If existing contracts cannot safely or correctly support a required capability, evaluate the following hierarchy:
1. **Official Extension Points**: Use documented, supported protocol extension points or multi-instruction compositions.
2. **Adapter Contract**: Deploy an audited, minimal adapter contract that composes existing contracts without taking custody of user keys or unneeded assets.
3. **Purpose-Built Program**: Deploy a new dedicated program specifically designed for the feature requirements.
4. **Deferral**: Defer the feature if protocol prerequisites, security invariants, or tooling maturity are insufficient.

### Mandatory Requirements for New Programs / Contracts:
- **Single Responsibility**: Minimal attack surface with isolated responsibilities.
- **Strict Accounting**: Arithmetic must be mathematically checked against underflow/overflow using integer types only (no floating point).
- **Authorization & Access Control**: Explicit signer verification for fee-paying and authority accounts. Reject unverified EOA or PDA signers.
- **Deterministic Derivation**: Predictable, verified PDA seeds.
- **Comprehensive Test Coverage**: Unit tests covering happy paths, adversarial inputs, edge cases, reentrancy (if applicable), and revert conditions.
- **Deployment Provenance**: Bytecode, compiler flags (`-Tlink.x`), deployment transaction signatures, program IDs, and initial configurations must be checked into version control.

---

## 4. Policy for Reusing Official Contract Source Code

Official contract source code may be adapted to create an extended or improved version (e.g., custom registrar) only when all of the following conditions are met:

1. **License & Compliance**: Permitted by upstream licenses and protocol rules.
2. **Deficiency Justification**: The official contract lacks a critical capability (e.g., direct native-asset payment vs. wrapped token requirements) that cannot be cleanly achieved via client-side composition.
3. **Invariant Preservation**: All security invariants, state-rent rules, authorization checks, and accounting consistency of the original contract must be preserved or strengthened.
4. **Namespace Disambiguation**: The modified contract must use distinct program IDs, configuration addresses, and user-facing labels. It must **never** masquerade as the official system program.
5. **Documentation of Deltas**: Every deviation from the upstream source must be explicitly documented with rationales and test proofs.
6. **Regression Testing**: Both original upstream behavior and extended features must be verified by automated test suites.

---

## 5. Mainnet Deployment Gate

No on-chain contract or contract-dependent wallet feature may be activated for Mainnet use without satisfying all six deployment gates:

1. **Static Analysis & Compilation Verification**:
   - Zero compiler warnings, clean assembly/ELF linking (`link.x`), verified reproducible build hashes.
2. **Deterministic Automated Testing**:
   - 100% pass rate across unit, integration, and route-lifecycle suites.
   - Golden vectors locked for all transaction encodings, signatures, and PDA derivations.
3. **Multi-Network Provenance**:
   - Program deployed, initialized, and verified on Betanet first.
   - Verified integration with active wallet frontends under real RPC conditions.
4. **Key & Governance Security**:
   - No private keys or deployer mnemonics committed to repositories.
   - Upgrade authorities, treasury keys, and emergency pauses assigned to multi-sig or verified governance addresses.
5. **Failure & Rollback Playbook**:
   - Documented operational response for RPC divergence, gas price spikes, chain halts, or contract reverts.
   - Clear client-side fallback behavior (graceful degradation without wallet deadlock).
6. **Independent Audit & Review**:
   - Security review signed off and indexed in `docs/AUDIT_REPORT.md`.

---

## 6. Integration With Wallet Architecture

- **No Bypass of the Review Pipeline**: All transactions must route through `tx.prepareReview` -> `TxReviewCard` -> `tx.confirmReview` -> signing service. No UI component may bypass the review card or create independent signing sessions.
  - **Stated exception — owned-account activation.** `tx.registerAccount` is a direct, unlocked signing call made by Dashboard and Send for an address the vault already owns (the v12 JIT activation path); it is self-signing only for an exact vault-owned address and is not a value-moving transaction. It is the only such call: no UI route signs a transfer, register/purchase/renew/claim, faucet claim or record write directly (`docs/TX_REVIEW_VERIFICATION.md` §3).
- **Deterministic Scoping**: Contract addresses and program configs are strictly network-scoped. Switching networks purges and invalidates stale contract state.
- **BigInt Arithmetic Only**: All monetary and balance calculations must use integer string base units. No `parseFloat()` or floating-point arithmetic.
