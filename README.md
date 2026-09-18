# Thru Wallet — Alphanet

Chrome MV3 self-custody wallet extension for the **Thru native Layer 1**. Built with vanilla ES modules, esbuild, and real Thru packages (`@thru/sdk`, `@thru/crypto`, `@thru/programs`).

> [!WARNING]
> Not production-ready. Use only with alphanet/devnet funds until security review and mainnet readiness are complete.

---

## Current state

- Single popup UI stack; no legacy popup fallback.
- 14 popup routes: welcome, unlock, dashboard, accounts, account detail, add account, keyring, export, send, receive, faucet, history, settings, reset.
- Contract version: **6**.
- Contract method count: **74**.
- Signing methods use `auth: 'signing'`: password re-authentication is required by default, with a password-gated user opt-out for session-only signing.
- Reset and auto-lock changes are background-hardened in contract v6.
- `src/launchpad/**` is still a built but feature-flagged legacy surface. Do not add real DEX/launchpad functionality there before module separation.
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
| [`docs/WALLET_FEATURES_PERFORMANCE_STUDY.md`](docs/WALLET_FEATURES_PERFORMANCE_STUDY.md) | Popular wallet feature study and no-lag popup/full-tab performance model. |
| [`docs/THRU_NATIVE_DEFI_TAB_UX.md`](docs/THRU_NATIVE_DEFI_TAB_UX.md) | Thru-native launchpad/DEX/full-tab architecture direction. |
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
- Network selection and custom dev networks.
- Password-gated secret export.
- Password-gated signing by default.
- Token mint derivation/deploy helpers where verified, but token transfer/balances are still incomplete.

---

## Known gaps

Highest priority:

1. Built legacy launchpad must be removed from build or migrated to guarded DOM before enabling.
2. Route mount tests are missing.
3. Token transfer and token balances are not implemented.
4. DEX/launchpad/prediction must be isolated into feature modules before adding real DeFi functionality.
5. Custom-network UI needs a security/capability decision before being promoted.
6. `@thru/programs` should be exact-pinned in a follow-up cleanup.

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
2. layering and DOM-sink checks,
3. route reachability/CSS checks,
4. contract/router/caller checks,
5. DOM helper security checks,
6. vault integration checks,
7. Thru client checks,
8. API router integration checks.

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
