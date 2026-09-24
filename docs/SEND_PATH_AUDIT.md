# Send-path frontend ↔ bridge ↔ backend audit

Date: 2026-09-24
Branch: `arena/01a0cfe3-thru-wallet-ext`
Scope: the popup/side-panel Send route, adjacent balance displays, UI bridge, shared contract, MV3 request listener, router, network/account/token/balance/pending services, and the SDK adapter. This is a source and automated-test audit, **not** a live-chain or real-browser certification. The side-panel exclusion fix was already reported working by the user; this pass does not change it.

## Finding and fix: why Send kept spinning

Previously, `SendRoute.load()` awaited **seven** bridge calls in one `Promise.all`, including `account.list`, `keyring.list`, `token.list`, and `tx.estimateFee`. It then awaited `tx.getAccountInfo` and **all** `token.getBalances` mint reads *before mounting the form*. One slow/offline token RPC could hold the whole Send screen behind a spinner. This was not a network-health requirement; these calls were only needed for secondary metadata and spending eligibility.

Now only public active-account and active-network metadata gate the first form render. Balance, fee, token registry/ledger, contacts, and picker accounts/keyrings load independently. The recipient and amount inputs are not remounted on background updates. Unknown and cached balances can **display** (cached amounts say “last known”) but cannot enable native Max/Review. A usable fee reserve and live native balance are both required; token selection requires a verified positive token balance with on-chain mint decimals. Failed reads offer retry without deleting typed input. Account/network events invalidate a stale review; late RPCs and retries cannot overwrite the new context.

This removes the **route-level RPC wait**, not the unavoidable worker bootstrap/unlock time. No real popup stopwatch or browser layout test was run.

## Audited call path

| Boundary | Checked behavior / change |
| --- | --- |
| UI → bridge | `src/ui/app/routes/send.js` calls only `bridge.send(...)`. `src/ui/app/bridge.js` checks names against the manifest, has a 30s response ceiling, converts router errors to `{code, message, retryable}`, and subscribes to declared push events. A signing timeout is **not** proof that broadcast failed; Send says “outcome unknown—check Activity/explorer.” |
| Bridge → MV3 worker | `src/background/index.js` accepts only messages with this extension’s `sender.id`, ignores the separate side-panel close broadcast, and returns `true` while the async router answers. Reloading the entire extension is needed to update UI **and** worker bundles. |
| Worker → API contract/router | `src/shared/contract/manifest.js` v11 adds `tx.sendChecked` and `token.transferChecked` without removing legacy methods. `src/background/api-router.js` allowlists handlers, applies the same `auth: 'signing'` policy (password when the user enabled it), stamps activity, and normalizes errors/JSON responses. Source account and network from Review are required for the checked methods; the service verifies them before and after preflight RPCs. |
| Account/network reads | `getActiveNetworkConfig()` binds the SDK after a cold worker start, not just after a settings switch. Direct account/batched balance/token reads verify the network again before presenting/writing results. Only the SDK’s account-not-found code proves an absent account; offline and malformed answers throw. Native cache entries from failed reads are stale, never new observations; an offline placeholder with no prior successful timestamp cannot become “last known,” including for older cached entries. |
| Token reads | Imported-token registry rows are scoped to the selected network; legacy untagged rows belong to Alphanet only. Registered token RPCs have at most four concurrent mint reads. A positive token balance with unverified mint decimals is **unknown and unselectable**, not denominated using user-entered metadata. Missing token accounts remain explicitly proven zero. |
| Signing → receipt/activity | A synchronous in-worker intent guard blocks an identical native/token in-flight send, with network and mint in its key. A signature is stored under the **signing network’s** pending key even if the selected network changes. Once the SDK returns, the optional native-balance refresh is fire-and-forget: a stalled second RPC cannot delay a known signature until the UI’s 30s timeout. Best-effort balance/event updates do not alter the submission result. |
| Adjacent consumers | Accounts and HD preview no longer render an unobserved offline fallback as `0 THRU`; Dashboard refresh and stale-balance events no longer turn an unknown native balance into a verified zero. These are consumers of the same batched service, not separate balance authorities. |

