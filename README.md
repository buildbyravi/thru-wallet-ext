# Thru Wallet — Alphanet

Chrome MV3 self-custody wallet extension for the **Thru native Layer 1**. Built with vanilla ES modules, esbuild, and real Thru packages (`@thru/sdk` and its `@thru/sdk/crypto` subpath, plus `@thru/programs`).

> [!WARNING]
> Not production-ready. Use only with alphanet/devnet funds until security review and mainnet readiness are complete.

---

## Current state

- Single popup UI stack; no legacy popup fallback.
- 14 popup routes: welcome, unlock, dashboard, accounts, account detail, add account, keyring, export, send, receive, faucet, history, settings, reset.
- Contract version: **7**.
- Contract method count: **74**.
- Signing methods use `auth: 'signing'`: password re-authentication is required by default, with a password-gated user opt-out for session-only signing.
- Reset and auto-lock changes are background-hardened in contract v6.
- Contract v7 quarantines legacy custom networks at the background boundary: saved records stay listable/removable, but direct activation is permanently refused and a stale active selection self-heals to Alphanet before RPC binding.
- Every route is mounted by a test: `test-route-lifecycle.mjs` drives all 14 routes through the real Router, guards and bridge in no-vault / locked / unlocked states, and asserts teardown, secret hygiene, modal focus trapping and the Settings guarantees. Layout, real focus and the side panel itself are a browser runbook: [`docs/MANUAL_SMOKE_CHECKLIST.md`](docs/MANUAL_SMOKE_CHECKLIST.md).
- Settings no longer offers "Add custom network". `network.upsertCustom` remains for contract compatibility but has no UI caller. A legacy saved record is shown as **not selectable**, with Remove as its only action; `network.setActive` enforces the same quarantine in the background.
- The manifest's side panel is reachable from the wallet: Settings > Window > **Open side panel**. It calls `chrome.sidePanel.open()` from a user gesture and never calls `setPanelBehavior`, so the toolbar icon still opens the popup.
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
| [`docs/MODULE_BOUNDARIES.md`](docs/MODULE_BOUNDARIES.md) | Target feature separation for launchpad, DEX, prediction, portfolio, and SDK adapters. |
| [`docs/MCP_AGENT_INTEGRATION.md`](docs/MCP_AGENT_INTEGRATION.md) | Safe AI-agent/MCP companion plan. |
| [`llms.txt`](llms.txt) | Short read-only repo LLM context; pair with official Thru protocol docs at `https://thru.org/docs/llm.txt`. |
| [`docs/AUDIT_REPORT.md`](docs/AUDIT_REPORT.md) | Security audit findings and remediation status. |
| [`docs/DEFECT_LOG.md`](docs/DEFECT_LOG.md) | Historical defects, root causes, and lessons. |
| [`docs/BACKEND_GAPS.md`](docs/BACKEND_GAPS.md) | Capability gaps and unsupported backend states. |
| [`docs/MANUAL_SMOKE_CHECKLIST.md`](docs/MANUAL_SMOKE_CHECKLIST.md) | Browser-only verification runbook: popup + side panel, narrow + wide widths, all 14 routes, focus, secret hygiene. |
| [`docs/WALLET_FEATURES_PERFORMANCE_STUDY.md`](docs/WALLET_FEATURES_PERFORMANCE_STUDY.md) | Popular wallet feature study and no-lag popup/full-tab performance model. |
| [`docs/THRU_NATIVE_DEFI_TAB_UX.md`](docs/THRU_NATIVE_DEFI_TAB_UX.md) | Thru-native launchpad/DEX/full-tab architecture direction. Research only; no shipped code corresponds to it. |
| [`docs/LAUNCHPAD_UX_STUDY.md`](docs/LAUNCHPAD_UX_STUDY.md) | Launchpad UX study. Retained research only. |
| [`docs/LAUNCHPAD_DEX_MIGRATION_UX.md`](docs/LAUNCHPAD_DEX_MIGRATION_UX.md) | Launchpad-to-DEX migration and charting study. Retained research only. |
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
- Password-gated signing by default.
- Token mint derivation/deploy helpers where verified, but token transfer/balances are still incomplete.

---

## Known gaps

Highest priority:

1. Run the browser-only smoke checklist for popup/side-panel layout, focus, canvas, and worker eviction.
2. Token transfer and token balances remain blocked on live Thru Token Program verification.
3. Custom networks remain quarantined until HTTPS/host-permission, verified chain-program capability, and re-authentication requirements are implemented together.
4. Any future launchpad/DEX/prediction work must be built as isolated feature modules. The legacy surface is deleted and nothing of the kind ships today.
5. `@thru/programs` and `@thru/sdk` are exact-pinned; derivation comes from `@thru/sdk/crypto` so the deprecated standalone crypto package is not installed.

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
node scripts/verify-live-e2e.mjs alphanet
node scripts/verify-autoregister.mjs alphanet
node scripts/verify-chain.mjs alphanet
node scripts/measure-fee.mjs alphanet
```

Historical alphanet results are tracked in `docs/STATUS_AND_ROADMAP.md` and `docs/PROJECT_LEDGER.md`.

---

## Security basics

- Never share a real seed phrase or private key.
- Never paste secrets into issues, chat, MCP tools, or logs.
- Secret export requires password re-authentication.
- Signing requires password re-authentication by default.
- Session-only signing is an explicit user setting and is less secure.
- Do not implement unverified protocol behavior.
- Do not invent a fake `window.thru` provider; future dApp integration must follow Thru's documented `connect()`, `getSigningContext()`, and `signTransaction()` flow.

---

## License

MIT. See [`LICENSE`](LICENSE).
