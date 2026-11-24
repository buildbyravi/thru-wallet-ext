# Architecture

**Document Class:** Authority (Implemented System Architecture)
**Baseline:** Contract **v34** (`155` methods, `15` routes) | **Status:** `IMPLEMENTED`, `TESTED` unless explicitly marked otherwise.

---

## 1. Dependency Direction and Enforced Layering

```text
Popup / Side-Panel Routes (src/ui/app/routes/*)
  -> src/ui/app/bridge.js               [sole outbound chrome.runtime.sendMessage caller]
  -> src/shared/contract/manifest.js    [v34 allowlist: 155 methods, 8 events, 65 error codes]
  -> src/background/api-router.js       [auth check -> v32 consentToken gate -> signing-guard -> dispatch]
  -> src/background/services/*          [wallet, tx, token, name, registrar, review, history, defi...]
  -> src/lib/*                          [sole leaf allowed to import @thru/sdk & @thru/programs]
```

Inbound background-to-UI push events flow exclusively from `src/background/services/event-service.js` to `bridge.js`.

`scripts/check-layering.mjs` enforces on every build and test run:
- `src/ui/**` never imports `src/background/**` or `src/lib/vault.js`, and never accesses `chrome.storage` directly.
- `src/lib/**` is a strict leaf (`lib-is-a-leaf`): it never imports UI, background, or feature modules, and `@thru/sdk` / `@thru/programs` imports are confined to `src/lib/**`.
- Feature internals (`src/background/features/<id>/**`, and any future `src/features/<id>/**`) cannot import sibling features or vault internals.
- Zero HTML-injection sinks (`innerHTML`, `outerHTML`, `insertAdjacentHTML`) across all `128` shipped runtime JS files (vendored `qrcode-generator.js` excluded).
- `scripts/check-cycles.mjs` ratchets import cycles across `src/` (`1` legacy 5-service transaction cycle allowed; zero new cycles permitted).

---

## 2. Single-Owner Module Authorities

| Concern | Single Authoritative Implementation |
| --- | --- |
| API method allowlist, auth levels & error codes | `src/shared/contract/manifest.js` (+ `defi-schema.js` for the 43 DeFi M0 methods) |
| Central auth, v32 `consentToken` gate & JSON envelope | `src/background/api-router.js` |
| Encryption, multi-keyring vault & HD derivation | `src/lib/vault.js` *(sacred — Rule 2)* |
| Thru RPC, EOA/NOOP/faucet/token builders & decoding | `src/lib/thru-client.js` *(sacred — Rule 2)* |
| Compute/memory/state units & header fee policy | `src/lib/tx-units.js` (`autoUnits`, `networkFeeUnits`) |
| Network configs & canonical program pins | `src/lib/networks.js` + `src/lib/bootstrap-pins.js` |
| Active network binding & v7 custom-RPC quarantine | `src/background/services/network-service.js` |
| BigInt money math & identifier shortening | `src/shared/format.js` (`formatThru`, `parseThruAmount`, `formatTokenAmount`, `shortenMiddle`, `shortAddress`) |
| Opaque account URL references | `src/shared/refs.js` |
| Global vs network-scoped storage keys | `src/shared/network-scope.js` (`GLOBAL_KEYS`, `SCOPED_KEYS`, `scopedKey`) |
| Review wire schema, TTL & review error registry | `src/shared/tx-review/model.js` + `registry.js` + `decoders/*.js` (`9` kinds) |
| Review preparation, rechecks & v32 consent tokens | `src/background/services/review-service.js` + `services/review/{kinds,store,consent}.js` |
| Review UI card & confirm->auth->submit execution | `src/ui/domain/tx-review/review-card.js` + `confirm.js` |
| Safe DOM node creation | `src/ui/kit/dom.js` (`h()`) |
| Transient event notifications (`toast`) | `src/ui/kit/toast.js` |
| Persistent inline screen state (`Banner`, `Empty`) | `src/ui/kit/feedback.js` |
| Clipboard copy control | `src/ui/kit/button.js` (`CopyButton`; `/receive` owns its inline `"Copied"` box) |

---

## 3. Shared UI Platform Contract (`test/test-shared-platform.mjs`)

Routes compose screens from `src/ui/kit/*` and `src/ui/domain/*` and obey five structural UI rules:

1. **Transient Events -> `toast()` (`Rule 26`):** Callers always pass a props object `{ tone, title, message?, key?, duration? }` — bare-string calls (`toast('...')`) are banned across `src/` by `test/test-toast.mjs` (internally `toast.js` normalizes strings to `{ title }` and returns an inert no-DOM handle on empty payloads as defense-in-depth). Tones: `success`, `info`, `warning`, `error`, `pending`. `dismissAllToasts()` runs automatically on wallet lock, account switch, and network switch.
2. **Persistent Screen State -> `Banner()`:** Tones `error`, `warning`, `info`, `success` (`ok` alias). `pending` is forbidden on `Banner` because banners have no automatic resolution lifecycle.
3. **One Surface Per Event (`Rule 29`):** A transaction submission opens one keyed `pending` `toast()` and resolves that **same** toast in place via `handle.update(...)`. Routes clear `Banner` and field-status lines before submitting and never duplicate submission outcomes across multiple surfaces.
4. **One Truncation Primitive:** Display shortening uses `shortenMiddle` / `shortAddress` (`truncateAddress` alias) in `src/shared/format.js`, preserving the full string in `title` / `aria-label` and in every wire or comparison value. Review counterparty addresses are **never** truncated (`word-break: break-all`).
5. **Non-Blocking First Paint (`Rule 15`):** Every route paints immediately from cached storage (`*.getCached*`) or explicit checking/unknown placeholders; live RPC hydration replaces placeholders asynchronously and labels stale data honestly.

