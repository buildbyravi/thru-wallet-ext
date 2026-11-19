# Thru Protocol, SDK Adapters, and RPC Reference

**Document Class:** Authority (Topical Guide — Implemented Protocol Layer)
**SDK upgrade (2026-11-18):** `@thru/sdk`/`@thru/programs` moved 0.4.4 → 0.5.1, then patched to 0.5.2 (D-030). HD coin type 9999 → 8478 (goldens regenerated; no legacy path), `ROOT_MANAGER_PROGRAM_ADDRESS` → `CORE_MANAGER_PROGRAM_ADDRESS`, managed program addresses re-pinned, and token accounts gained an account-type discriminator byte. Live chain reverification is still open.
**Baseline:** `@thru/sdk@0.5.2` & `@thru/programs@0.5.2` (exact pins) | **Status:** `IMPLEMENTED`, `TESTED`; live Betanet provenance noted per item.
**Related Authorities:** `AGENTS.md` (Rules 2, 5, 6, 19) · `docs/DECISIONS.md` (D-002, D-007, D-016, D-022) · `docs/BACKEND_GAPS.md`

---

## 1. Infrastructure Leaf Boundary (`src/lib/`)

`src/lib/` is a strict dependency leaf (`scripts/check-layering.mjs` `lib-is-a-leaf`): it is the **only** directory allowed to import `@thru/sdk` (including `@thru/sdk/crypto`) and `@thru/programs`, and it may never import `src/ui/`, `src/background/`, or feature code.

| File | Responsibility |
| --- | --- |
| `vault.js` *(sacred)* | PBKDF2-HMAC-SHA256 (600k iterations, per-vault v1 KDF envelope) + AES-256-GCM encryption, multi-seed & private-key keyrings, `@thru/sdk/crypto` HD derivation (`test/test-derivation.mjs` golden vectors). |
| `thru-client.js` *(sacred)* | SDK RPC client binding, account/block/tx reads, EOA transfer, NOOP account creation, faucet withdraw, `@thru/programs/token` mint/account/transfer instructions, history decoding, `getTransactionDetail`. |
| `networks.js` | Built-in network definitions (`betanet` enabled; `localnet`, `testnet`, `mainnet` declared disabled), fee provenance, RPC/explorer URLs, program address map. |
| `bootstrap-pins.js` | Re-exports canonical program addresses from `@thru/programs/bootstrap-addresses` and `@thru/sdk`. |
| `tx-units.js` | Automatic compute/memory/state resource budgeting (`autoUnits`, `payloadFloor`) and unified header fee calculation (`networkFeeUnits`). |
| `name-service.js` | Official system Name Service PDA derivations (`rootRegistrarAddress`, subdomain PDAs) and first-party `initRoot` / `register` / `APPEND_RECORD` instruction builders/parsers. |
| `registrar.js` | Official `.thru` paid registrar config/lease parsers and `purchase` / `renewLease` / `claimExpired` builders. |
| `custom-registrar.js` | `thru-custom-registrar` ABI v2 client (`InstructionContext` sorted-account index resolution, layout-1/layout-2 `RegistrarConfig` & `DomainLease` parsers, tiered `pricePerYearFor` / `totalForTerm`). |
| Native faucet policy | The native THRU faucet has no per-account rate limit. The legacy `tx.getFaucetLimit` method returns not applicable; THRUSD rate limits are separate. |
| `amm.js` | `@thru/programs/amm` pool derivation, state parser, constant-product `quoteAmmSwapExactIn`, and swap instruction helpers (used by dark-launched `dex-service.js`). |
| `feed-crypto.js` | `@thru/sdk/crypto` Ed25519 `SignatureDomain.MSG` verification for signed off-chain feed records (`feed-record.js`). |

---

## 2. Thru L1 Wire & Execution Facts (Non-EVM / Non-Solana)

AI agents must never import EVM or Solana assumptions into Thru code:

