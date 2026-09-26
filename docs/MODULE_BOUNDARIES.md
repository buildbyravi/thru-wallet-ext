# Module boundaries and feature separation plan

Date: 2026-09-26
Purpose: define how the wallet should be split so launchpad, DEX, prediction, portfolio, backend services, and SDK adapters can evolve independently without accidental cross-feature edits.

This document records the shipped wallet-core boundaries and separately labels a proposed feature-module target. The target modules below do **not** exist in the shipped source unless explicitly named as current in §1.

---

## 1. Current structure assessment

Current code structure for the wallet core is:

```txt
src/ui/app/routes → bridge.send() → v12 contract/router → background services → vault / thru-client
```

The current contract has 81 methods. Signing requires an unlocked wallet; password re-authentication
is opt-in and defaults off. v12 account registration is the narrow unlocked-only exception for an
exact vault-owned address. History uses a network/address-scoped cache and ships as a flat stream;
popup/side-panel mutual exclusion is implemented in the shared page. These are shipped core
behaviors, not feature-module target examples.

Strengths:

- One popup route stack.
- One sanctioned UI/background seam.
- Contract manifest is the API allowlist.
- Background owns auth and signing policy.
- UI cannot import vault/background without layering checks.
- Core wallet routes are separate files.
- `src/lib/vault.js` and `src/lib/thru-client.js` are tested sacred layers.

Former weakness for future DeFi/launchpad scale — **resolved by deletion**:

```txt
src/launchpad/launchpad.js   (deleted)
```

was a single legacy, built-but-flagged-off area where DEX and prediction were tabs inside the launchpad rather than isolated feature modules, so a DEX UI fix could touch launchpad state/rendering and a launchpad backend fix could alter DEX code. It also rendered token-controlled values through `innerHTML` outside the DOM-sink ratchet and quoted swaps from `parseFloat()` and a hard-coded rate.

That file no longer exists, is not built, and cannot be re-enabled by URL, flag or control (`test/test-launchpad-quarantine.mjs`). The wallet ships one page, `popup.html`. The proposed shape below is not a migration path from a live feature; it is only a possible boundary for any separately approved launchpad, DEX, or prediction implementation.

---

## 2. Proposed target shape — not shipped

The following is a proposal only. There is no `src/features/`, `src/background/features/`,
`src/lib/thru/` adapter directory, feature registry, or split feature contract in the current
runtime. Do not describe these proposed modules as present or shipped.

If separately approved, a future design may move toward feature modules with clear frontend,
background, shared-contract, and Thru adapter boundaries:

```txt
src/features/
  launchpad/       # deploy/create tokens only
    ui/
    model/
    tests/
  dex/             # quotes, pools, swaps only
    ui/
    model/
    tests/
  prediction/      # markets, orders, settlement only
    ui/
    model/
    tests/
  portfolio/       # optional future read-only portfolio module
    ui/
    model/
    tests/

src/background/features/
  launchpad/
    launchpad-service.js
    launchpad-handlers.js
  dex/
    dex-service.js
    dex-handlers.js
  prediction/
    prediction-service.js
    prediction-handlers.js
  portfolio/
    portfolio-service.js
    portfolio-handlers.js

src/lib/thru/
  client-adapter.js        # thin wrapper around current thru-client/network binding
  token-adapter.js         # @thru/programs/token only
  amm-adapter.js           # @thru/programs/amm only
  oracle-adapter.js        # @thru/programs/oracle only
  clob-adapter.js          # @thru/programs/clob only if verified
  read-adapter.js          # official gRPC/gRPC-Web transport after endpoint/devnet validation
  indexer-adapter.js       # future derived read/indexer adapter where needed
  intent-builder.js        # shared transaction intent builder, no signing

src/shared/contract/
  manifest.js              # still the source of truth
  feature-manifests/       # optional generated/imported fragments later
    launchpad.js
    dex.js
    prediction.js
```

Do not create this whole tree in one rewrite. Migrate one feature at a time.

---

## 3. Namespaces

Each feature owns one backend API namespace.

| Feature | Namespace | Examples | Notes |
| --- | --- | --- | --- |
| Wallet core | `wallet.*`, `account.*`, `keyring.*`, `tx.*`, `network.*`, `settings.*`, `contacts.*` | existing | Core is not optional and should stay stable. |
| Launchpad | `launchpad.*` | `launchpad.prepareCreate`, `launchpad.listMine`, `launchpad.getTokenPage` | Token creation/deploy lifecycle only. |
| DEX | `dex.*` | `dex.quote`, `dex.prepareSwap`, `dex.listPools`, `dex.getPool` | Quotes, swaps, pools, liquidity only. |
| Prediction | `prediction.*` | `prediction.listMarkets`, `prediction.prepareOrder` | Prediction market data/orders only after verified primitives. |
| Portfolio | `portfolio.*` | `portfolio.summary`, `portfolio.positions` | Mostly read-only aggregator. |
| MCP companion | not extension namespace | local MCP tools create intents only | Must not sign/export secrets. |