---

## 4. Signing, Review, and Background Consent Boundary (`v29`–`v32`)

Startup and navigation follow D-027: boot paints a public unlock/onboarding surface before
bootstrap replies; synchronous guards use session state from authenticated responses/events.
Unknown auth cannot mount private screens, and backend auth remains mandatory on protected
methods. Same-context hydration preserves inputs. Lock/reset and newer navigation invalidate
late bootstrap work; route teardown clears secrets before awaiting any guard or view.

Full operational walkthrough: `docs/guides/transaction-review.md`.

- **UI Side (`Rule 16`):** Value-moving routes call `tx.prepareReview`, mount `TxReviewCard`, and submit via `confirm.js` (`submitReviewedReview` with a mandatory route `AbortSignal`). `test/test-tx-review.mjs` [14] scans `src/ui/`, `src/popup/`, and `src/features/` for both static `bridge.send('...')` literals and dynamic dispatch to guarantee no UI file calls an `auth: 'signing'` method directly.
- **Background Consent Gate (`v32`, `Rule 28`):** `tx.confirmReview` re-validates review readiness (`state === 'ready'`), TTL (`120s`), `bindingHash`, active account/network, acknowledgements, and kind-specific chain rechecks, then mints a one-time 32-byte `consentToken` (`60s` TTL, in-memory `Map` in `src/background/services/review/consent.js`) bound to `{ method, sha256(canonicalParams), accountAddress, networkId }`. `api-router.js` verifies and burns `consentToken` before `signing-guard.js` or any handler runs, refusing unreviewed calls with `REVIEW_REQUIRED`.
- **Two Documented Router Exemptions (`CONSENT_EXEMPT`):**
  1. `tx.registerAccount` (`auth: 'unlocked'`): exact vault-owned self-registration (`NOOP_PROGRAM_ADDRESS`, fee `0n`, nonce `0n`, `stateUnits: 1`), invoked at account creation, on `/dashboard`, and JIT on `/send`.
  2. `intent.submit` (`auth: 'signing'`): dark-launched DeFi M0 method gated off behind `FLAGS.DEFI_INTENT === false` (`FEATURE_DISABLED`).
- **Network-Mutation Lock (`D-010`):** Because `thru-client.js` binds a process-level SDK client, `signing-guard.js` blocks `network.setActive` from signing-operation entry through submission completion.
- **Session Boundary Cleanup (`Rule 21`):** Manual lock, auto-lock alarm (`walletService.lock()`), locked worker startup, account switch, network switch, and wallet reset clear both `tx_reviews` and in-memory `consentToken`s.

---

## 5. Persistent Storage and Network Scoping (`src/shared/network-scope.js`)

- **Session Memory Only (`chrome.storage.session`):** `unlocked_session` (decrypted keyrings/keys; wiped immediately on lock, extension reload, or browser exit). Additionally, v32 `consentToken`s live strictly in worker JS memory (`Map`), never in `chrome.storage`.
- **Global Persistent Keys (`GLOBAL_KEYS`, `11` keys in `chrome.storage.local`):** `vault` (v1 PBKDF2-600k + AES-256-GCM envelope), `vault_legacy_backup_v1`, `unlocked_session` (session store), `active_account_ref`, `thru_account_labels`, `thru_contacts` (schema v1), `thru_prefs` (schema v1), `thru_system_autolock_minutes`, `thru_unlock_lockout`, `thru_active_network`, `thru_custom_networks` (quarantined inert).
- **Network-Scoped Keys (`SCOPED_KEYS`, `9` base keys via `scopedKey(base, networkId)`):**
  1. `thru_balance_cache::<networkId>` (rebuildable native balance cache)
  2. `thru_token_balance_cache::<networkId>` (rebuildable verified token balance cache)
  3. `thru_pending_txs::<networkId>` (schema v1, per-network serialized queue)
  4. `thru_deployed_tokens::<networkId>` (token registry / visibility)
  5. `thru_history_cache::<networkId>` (per-address cached stream + chain-identity check)
  6. `defi_intents::<networkId>` (dark-launched G2-S0 intent store)
  7. `thru_primary_names::<networkId>` (wallet-local primary domain alias)
  8. `thru_registered_domains::<networkId>` (schema v1 revision-guarded tracked domain inventory; `docs/guides/domains-and-registrar.md`)
  9. `tx_reviews::<networkId>` (schema v1 serialized prepared-review store, `120s` TTL, cap `40`)

Durable schemas migrate legacy `v0` shapes losslessly and **fail closed** on unknown future schema versions (`test/test-storage-migrations.mjs`).

---

## 6. Optional Feature Isolation & Smart Contract Policy

- Optional product surfaces (DEX, Launchpad, Markets, Profiles) are decoupled from wallet core per `docs/MODULE_BOUNDARIES.md` and gated off behind build-time `FLAGS` (`Rule 25`).
- On-chain program integrations and `contracts/thru-custom-registrar` follow `docs/GLOBAL_SMART_CONTRACT_POLICY.md`.