1. **Addresses, Signatures & Scale:** Thru addresses are 46-character `ta...` and signatures are 90-character `ts...` base64url + 2-byte CRC16 strings (`isValidThruAddress` validates the real SDK checksum). Native `THRU` uses **9 decimals** (`1 THRU = 1,000,000,000` base units, `src/shared/tokens.js`). All money math is `BigInt` internally and decimal/base-unit strings over JSON messaging (`src/shared/format.js`).
2. **Bridge Timeout, Duplicate Guard & Non-Destructive Caches:** `src/ui/app/bridge.js` enforces a `30_000 ms` (`30s`) request ceiling (`SERVICE_TIMEOUT`, alongside `PORT_ERROR` / `NO_RESPONSE`). `tx.checkDuplicate` flags repeat transfers within a `30s` window (or while in-flight) on a **mint-aware** key (`allowDuplicate` required to proceed). Failed live native/token balance reads never overwrite a verified cached snapshot with `0` (`stale: true` / `error: true` preserved).
3. **Owned-Account Creation Retries (`registration-service.js`):** Creation-time `tx.registerAccount` retries transient transport errors up to `MAX_RETRIES = 3` (`500 ms`, `1 s`, `2 s` backoff), aborts immediately without retry on `NOT_OWNED_ACCOUNT`, `WALLET_LOCKED`, `NETWORK_CHANGED`, `INVALID_ADDRESS`, or `vmError` reverts, and re-derives keys fresh via `vault.resolveAccount` inside `beforeSign` so private keys never linger across timers.
4. **SDK Account-List Byte Sorting (`ABI v2` Trap):** `@thru/sdk@0.5.2` byte-sorts `readWrite` and `readOnly` account segments during `normalizeAccountList` (`[feePayer(0), program(1), sorted-rw..., sorted-ro...]`). Instructions therefore carry `u16` account-table indices inside instruction data resolved via `InstructionContext.getAccountIndex`, never hardcoded positional indices (`test/test-custom-registrar.mjs`).
5. **Explicit Resource Units (`src/lib/tx-units.js`):** `@thru/sdk@0.4.1+` zeroed default units in `accounts.create()`. Every `buildAndSign` call site in `thru-client.js` (all 7 pinned by `test/test-thru-client.mjs` [12]) supplies explicit `computeUnits`, `memoryUnits`, and `stateUnits` via `autoUnits`:
   - `CREATE`: `10,000 CU / 10,000 MU / 1 SU`, sponsored (`fee: 0n`, `nonce: 0n`).
   - `CLAIM` / `TRANSFER`: `300,000 CU / 10,000 MU / 1,024 SU` floor (`claim` sponsored `0n`; `transfer` pays `networkFeeUnits`).
   - `TOKEN_OP`: `300,000 CU / 60,000 MU / 2,048 SU` floor.
   - `SWAP`: `1,000,000 CU / 60,000 MU / 2,048 SU` floor (live Betanet swap consumed `56,105 CU` in `2026-10-25-live-swap-probe.json`).
   - *Mainnet Pre-Enablement Note:* `autoUnits` currently passes `baseFeeUnits: 1n` to `networkFeeUnits`, whereas registrar/name-service writes pass the active network's `baseFeeUnits`. Before enabling Mainnet (`baseFeeUnits: null` until measured), wire `autoUnits` to read the active network's `baseFeeUnits` (`docs/BACKEND_GAPS.md` C2).
6. **Transaction Expiry (`expiryAfter`):** Native sends, faucet claims, and token transfers set `expiryAfter: SEND_EXPIRY_SLOTS` (`1,000` slots) and record `{ startSlot, expiryAfter }` on pending records (`test/test-thru-client.mjs` [13]). Custom registrar writes use a `10,000`-slot window.
7. **On-Chain Account Existence vs Token Accounts:**
   - `@thru/programs/token` 0.5.x prefixes every account with a one-byte discriminator: `1` = mint (116 bytes total), `2` = token account (74 bytes: the old 73-byte payload plus the tag). The bare pre-0.5 payload is rejected by `parseMintAccountData`/`parseTokenAccountData`; the wallet validates the same footprint before parsing (`src/lib/thru-client.js`). Canonical token-account seed remains `zeros32`, with no delegate or close authority.
   - Native EOA transfers require the recipient wallet account to exist on-chain (`NOOP_PROGRAM_ADDRESS` self-signed creation). An external never-activated address cannot be registered by the sender (`RECIPIENT_NOT_ACTIVATED`).
   - Token accounts are deterministic PDAs (`deriveTokenAccountAddress`) initialized by the sender in a preceding transaction when absent. Live Betanet run `2026-10-23-live-chain-run3.json` confirmed that a sender **can** initialize a token account and transfer tokens to a **never-registered** recipient wallet (`created: true`), while that recipient's native wallet remains unregistered (`1` base unit observed per token tx; `2` base units across init + transfer).