## Test evidence

- `npm run build`: **PASS**, two JS bundles plus CSS; no build warnings.
- `npm test`: **PASS** (derivation 16/16, QR 13/13, layering 69 files / 0 violations, launchpad quarantine 45/45, contract 71/71, DOM/refs 127/127, route lifecycle **885/885**, plus vault, SDK adapter, token-balance, network-read and API-router integration suites).
- `test/test-route-lifecycle.mjs`: real Router/SendRoute/bridge/kit with mocked Chrome messaging; holds balance/fee/token/picker replies, exercises retry, stale-account events, native/token checked sends, offline state, uncertain timeout, teardown; also checks Dashboard and Accounts do not show a never-fetched zero.
- `test/test-balance-network.mjs`: fake SDK account reader exercises cold-worker binding, delayed responses across a chain switch, cache isolation, verified/stale/absent distinctions, legacy `fetchedAt: 0` entries, and a late signature stored only on its original chain.
- `test/test-token-balances.mjs`: verifies on-chain denomination, proven zero vs unknown, bounded four-way mint reads, and intent deduplication. `test/test-api-router.mjs` probes signing auth/context, mid-preflight switch, double submission, offline account/HD reads, port-safe JSON, and a **successful signature returned while the post-send balance RPC stays blocked**.
- `git diff --check`: **PASS**. These are deterministic local tests with a fake SDK/Chrome port; they do not establish live Thru fee/signing semantics or real UI timing.

## Residual risks / next checks

1. **High — network change during an SDK signing sequence.** The checked service verifies source/network before entering `thru-client.sendTransfer` / `sendTokenTransfer`; the SDK wrapper still uses a mutable singleton RPC/program binding across its subsequent asynchronous steps. A switch *after* that last check, especially during recipient token-account initialization, is not made atomic by this change. Use a network-bound transaction client or serialize a network switch against an active send, then test on a safe live wallet. The interleaved tests here cover switches **during preflight**, not every SDK await.
2. **Medium — timeout or worker restart before a signature is persisted.** An in-memory dedupe lock dies with the MV3 worker; the existing pending record only guards a send once the SDK has supplied a signature. A timed-out signing request can have an unknown outcome. **Do not retry immediately:** inspect Activity and a chain explorer. Durable intent/receipt recovery would need a separate verified design.
3. **Medium — concurrent pending-record writes.** `pending.track()` still performs a storage read–modify–write, so different simultaneous transfers on one chain could race and lose one Activity row. Serialize per-network writes (also `settle`/clear paths) before claiming concurrent-pending durability. This audit pinned the *chain* of a late record, not its atomicity.
4. **Medium — token transfer fee and recipient-owner requirements.** Token-program fees and whether a never-registered recipient owner can receive a newly initialized token account have not been measured end-to-end on a live node. The UI discloses an unmeasured fee and does not claim the SDK can prove those assumptions; `scripts/verify-token-transfer.mjs` remains the follow-up.
5. **Low/performance — other routes.** Dashboard still waits for the combined token ledger (`Promise.allSettled`) before its full refresh completes, though a cached hero can paint earlier. `tx.getTotalBalance` is not a UI Send dependency; its existing return shape has no completeness flag when a constituent read is stale. Those need a separate API/UI design, not a fabricated aggregate.

## Browser-only acceptance before merge

Reload the **extension**, then follow the new Send and slow/offline items in `docs/MANUAL_SMOKE_CHECKLIST.md` in a real popup **and** side panel. Check first paint, input focus/retention, loading and stale labels, network/account switches while reviewing, lock/timeout messaging, a post-send signature that does not wait on balance refresh, and pending rows after switching networks. No real funds should be sent for the cross-context race checks. Source-level and DOM-shim tests cannot validate layout or actual MV3 worker scheduling.
