# Modular UX Architecture 

To future-proof the Thru wallet, structure it as **modular layers with feature flags**, not a monolithic rewrite.  For example, use a static feature flag (boolean) to *hide* incomplete features like the launchpad or DEX.  Martin Fowler’s feature-toggle pattern recommends decoupling *deploy* from *release*: new code can be shipped in “off” mode and later switched on without redeploying.  Practically, introduce a config flag (e.g. `FLAGS.FEATURE_LAUNCHPAD = false`) so the UI routes and banner are omitted until ready.  **Don’t create an empty `desktop.html`**; instead, reserve that name and keep the current code behind a flag.  This matches common practice: LaunchDarkly notes that feature flags let code exist in production without executing.  Once the feature is stable, remove the flag and integrate fully, then delete old code paths to avoid clutter.  (Long-lived static flags should be cleaned up post-launch to prevent technical debt.)

# Multi-Network Support 

Design the app as a **multi-chain wallet**: each blockchain is a separate “network context.”  Many wallets (Brave, MetaMask, etc.) treat network choice as a global mode.  In fact, MetaMask recently improved its UI to “remember” which network was used per dapp, highlighting that balances, tokens, pending TXs, etc. must be isolated by network.  In practice: store all cache and state _per network_ (e.g. indexed by chain ID).  For example, keep separate token registries and pending‑tx lists for Devnet vs. Mainnet, so switching networks shows only that chain’s data (otherwise you’d see Devnet TXs on Mainnet by mistake).  As a rule, **only the vault (keys/accounts) stays global**; everything else (balances, tokens, pending TX) should be scoped by the active network.  Implement a network selector in the settings to toggle “Devnet/Mainnet” and re-render.  Since testnets are on the roadmap, build this from the start – even an “Add Network” option with URL and Chain ID – so adding Ethereum/Mainnet or local chains later is just data entry, not code changes.  That way, the app can point to different RPC endpoints without re-architecting.

# Frontend/Backend Decoupling 

Strictly enforce a **ports-and-adapters (hexagonal) architecture**.  The UI layer should **never import** wallet, crypto or network code directly.  All background work (vault, signing, RPC calls) lives in `src/background` and is accessed through `src/ui/bridge.js`.  In other words, treat `thru-client.js` and `vault.js` as backend ports, and have only adapter code talk to them.  This ensures the UI remains oblivious to crypto details and changes under the hood.  The AWS Architecture Blog describes this well: a hexagonal design “creates loosely coupled components” so the “application logic doesn’t depend on external factors”.  

Concretely, introduce **thin service interfaces (ports)** for each domain concept and have UI screens call those. For example, instead of `<script>vault.getActiveAccount()</script>` in a page, use something like `api.getActiveAccount()`, where `api` is an adapter talking to the bridge.  This lets you swap out implementations (e.g. mock vs real) without touching screen code.  A great example is a case study where a frontend was built entirely with mock adapters first, then flipped to real network calls one endpoint at a time. The UI components called generic repository functions (like `getStandingsRepo().listGroups()`); initially a static in-memory adapter returned fixed data, and later the real API adapter was activated behind a feature toggle.  **No UI code had to change** once the real API was live. We should follow the same pattern: build screens against domain models, then connect them to `bridge`-based adapters.

Because the Thru SDK and chain are evolving, **pin versions and use golden tests** to avoid silent breakage.  Currently `@thru/sdk` versions use caret (`^`), meaning installs can auto-upgrade minor releases. But even a minor bump could change key derivation or tx formats. The Semaphore guide warns that caret ranges can pull in newer versions “which *in theory* should be compatible, but may not”. To be safe, pin critical packages (or use exact version ranges) and run `npm ci` in CI, which fails if `package-lock.json` mismatches.  

**Add a golden derivation test.** Fix a known mnemonic and assert the derived address matches a constant. This mirrors what blockchain teams do: for example, Cardano wallet devs wrote a test that compares the entire derived address against the official CLI output. They noted *“if intermediate representations don’t match, then the final address won’t either”*, so comparing full addresses is a sufficient check. We should do likewise for the Thru chain’s HD derivation: run a closed-form test to catch any accidental algorithm change (which would otherwise silently break all wallets).  

# Incremental Refactoring Plan 

Avoid any big-bang rewrite of the legacy popup. Instead, **migrate step-by-step**, screen-by-screen.  Follow the “Preserve → Abstract → Isolate → Test → Extract → Redesign → Extend” strategy. For each feature: first *preserve* existing behavior, then *abstract* it behind new domains/ports, then *extract* into a self-contained screen or component, and finally extend or overhaul the UI. This mirrors proven tactics in other systems. One Android engineer says: “Build new screens and features using modern patterns [while] keeping legacy implementation isolated. Then refactor legacy screens *only when needed*”. In practice, do not rewrite all screens at once. Instead: 

