# Thru Wallet — Betanet

Chrome MV3 self-custody wallet extension for the **Thru native Layer 1**. Built with vanilla ES modules, esbuild, and real Thru packages (`@thru/sdk` and its `@thru/sdk/crypto` subpath, plus `@thru/programs`).

**Betanet is Thru's final testnet before mainnet** (official launch at the TOKEN2049 Singapore event, early October 2026 — the chain is already live). It replaces the single-node alphanet (which processed over 10 million blocks) with a 10-node network and ~6-second blocks — a transfer settles in about one block. Network id: `betanet` (`https://rpc.betanet.thru.org`, explorer `https://scan.thru.org` with `?network=betanet`).

> [!IMPORTANT]
> **Betanet deployment. Mainnet engineering standard.** Source remediations are implemented and
> tested locally; real-browser checks, specified live-network verification, security review, and an
> external audit remain required. See `docs/STATUS_AND_ROADMAP.md` and `docs/AUDIT_REPORT.md`.

---

## Current state

- Single popup UI stack; no legacy popup fallback.
- 14 popup routes: welcome, unlock, dashboard, accounts, account detail, add account, keyring, export, send, receive, faucet, history, settings, reset.
- Contract version: **16**; **81** methods.
- Value-moving methods use centralized `auth: 'signing'`, checked account/network context, and a
  network-mutation lock through submission. Session-only signing is the explicit default; users may
  enable per-sign password re-authentication, and changing that security setting is password-gated.
- Reset and auto-lock changes are background-hardened in contract v6.
- Contract v7 quarantines legacy custom networks at the background boundary: saved records stay listable/removable, but direct activation is permanently refused and a stale active selection self-heals to Betanet before RPC binding.
- Every route is mounted by a test: `test-route-lifecycle.mjs` drives all 14 routes through the real Router, guards and bridge in no-vault / locked / unlocked states, and asserts teardown, secret hygiene, modal focus trapping and the Settings guarantees. Layout, real focus and the side panel itself are a browser runbook: [`docs/MANUAL_SMOKE_CHECKLIST.md`](docs/MANUAL_SMOKE_CHECKLIST.md).
- Settings no longer offers "Add custom network". `network.upsertCustom` remains for contract compatibility but has no UI caller. A legacy saved record is shown as **not selectable**, with Remove as its only action; `network.setActive` enforces the same quarantine in the background.
- Side Panel Mode is an explicit Settings preference. It is persisted through the versioned backend
  preference service and re-applied after worker restart; popup/panel mutual exclusion is covered by
  deterministic tests and remains subject to the real-Chrome runbook.
- Password dialogs trap keyboard focus (`src/ui/kit/focus-trap.js`): Tab wraps inside the dialog, Escape cancels, and focus returns to the control that opened it.
- The legacy launchpad/DEX/prediction surface is **quarantined**: `src/launchpad/**` is deleted, no launchpad page is built into `dist/`, and the `?launchpad=1` override is gone. `test-launchpad-quarantine.mjs` keeps it out. Research docs are retained; backend `token.*` methods are unchanged.
- Thru is **not EVM**. Rabby/MetaMask/Phantom/Keplr/etc. are UX references only.

---

## Documentation

Start with the docs index:

| File | Purpose |
| --- | --- |
| [`docs/DOCS_INDEX.md`](docs/DOCS_INDEX.md) | Map of all maintained docs, archive rules, and duplicate-context decisions. |
| [`AGENTS.md`](AGENTS.md) | Rules, commands, traps, security constraints, and reporting format. |
| [`docs/PROJECT_LEDGER.md`](docs/PROJECT_LEDGER.md) | Past/present/future build ledger and current identifiers. |
| [`docs/STATUS_AND_ROADMAP.md`](docs/STATUS_AND_ROADMAP.md) | Current state, verified/not verified items, and next tasks. |
| [`CONTEXT.md`](CONTEXT.md) | Current file-by-file repository map. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Implemented dependency, signing, storage, and verification boundaries. |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Durable decisions with alternatives, trade-offs, and consequences. |
| [`docs/MODULE_BOUNDARIES.md`](docs/MODULE_BOUNDARIES.md) | Target feature separation for launchpad, DEX, prediction, portfolio, and SDK adapters. |
| [`docs/archive/MCP_AGENT_INTEGRATION.md`](docs/archive/MCP_AGENT_INTEGRATION.md) | Archived AI-agent/MCP companion planning record. |
| [`llms.txt`](llms.txt) | Short read-only repo LLM context; pair with official Thru protocol docs at `https://thru.org/docs/llm.txt`. |
| [`docs/AUDIT_REPORT.md`](docs/AUDIT_REPORT.md) | Security audit findings and remediation status. |
| [`docs/DEFECT_LOG.md`](docs/DEFECT_LOG.md) | Historical defects, root causes, and lessons. |
| [`docs/BACKEND_GAPS.md`](docs/BACKEND_GAPS.md) | Capability gaps and unsupported backend states. |
| [`docs/MANUAL_SMOKE_CHECKLIST.md`](docs/MANUAL_SMOKE_CHECKLIST.md) | Browser-only verification runbook: popup + side panel, narrow + wide widths, all 14 routes, focus, secret hygiene. |
| [`docs/archive/WALLET_FEATURES_PERFORMANCE_STUDY.md`](docs/archive/WALLET_FEATURES_PERFORMANCE_STUDY.md) | Popular wallet feature study and no-lag popup/full-tab performance model. |
| [`docs/archive/THRU_NATIVE_DEFI_TAB_UX.md`](docs/archive/THRU_NATIVE_DEFI_TAB_UX.md) | Thru-native launchpad/DEX/full-tab architecture direction. Research only; no shipped code corresponds to it. |
| [`docs/archive/LAUNCHPAD_UX_STUDY.md`](docs/archive/LAUNCHPAD_UX_STUDY.md) | Launchpad UX study. Retained research only. |
| [`docs/archive/LAUNCHPAD_DEX_MIGRATION_UX.md`](docs/archive/LAUNCHPAD_DEX_MIGRATION_UX.md) | Launchpad-to-DEX migration and charting study. Archived research only. |
| [`docs/archive/`](docs/archive/) | Historical plans only; do not use as current state. |