8. **Instruction Tag Widths & Program Limits:** Native EOA transfer and Faucet withdraw use **4-byte** little-endian tags (`u32` tag `1`, 16-byte payload); `@thru/programs/token` uses **1-byte** tags (`0` `InitializeMint`, `1` `InitializeAccount`, `2` `Transfer` 13B, `3` `MintTo` 15B) and adds `TransferChecked` in 0.5.x; it still publishes no `SetAuthority`, `Burn`, `Freeze`, or `CloseAccount` builder; `@thru/programs/amm` (`PoolMetadata = 227 B`, `AMM_DEFAULT_SWAP_FEE_BPS = 30`, `AMM_MINIMUM_LIQUIDITY = 1_000n`, `AMM_LP_DECIMALS = 9`, 5 event decoders) supports exact-in `Swap` without an on-chain deadline field; Name Service and Registrars use **4-byte** `u32` tags.

**Package metadata:** The installed manifests for `@thru/sdk@0.5.2` and `@thru/programs@0.5.2` both declare `Apache-2.0`. Neither declares a `preinstall`, `install`, `postinstall`, or `prepare` script. See the [0.5.2 package snapshot](../../scripts/defi-evidence/2026-11-18-package-surface-0.5.2.json) (the [0.4.4](../../scripts/defi-evidence/2026-11-18-package-surface.json) snapshot remains historical evidence), generated from the lockfile install with `node scripts/collect-offline-evidence.mjs --check`.

---

## 3. RPC, Protobuf, Oracle, and Explorer Boundaries

Distilled from SDK protobuf inspection and Betanet probes (`scripts/defi-evidence/`):

- **No Charged-Fee Field on `TransactionExecutionResult`:** The RPC execution receipt exposes `consumed_compute_units`, `consumed_memory_units`, `consumed_state_units`, `vm_error`, `user_error_code`, `pages_used`, `events`, and `readwrite`/`readonly` accounts. `Transaction.fee` echoes `header.fee` (declared input), and `StreamSlotMetricsResult.claimedFees` is a slot-wide aggregate. Never label `header.fee` as "Fee paid".
- **No Dry-Run Simulation RPC:** Neither `@thru/sdk@0.5.2` nor the gRPC spec exposes a verified `simulateTransaction` endpoint (`tx.simulate` -> `{ supported: false }`).
- **Explorer MCP (`https://scan.thru.org/api/mcp`) is Agent-Only:** Wraps an undocumented explorer endpoint returning `format=toon` LLM text with silent `?rpc=` fallback, missing browser CORS headers, and signature-only `list_account_transactions` (`1 + N` round-trips vs 1 direct gRPC-Web `listTransactionsForAccount` call with CEL `Filter`). Never call it from extension runtime code. Note also that official Thru docs show inconsistent transaction URL paths (`/txs/{sig}` vs `/transaction/{sig}` vs wallet `/tx/{sig}?network={id}`), so `/tx/` deep links remain open for live browser verification while `/address/{addr}?network={id}` is verified.
- **First-Party Oracle (`@thru/programs/oracle`):** Uses standard `accounts.get` against the existing allowlisted RPC origin (zero extra CSP `connect-src` hosts). Live probe `q22` (`2026-10-06..23`) confirmed **no `thru-usd` oracle feed** is deployed on Betanet today.
- **`@thru/indexer` & `@thru/replay`:** Node/Postgres/Drizzle server packages — never import or bundle into the browser extension.
- **gRPC-Web Streaming (`@thru/sdk` `StreamingClient`):** Uses `@connectrpc/connect-web` against the existing RPC origin; available as a future alternative to polling after MV3 service-worker suspension testing.
