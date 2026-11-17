# History, Block-Time Provenance, and Transaction Detail

**Document Class:** Authority (Topical Guide — Shipped Behavior)
**Baseline:** Contract **v33** (`/history` route, `tx-detail-sheet.js`, `history-service.js`, `pending-tx-service.js`) | **Status:** `IMPLEMENTED`, `TESTED`; live block-time latency, explorer `/tx/` route, and charged-fee source `UNVERIFIED`.
**Related Authorities:** `AGENTS.md` (Rules 14, 15) · `docs/ARCHITECTURE.md` · `docs/BACKEND_GAPS.md` (C2b, C2c) · `docs/guides/protocol-and-rpc.md`

---

## 1. Flat Stream and Cache-First Paint (`Rule 15`)

The `/history` route (`src/ui/app/routes/history.js`) renders a **single flat newest-first card stream** using `src/ui/domain/tx-card.js` with **no `Today` / `Yesterday` day-group headers** and **no per-card fee line**.

1. **First Paint (`tx.getCachedHistory`):** Storage-only read scoped by `(networkId, address)` via `src/shared/network-scope.js`. Paints cached entries immediately without touching RPC. If fresh network hydration subsequently fails, cached rows remain visible and are explicitly labelled unsynced/stale rather than wiped or replaced by a false "No transactions" state.
2. **Fresh Feed & Pagination (`tx.getHistoryFeed` / `tx.listHistory`):** Merges live RPC history with tracked local submissions (`pending-tx-service.js`), supports cursor-based "Load more" pagination without refetching earlier pages, and auto-refreshes every 30 seconds while open.
3. **Chain-Identity & Reset Hygiene:** History caches record chain-identity/height evidence. Entries from a replaced genesis or above a reset chain's live slot height are dropped so stale testnet-reset rows cannot resurface (`test/test-history-cache.mjs`). Concurrent refreshes across accounts serialize writes per network so parallel reads never clobber one another.
4. **Pending Tracking & Deduplication (`pending-tx-service.js`):** Persists per-network records (`PENDING_SCHEMA_VERSION = 1`, `MAX_RECORDS = 50`, `{ startSlot, expiryAfter }`), renders an `#ffad42` toolbar badge with the active `SUBMITTED` count, settles unconfirmed records older than `WATCH_TIMEOUT_MS` (`5 min`) to `unknown`, schedules deferred reconciliation passes (`2s` / `10s`, unref'd), triggers `tx.reconcilePending` on Dashboard/History view, and deduplicates at render time so a confirmed signature never appears simultaneously as a settled row and a pending row.

---

## 2. Timestamp Provenance Hierarchy

Thru `Transaction` messages carry `slot` and `blockOffset` — **no wall-clock timestamp lives on the transaction wire**. Timestamps are resolved and persisted with explicit provenance (`test/test-history-block-time.mjs`):

1. **`timestampSource: 'block'` (Authoritative):** Resolved via `blocks.get({ slot })` -> optional `BlockHeader.block_time` (`blockTimeNs`; zero or out-of-range values are rejected). Cached per `(networkId, rpcUrl, slot)` using a captured SDK client **outside** the serialized storage-write lock so slow header fetches never block cache writes or leak across networks with colliding slot numbers. Rendered in local calendar format `YYYY/MM/DD HH:mm`.
2. **`timestampSource: 'submitted'` (Own-Send Fallback Only):** Recorded locally at broadcast time for transactions submitted by **this wallet instance** when `block_time` is unavailable. Overwritten as soon as `timestampSource: 'block'` becomes available.
3. **`Block <slot>` (Honest Unknown Fallback):** Used for any incoming or external transaction when `blocks.get` omits `block_time` or fails. The wallet **never** substitutes `Date.now()` or borrows a neighbor's timestamp.

---

## 3. Decoding Honesty (`src/lib/thru-client.js`)

`decodeHistoryEntry` decodes only verified program layouts against the viewer's own account and token-account addresses:

- **Native EOA Transfer (`EOA_PROGRAM_ID`, 4-byte tag `1`, 16 bytes):** Resolved as `sent` or `received` with exact counterparty address and BigInt amount.
- **Account Registration (`NOOP_PROGRAM_ADDRESS`):** Decoded as `registration` (no amount, no counterparty — never "Unknown transaction").
- **Faucet Withdraw (`BOOTSTRAP_PROGRAM_ADDRESSES.faucet`, 4-byte tag `1`, 16 bytes):** Decoded as `faucet` credit.
- **Token Program (`TOKEN_PROGRAM_ADDRESS`, 1-byte tags):**
  - Tag `2` (13 bytes): `token-sent` / `token-received` (resolved against viewer's derived token accounts; if mint/direction cannot be proven, raw amount is withheld rather than misattributed).
  - Tag `3` (15 bytes): `token-mint`.
  - Tag `1`: `token-account-init` (carries mint, created token account, and owner; never rendered as a THRU transfer).
- **Reverted or Unknown Programs:** Non-zero `vmError` marks `success: false`; unrecognized program IDs or tags remain explicitly undecoded with zero fabricated amounts.

---

## 4. Transaction Detail Sheet (`src/ui/domain/tx-detail-sheet.js`)

Tapping a `tx-card` opens a bottom sheet backed by lazy `tx.getDetail({ signature })`:

- **Declared vs Charged Fee Honesty & Wire Bounds:** Thru's `TransactionExecutionResult` exposes consumed compute/memory/state units and error codes, **not** an actual debited fee (`fee_charged` does not exist on the RPC response; block-level `claimedFees` is an aggregate). `tx.getDetail` uses a `minConsensus` fallback on `getTransaction` (some RPC nodes reject `UNSPECIFIED` with `INVALID_ARGUMENT`), intentionally omits raw `TransactionExecutionResult.events` blobs (which can exceed `4 KB+` per JSON port call), and returns `feeDeclaredUnits` + `feeCharged: false`, labelled **`Fee (declared)`** (never "Fee paid"). Enforced by `test/test-contract.mjs` and `test/test-thru-client.mjs`.
- **Flex-Shrink Overflow Invariant (`Rule 14`):** `.tx-sheet` is a bounded flex-column scroll container (`overscroll-behavior: contain`) that pins direct children with `flex-shrink: 0` so long signatures and full row sets scroll cleanly instead of clipping the bottom `Program` row. Guarded in `test/test-route-lifecycle.mjs` and inspectable via `scripts/preview-tx-sheet.html`.

---

## 5. Open Browser and Live-Chain Checks

- Real-Chrome overflow, keyboard Tab/Enter/Space/Escape focus return, and side-panel width checks (`docs/MANUAL_SMOKE_CHECKLIST.md` §3).
- Live Betanet `blocks.get` block-time availability and first-page latency under real RPC conditions.
- Live confirmation of the `https://scan.thru.org` `/tx/` deep-link URL pattern and whether any typed explorer endpoint exposes per-transaction charged fees (`docs/BACKEND_GAPS.md` C2b/C2c).
