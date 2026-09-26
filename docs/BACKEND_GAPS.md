# Backend capability inventory and open gaps

**Status as of 2026-09-26:** the originally identified Tier A and Tier B capabilities are implemented. This file distinguishes shipped code from behavior that is still unsupported or requires live-chain verification. Contract v12 has 81 methods; `src/shared/contract/manifest.js`, its router handlers, and tests are authoritative.

| Tier | Meaning | Status |
| --- | --- | --- |
| A | Additive service/API/storage capabilities | ✅ Implemented; see §1 |
| B | Additive vault/account operations | ✅ Implemented and covered by tests; see §1 |
| C | Protocol, live-chain, browser, or external integration uncertainty | ⚠️ Open or explicitly unsupported; see §2 |
| D | Unreviewed in-place API shape changes | ⛔ Forbidden except documented security-policy changes; see §3 |

---

## 1. Shipped capabilities

| Original gap | Shipped implementation |
| --- | --- |
| A1 — batch balances | `tx.getBalances`, `tx.getCachedBalances`, and `tx.getTotalBalance`; balance cache is network-scoped, and partial/unknown reads are not silently turned into fresh zeroes. |
| A2 — first paint blocked by health RPC | Bootstrap returns without waiting for network-health probing; UI routes load secondary reads independently where implemented. Send renders after active account/network metadata and does not wait for balance, fee, token, or picker reads before showing its form. |
| A3 — push events | `src/background/services/event-service.js` emits declared account, lock, network, balance, and pending-transaction events; the UI bridge consumes them. |
| A4 — account order/pin/hide | Preference-backed account ordering, pinning, and hiding are implemented without changing vault keys. |
| A5 — send whitelist | The whitelist preference is security-gated and enforced at the background signing boundary; generic `settings.set` cannot change security-sensitive keys. |
| A6 — generic preferences | `settings.get`/`settings.set` use validated, versioned preferences; security fields use the separate password-gated `settings.setSecurity` path. |
| A7 — history pagination | `tx.listHistory` supports cursor paging while retaining the legacy positional form. `tx.getHistoryFeed` provides the cache-merged first page and offline/sync status. |
| A8 — custom RPC activation | Contract v7 deliberately quarantines custom activation: `network.setActive` accepts enabled built-ins only; stale custom/disabled/unknown active IDs heal before client binding. Legacy custom rows can be listed/removed but not selected. |
| A9 — token registry and balances | Token registry/import/visibility APIs are implemented. `token.getBalances` reads owned balances for registry mints using official `@thru/programs/token` bindings; proven-zero and unknown/error remain distinct. Token state is network-scoped. |
| A10 — pending transaction lifecycle | `pending-tx-service.js` tracks submissions, reconciliation, badge state, and duplicate protection. Pending records are network-scoped. A concurrent storage read-modify-write race remains open; see §2. |
| B1 — derive and preview HD accounts | `account.previewHd` derives candidates without persisting them. |
| B2 — remove one HD account | `account.removeHd` removes an eligible HD account while preserving the keyring's required remaining account. |
| B3 — backup provenance/state | Seed keyrings record generated/imported origin and backup state (`backedUpAt`) through the keyring API. |
| B4 — batch HD derivation | `account.addHdBatch` persists multiple derived accounts in one vault update. |
| Additional — account/keyring creation | Seed creation keeps fresh entropy in the background; account/keyring creation paths use the bounded creation-bound account-activation helper. |
| Additional — checked Send context | Contract v11 adds `tx.sendChecked` and `token.transferChecked`; source account and network from Review are checked at the backend boundary around preflight work. |
| Additional — owned-account activation | Contract v12 adds `tx.registerAccount` (`auth: 'unlocked'`) for an exact address in the unlocked vault. It self-signs with that account; Send calls it just in time only after a successful absence check for a selected/typed owned recipient. External contacts are never registered by the sender. |
| Additional — History first paint | Contract v12 adds storage-only `tx.getCachedHistory`; cache is scoped by network and address, painted before the RPC feed/pending reads, and serialized writes preserve concurrent accounts. Block-time provenance is retained. |

These are implementation claims backed by `src/` and local tests, not a claim that the corresponding live-chain or real-browser checks have all been performed.

---

## 2. Open or unsupported capabilities

### C1. Token balances — implemented; token-transfer behavior still needs live verification

`token.getBalances` is a real implementation, not the former capability stub. It reads the wallet's registry mints through the pinned official Token Program bindings. Missing token accounts are represented as proven zero; failed or malformed reads remain unknown. Mint decimals are read from chain data rather than trusted from editable registry metadata.

