# Module boundaries and feature separation plan

Date: 2026-09-18  
Purpose: define how the wallet should be split so launchpad, DEX, prediction, portfolio, backend services, and SDK adapters can evolve independently without accidental cross-feature edits.

This is a target architecture document. It does not claim these modules already exist.

---

## 1. Current structure assessment

Current code structure is strong for the wallet core:

```txt
UI routes → bridge.send() → contract/router → background services → vault/RPC adapters
```

Strengths:

- One popup route stack.
- One sanctioned UI/background seam.
- Contract manifest is the API allowlist.
- Background owns auth and signing policy.
- UI cannot import vault/background without layering checks.
- Core wallet routes are separate files.
- `src/lib/vault.js` and `src/lib/thru-client.js` are tested sacred layers.

Current weakness for future DeFi/launchpad scale:

```txt
src/launchpad/launchpad.js
```

is still a single legacy, built-but-flagged-off area. DEX and prediction are concepts/tabs inside it, not isolated feature modules. That means a future DEX UI fix could accidentally touch launchpad state/rendering, and a launchpad backend fix could accidentally alter DEX code.

---

## 2. Target shape

Move toward feature modules with clear frontend, background, shared-contract, and Thru adapter boundaries:

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
  indexer-adapter.js       # @thru/replay / @thru/indexer / gRPC reads
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
7. Signing occurs only through the shared signing/intent path.

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
| `indexer-adapter.js` | `@thru/replay`, `@thru/indexer`, gRPC/gRPC-Web reads | Signing or vault access |
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

1. Extend `scripts/check-layering.mjs` to understand `src/features/<feature>` and `src/background/features/<feature>`.
2. Add a rule: `src/features/dex/**` must not import `src/features/launchpad/**`, and vice versa.
3. Add a rule: feature UI cannot import `src/background/**` or `src/lib/**`.
4. Add a rule: feature background cannot import `src/ui/**`.
5. Add contract tests by namespace.
6. Add per-feature test commands later:

```bash
node test-feature-dex.mjs
node test-feature-launchpad.mjs
node test-feature-prediction.mjs
```

7. Add CODEOWNERS-like review guidance in docs if GitHub CODEOWNERS is not desired.

---

## 9. Incremental migration plan

### Phase A — stabilize wallet core

- Fix `wallet.reset` background policy.
- Password-gate auto-lock changes.
- Add route mount tests.
- Keep signing auth on contract v5.

### Phase B — quarantine legacy launchpad

Choose one:

1. Remove launchpad from build while disabled, or
2. Move it behind feature routing and migrate DOM to `h()` before enabling.

No new launchpad/DEX behavior should be added inside the current monolithic `src/launchpad/launchpad.js`.

### Phase C — create adapter skeletons

Add empty-but-tested adapter seams only where official Thru packages provide the surface:

```txt
src/lib/thru/token-adapter.js
src/lib/thru/amm-adapter.js
src/lib/thru/indexer-adapter.js
```

Return unsupported states where not verified.

### Phase D — launchpad module

Move token creation/deploy UX into `src/features/launchpad`. Its backend owns `launchpad.*` methods. It may use `token-adapter.js` but may not use DEX internals.

### Phase E — DEX module

Create `src/features/dex`. Its backend owns `dex.*` methods. It may use `amm-adapter.js`, `token-adapter.js`, and indexer reads. It may not use launchpad internals.

### Phase F — prediction module

Only after official Thru-native CLOB/oracle/market primitives are verified. Until then, keep unsupported states.

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
- All mutation paths use transaction intents and `auth: 'signing'`.
- Unsupported chain capability is explicit and tested.
- Build/tests pass.

---

## 11. Non-goals

- Do not rewrite the wallet core just to create feature directories.
- Do not add React/Vue/Tailwind just to imitate another wallet.
- Do not implement fake AMM/DEX/launchpad/chart behavior.
- Do not invent unverified Thru dApp provider behavior.
- Do not let MCP or an AI agent sign directly.