- **Define domain models**: Create `src/domain/wallet-model.js` and `src/domain/asset.js` (as per the plan). These should encapsulate data shapes like Wallet → Accounts and Asset (native/token/NFT) without behavior changes. This introduces a stable API for UI. 
- **Build routing and store**: Add a `router.js` and `store.js` so screens can be mounted/unmounted cleanly. This will replace the monolithic `popup.js`. We can migrate one screen to the router at a time (e.g. Welcome → Dashboard → History, etc.) and verify each step.
- **Shared components**: Extract reusable UI pieces (AccountRow, WalletGroup, etc.) as modules. Reuse existing ones when possible. 
- **One screen at a time**: For each screen (dashboard, send flow, history, settings, etc.), follow: mount → cleanup → update. Verify tests and manual flows after each extraction. This minimizes risk. 

Crucially, **never commit a half-migrated codepath**. After each extraction, run all wallet tests (`test-vault.mjs`, `test-thru-client.mjs`, `test-api-router.mjs`) and rebuild. The AWS guide emphasizes that with hexagonal design “you can test components independently without any dependencies on the infrastructure”. So we should have unit tests for domain logic (vault, client) and integration tests for API routes, ensuring the UI still triggers the same background effects. Tools like Jest with JSDOM or Puppeteer could smoke-test popup screens once ported.

# Planning for Future Modules

Design the extension so that **new features live in their own modules**, not entangled with core wallet logic. For example, if adding tokens, NFTs, DEX, or launchpad later, place them under `features/` (e.g. `features/launchpad/`). Use the adapter approach: each feature consumes the wallet’s domain interfaces (accounts, send, etc.) but has its own components and state. This prevents “pet feature” code from bleeding into the core, making the system maintainable. (Remember: the wallet’s core — vault, HD handling, key storage — is its own layer. Everything else is a feature that sits on top via well-defined interfaces.) 

By building features **individually and incrementally**, we minimize merge conflicts and duplicated work. For instance, if tokens UI starts out simpler, factor out common parts (e.g. address input, amount input) into shared components so the next feature (NFTs) can reuse them. This echoes the ports approach from Saad Hasan’s example: they “added the port and first adapter”, then migrated each calling site one by one. Here we’ll create new screens/adapters per feature and wire them up gradually, testing each in isolation.

# Additional Considerations

- **Testing & CI:** Besides the existing wallet tests, add E2E/smoke tests for the UI. For example, use automated scripts (e.g. Puppeteer) to simulate the flows: create wallet, import key, switch accounts, send valid/invalid tx, receive, etc. This catches regressions as screens move. Also include tests that UI cannot call background code directly (maybe a static analysis or test that tries to import vault from UI and fails).
  
- **Migration of stored data:** If the data model changes (e.g. store tokens per-network now), write migration code. Chrome storage items for networks, tokens, etc., may need versioning. The core vault has migrations already; ensure any new persisted state (settings, contacts) also has upgrade paths.

- **Security:** Keep the strict invariants. For instance, by introducing a router or store, be sure to still **clear sensitive fields** (passwords, amounts) on screen transitions. The hexagonal approach helps: since UI never sees raw keys, risk of leakage is lower. But we must still review new code for any console.logs or unprotected exposure of secrets. Auto-lock and session-only decryption should remain intact throughout refactors.

- **Performance:** Splitting into multiple screens and modules will increase code size. Use code-splitting if supported so rarely-used feature code isn’t loaded on startup. But don’t complicate too early – use straightforward bundling first and optimize later only if needed.

# Summary

In sum, **do not rewrite blindly**. Instead, follow a layered, modular plan: 

- **Pin and test** core crypto (SDK, derivation) to avoid silent breaks.  
- **Feature-flag** new UIs (launchpad/DEX) so they’re deployed off by default.  
- **Add network switcher** and isolate data per network (as multi-chain wallets do).  
- **Implement domain interfaces and router** first, then extract screens incrementally.  
- **Use automated tests/CI** after each change to catch regressions early.  

This step-by-step approach makes the extension robust and maintainable: new features can be toggled or added without breaking the core wallet, and legacy flows continue to work until they’re safely replaced. 

**Sources:** Best practices from hexagonal “ports and adapters” architecture, incremental refactoring strategies, feature-flag patterns, and wallet design notes (MetaMask’s network UX, Cardano wallet golden tests, npm CI guidance).