This does **not** establish the end-to-end behavior of `token.transferChecked` on a live node. Whether the Token Program accepts a never-registered wallet address as the owner of a sender-created token account, and what the token-program transaction actually costs, remain open. Use `scripts/verify-token-transfer.mjs` only in a network-reachable, throwaway-wallet environment; see `docs/STATUS_AND_ROADMAP.md` and `docs/MANUAL_SMOKE_CHECKLIST.md`.

### C2. Pre-send fee estimate — native and token cases are different

The native transfer fee has a historical Alphanet observation of 1 base unit and is kept in per-network configuration with provenance. That observation does not establish the token-program fee. The Send UI does not substitute the native amount for an unmeasured token fee; it identifies that token fee as unmeasured. Reconfirm fee behavior for the current network before treating an estimate as a live-chain guarantee.

### C2b. Charged fee in transaction history — not reported by the current detail response

The transaction detail API exposes a header-declared fee (`feeDeclaredUnits`) and explicitly reports `feeCharged: false`; the UI labels the row **Fee (declared)**. A declared value is an input in the transaction header, not proof of what was debited. Do not relabel it as a charged/paid fee or infer a debit from the pre-send estimate.

The current RPC detail response has no charged-fee field. Whether an authoritative charged-fee value is available through another typed explorer surface remains open. Thru's documented [Explorer MCP overview](https://thru.org/docs/api-ref/explorer-mcp/overview/) is an agent-facing reference; it is not, by itself, a stable typed API contract for the extension.

### C2c. Block time — optional, and the current lookup still needs live checks

Transactions carry a slot; an optional containing-block time can be resolved through the SDK. The shipped History path records a verified value with `timestampSource: 'block'`, scopes lookup/cache identity by network, RPC endpoint, and slot, and performs header reads outside the serialized cache-write section. Paginated entries are enriched as they are displayed. For the wallet's own sends, an actual local submission time may be used only as a fallback; otherwise the card shows `Block <slot>`.

`test/test-history-block-time.mjs` and `test/test-history-cache.mjs` exercise deterministic fixtures, collisions, races, missing-time fallback, and paging. They do not establish that every live node supplies block time or measure first-load latency. Recheck the current feed on each enabled network in a real environment.

### C3. Transaction simulation — unsupported

`tx.simulate` remains an explicit unsupported capability. No predicted token/balance effect is fabricated, and there is no shipped transaction-simulation UI.

### C4. dApp signing — no extension provider is shipped

The official [Embedded Wallet Integration](https://thru.org/docs/wallet/embedded-wallet-integration/) describes the hosted iframe at `https://app.tid.sh/embedded`. `https://wallet.tid.sh` is the standalone wallet host and sends `X-Frame-Options: DENY`; it is not the embedded URL. These hosted-wallet APIs do not define an extension/BYO-signer provider contract. This extension does not inject `window.thru`, and no dApp connector is claimed shipped. Any extension integration requires a published and verified contract for origin discovery, permissions, approval transport, signing ownership, and submission semantics.

Official Thru cross-checks: [Thru docs](https://thru.org/docs/), [API/SDK overview](https://thru.org/docs/api-ref/overview/), [`@thru/sdk`](https://thru.org/docs/sdks/web-packages/sdk/), [`@thru/programs`](https://thru.org/docs/sdks/web-packages/programs/), and [gRPC API overview](https://thru.org/docs/api-ref/grpc/overview/). Check against the exact dependency versions pinned by this repository.

### Other open checks

- Live contract-v12 account creation/registration and Send JIT activation, including MV3 worker suspension/restart behavior.
- Live signing race if the selected network changes after the last preflight check but during SDK signing/submission.
- Concurrent pending-record storage writes on the same network.
- Real-Chrome popup/side-panel layout, focus, context exclusion, QR rendering, and worker lifecycle.
- Confirmation of the explorer transaction route; do not turn an unverified URL convention into a protocol guarantee.

The owners and the test/live/browser boundaries are tracked in `docs/STATUS_AND_ROADMAP.md`, `docs/SEND_PATH_AUDIT.md`, and `docs/MANUAL_SMOKE_CHECKLIST.md`.

---

## 3. Contract compatibility rule

Ordinary feature work appends methods rather than changing existing parameter or return shapes. This contract is not an excuse to preserve an unsafe policy: the documented v5 signing-auth, v6 destructive-settings, and v7 custom-network security changes are intentional in-place security exceptions. Contract tests in `test/test-contract.mjs` check method/router/UI agreement and key security invariants. Do not silently widen a method's authority or reinterpret an existing field.