---

## Architecture

```txt
src/ui/app/routes/*
  ↓ bridge.send(method, params)
src/background/api-router.js
  ↓ auth + contract validation + dispatch
src/background/services/*
  ↓ adapters
src/lib/vault.js        # sacred crypto/session/keyring layer
src/lib/thru-client.js  # sacred Thru RPC/transaction/program layer
src/lib/networks.js     # network/program config
```

Important boundaries:

- UI never imports background services, vault internals, or RPC internals.
- Background owns auth and signing.
- `src/shared/contract/manifest.js` is the API allowlist.
- `src/ui/kit/dom.js` is the guarded DOM factory for the main UI.
- Money is BigInt internally and stringified over Chrome messages.
- Network-specific data is scoped per network.

Target future feature split is documented in [`docs/MODULE_BOUNDARIES.md`](docs/MODULE_BOUNDARIES.md):

```txt
src/features/launchpad/
src/features/dex/
src/features/prediction/
src/background/features/*
src/lib/thru/*-adapter.js
```

---

## What works today

- Create a seed-based wallet.
- Import a recovery phrase.
- Import a private key.
- Lock/unlock.
- Multiple seed/private-key keyrings.
- Multiple accounts.
- Account labels, hiding, pinning, ordering.
- Receive address and QR.
- Native THRU send.
- Faucet claim where the active network supports a faucet.
- Transaction history decoding where known.
- Pending transaction tracking.
- Selection between enabled built-in networks; legacy custom-network records can be reviewed and removed but not activated.
- Password-gated secret export.
- Centralized checked signing with an optional password-per-sign policy.
- Token balances and checked token transfer are implemented with official Token Program bindings;
  the remaining live-chain questions are explicitly listed in `docs/STATUS_AND_ROADMAP.md`.

---

## Known gaps

Highest priority:

1. Run the browser-only smoke checklist for popup/side-panel layout, focus, canvas, and worker eviction.
2. Token transfer is implemented on the official Token Program bindings, but two live-chain questions remain open: whether a never-registered recipient owner can receive a sender-initialized token account, and the actual token-program fee (`scripts/verify-token-transfer.mjs`).
3. Custom networks remain quarantined until HTTPS/host-permission, verified chain-program capability, and re-authentication requirements are implemented together.
4. Any future launchpad/DEX/prediction work must be built as isolated feature modules. The legacy surface is deleted and nothing of the kind ships today.
5. An external wallet security audit has not been performed; no mainnet-readiness claim is valid without it.

See [`docs/STATUS_AND_ROADMAP.md`](docs/STATUS_AND_ROADMAP.md) for the live ordered list.

---

## Commands

```bash
npm install
npm test
npm run build
npm audit --omit=dev
```

`npm test` runs:

1. derivation checks,
2. layering and DOM-sink checks (all of `src/`),
3. route reachability/CSS checks,
4. launchpad quarantine checks (source, flags, routes, manifest, and a real `dist/` build),
5. contract/router/caller checks,
6. DOM helper security checks,
7. vault integration checks,
8. Thru client checks,
9. API router integration checks.

Load `dist/` as an unpacked extension in Chrome/Chromium after `npm run build`.

---

## Live verification scripts

These are not part of `npm test` because they touch a live network:

```bash
node scripts/verify-live-e2e.mjs betanet
node scripts/verify-autoregister.mjs betanet
node scripts/verify-chain.mjs betanet
node scripts/measure-fee.mjs betanet
```

Historical testnet results are tracked in `docs/STATUS_AND_ROADMAP.md` and `docs/PROJECT_LEDGER.md`.

---

## Security basics

- Never share a real seed phrase or private key.
- Never paste secrets into issues, chat, MCP tools, or logs.
- Secret export requires password re-authentication.
- Signing requires an unlocked wallet. Password re-authentication per signature is **off by
  default** (`docs/DECISIONS.md` D-003): while unlocked, the session can sign, and the
  password-per-signature policy is an explicit, password-gated Settings opt-in.
- Do not implement unverified protocol behavior.
- Thru's current official wallet docs describe `@thru/wallet` connecting to the hosted
  `app.tid.sh/embedded` iframe; they do not establish an extension provider contract.
- Do not invent a fake `window.thru` provider or infer extension compatibility from the hosted
  `connect()`, `getSigningContext()`, and `signTransaction()` methods. Wait for a verified
  extension/BYO-signer contract.

---

## License

MIT. See [`LICENSE`](LICENSE).