Rules:

1. A feature may not call another feature directly.
2. A feature may call shared core services through explicit interfaces.
3. Feature UI calls only its own namespace or stable wallet core methods.
4. Feature backend handlers may not import UI files.
5. Feature UI may not import background handlers/services.
6. No feature imports `src/lib/vault.js` directly.
7. Value-moving signing occurs only through the shared signing/intent path; the current narrow `tx.registerAccount` exception does not grant feature code direct signing authority.

---

## 4. Frontend isolation

Feature frontend modules should expose a route factory and pure UI/model helpers.

Example target:

```txt
src/features/dex/
  ui/dex-route.js
  ui/swap-panel.js
  ui/pool-card.js
  model/quote-state.js
  model/slippage.js
  tests/dex-route.test.mjs
```

Frontend rules:

- DEX UI cannot import launchpad UI.
- Launchpad UI cannot import DEX UI.
- Shared primitives live in `src/ui/kit/**` or `src/ui/domain/**` only if genuinely reusable.
- A feature route takes data from `bridge.send()`, not direct RPC or background imports.
- Use `h()` from `src/ui/kit/dom.js`; no `innerHTML`, `insertAdjacentHTML`, or `outerHTML`.
- Heavy charts and screeners belong in full-tab routes, not popup routes.

---

## 5. Backend isolation

Feature backend code should expose handler maps or explicit functions to the central `api-router`.

Target pattern:

```js
// src/background/features/dex/dex-handlers.js
export const dexHandlers = {
  'dex.quote': (params) => dexService.quote(params),
  'dex.prepareSwap': (params) => dexService.prepareSwap(params),
};
```

Backend rules:

- DEX backend cannot import launchpad backend.
- Launchpad backend cannot import DEX backend.
- Feature services receive public account refs/addresses, not decrypted key material.
- Mutation methods prepare transaction intents; they do not sign directly.
- API router enforces auth before dispatch.
- Network-specific data uses `src/shared/network-scope.js`.
- Every handler must be declared in the contract manifest.

---

## 6. SDK/sub-SDK adapter layer

Official Thru package surfaces should be wrapped by small adapter modules. This makes upstream Thru SDK/API format changes easier to isolate.

Target adapters:

| Adapter | Owns | Must not own |
| --- | --- | --- |
| `token-adapter.js` | Token Program builders/parsers/derivations from `@thru/programs/token` | UI state, wallet auth, unrelated AMM logic |
| `amm-adapter.js` | AMM pool derivation, quotes, swaps, liquidity builders from `@thru/programs/amm` | Token launch wizard UI, prediction markets |
| `oracle-adapter.js` | Oracle reads/builders if official and verified | Price fabrication |
| `clob-adapter.js` | CLOB/order builders only if official and verified | AMM swaps |
| `read-adapter.js` | Official gRPC/gRPC-Web transport after endpoint/devnet validation | Signing or vault access |
| `indexer-adapter.js` | Future derived read/indexer model where needed | Signing or vault access |
| `intent-builder.js` | Typed transaction intent objects | Secret material or direct broadcast |

Adapter rules:

1. Official Thru SDK/program APIs beat hand-written protocol code.
2. Keep adapters thin and covered by tests.
3. If Thru changes an official builder signature, most edits should happen in one adapter file and its tests.
4. Adapters never read passwords, vaults, or UI state.
5. Adapters return typed data/instructions/intents; background signing path handles auth and submission.

---

## 7. Transaction intent model

Every future mutating feature should follow this path:

```txt
feature UI
  → feature.prepare* method
  → background feature service validates user input
  → Thru adapter builds a typed transaction intent
  → API returns review data, not a signature
  → user reviews in extension popup/full-tab signing surface
  → auth:'signing' policy is applied
  → shared signer signs/submits
  → pending tx tracker records result
```

Intent example shape:

```js
{
  id: 'intent_...',
  kind: 'dex.swap',
  networkId: 'alphanet',
  accountRef: { keyringId: '...', accountIndex: 0 },
  review: {
    title: 'Swap THRU to TOKEN',
    warnings: [],
    debits: [],
    credits: [],
    fee: { supported: false, reason: '...' }
  },
  instructions: 'opaque-or-builder-owned-data',
  expiresAt: 1790000000000
}
```

Intent rules:

- No secret material in intents.
- No password in intents.
- No raw private key/mnemonic in intents.
- No fake balance changes.
- Intents expire.
- Prepared quotes must be refreshed before signing if stale.
- Duplicate-submission protection lives in shared transaction/pending-tx services.

---

## 8. Preventing accidental cross-feature edits

Add guardrails incrementally:

1. Extend `scripts/check-layering.mjs` and its tests to enforce boundaries among actual `src/features/<feature>` and `src/background/features/<feature>` directories when those modules are introduced.
2. Add a rule: `src/features/dex/**` must not import `src/features/launchpad/**`, and vice versa.
3. Add a rule: feature UI cannot import `src/background/**` or `src/lib/**`.
4. Add a rule: feature background cannot import `src/ui/**`.
5. Add contract tests by namespace.
6. Add per-feature test commands later:

```bash
node test/test-feature-dex.mjs
node test/test-feature-launchpad.mjs
node test/test-feature-prediction.mjs
```

7. Add CODEOWNERS-like review guidance in docs if GitHub CODEOWNERS is not desired.

---

## 9. Incremental migration plan

### Phase A — stabilize wallet core — DONE

- `wallet.reset` confirmation and unlocked-wallet password policy are enforced in the background (v6).
- Auto-lock changes are password-gated (v6).
- All 14 routes mount through the real Router/guards/bridge under the deterministic DOM shim (`test/test-route-lifecycle.mjs`).
- Signing methods use the background `auth: 'signing'` policy (v5); its password re-auth preference defaults off and can be enabled only through the password-gated security-settings API.
- Custom-network activation is rejected and stale active IDs are healed before RPC binding (v7).
- v8–v12 additions include token balances/transfers, History feed/detail, checked Send context, owned-account registration, and storage-only cached History. Current source authority is `src/shared/contract/manifest.js` (v12, 81 methods).

### Phase B — quarantine legacy launchpad — DONE

Option 1 was taken, and further than "remove from build": `src/launchpad/**` is deleted, along with the `FEATURE_LAUNCHPAD`/`FEATURE_TOKEN_DEPLOY` flags, the `?launchpad=1` override, the dashboard banner, and `src/popup/icons.js` + `src/popup/toast.js` (launchpad-only). `build.mjs` wipes `dist/` so no stale `launchpad.html` survives, and `scripts/check-layering.mjs` now scans all of `src/` for DOM sinks.

No new launchpad/DEX behavior may be added anywhere except a Phase D feature module. `test/test-launchpad-quarantine.mjs` fails the build otherwise.

### Phase C — proposed adapter skeletons — NOT SHIPPED

No adapter skeletons are present under `src/lib/thru/`. If a future implementation is approved,
add tested adapter seams only where official Thru packages provide the surface:

```txt
src/lib/thru/token-adapter.js
src/lib/thru/amm-adapter.js
src/lib/thru/indexer-adapter.js
```

Return unsupported states where not verified.

### Phase D — launchpad module — NOT SHIPPED

No launchpad feature ships. Any future token-create/deploy UX would require a new reviewed implementation in `src/features/launchpad` and a `launchpad.*` boundary; it must not restore the deleted legacy page or imply token deployment is a current UI capability.

### Phase E — DEX module — NOT SHIPPED

No DEX, swap, quote, or pool UI ships. Any future implementation requires verified Thru program/API behavior and a new `src/features/dex` boundary; it may not use launchpad internals.

### Phase F — prediction module — NOT SHIPPED

No prediction-market implementation ships. A future proposal must wait for verified official Thru-native primitives and must not use simulated orders or fabricated market behavior.

---

## 10. Definition of done for a feature module

A feature is not “separate” until all of these are true:

- Own directory under `src/features/<name>`.
- Own background directory under `src/background/features/<name>` or equivalent handler module.
- Own contract namespace.
- Own tests.
- Own storage keys or declared shared keys.
- No imports from sibling features.
- No imports from vault internals.
- Value-moving mutations use transaction intents and `auth: 'signing'`; any non-value operation needs a separately documented, narrowly scoped policy.
- Unsupported chain capability is explicit and tested.
- Build/tests pass.

---

## 11. Non-goals

- Do not rewrite the wallet core just to create feature directories.
- Do not add React/Vue/Tailwind just to imitate another wallet.
- Do not implement fake AMM/DEX/launchpad/chart behavior.
- Do not invent unverified Thru dApp provider behavior. The official [Embedded Wallet Integration](https://thru.org/docs/wallet/embedded-wallet-integration/) describes the hosted iframe at `https://app.tid.sh/embedded`; the standalone
`https://wallet.tid.sh` host sends `X-Frame-Options: DENY`. Neither is an extension/BYO-signer contract. Do not add `window.thru` until an extension-compatible contract is published and verified.
- Do not let MCP or an AI agent sign directly.
