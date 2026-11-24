# Manual Smoke Checklist

**Document Class:** Operational Runbook (Real-Chrome & Live-Chain Verification)

`test/test-route-lifecycle.mjs` mounts all **15 routes** across no-vault, locked, and unlocked states against a deterministic Node DOM shim, and `scripts/check-routes.mjs` verifies route reachability and CSS class definitions. Because the Node shim has **no layout engine**, **no Chrome side-panel host**, and **no MV3 service-worker scheduler**, this checklist is mandatory before merging changes to `src/ui/**`, `src/popup/**`, or `src/manifest.json` (`AGENTS.md` Rule 14).

---

## 0. Build, Load, and Avoid the Stale-Extension Trap

Use a disposable Chrome profile for unpacked extension testing and all DevTools/automation
attachments. Use a throwaway Betanet wallet only if needed. Never attach an agent to a personal
profile with real credentials, cookies, or wallets. Record the exact commit, browser version, and
whether the evidence came from unpacked MV3 or an HTML fixture. If native Chrome is unavailable,
mark that check **BLOCKED**; do not substitute fixture results. For visual changes, check light/dark,
keyboard focus and dismissal, and scrolling at the widths in §2.

1. Run `npm run build && npm test` (`build.mjs` wipes `dist/` before bundling). Stop immediately if either fails.
2. In Chrome: `chrome://extensions` -> **Developer mode** ON -> **Load unpacked** -> select `dist/`.
3. **The reload trap:** After *every* rebuild, click the **Reload** icon on the extension card in `chrome://extensions`, then **close and reopen the popup** (and side panel). Reopening the popup without reloading the extension runs new UI against a cached old service worker; reloading the extension without reopening an open panel leaves the old DOM bundle running.
4. Right-click the popup -> **Inspect** and keep the **Console** open. Any uncaught error or CSP violation fails the run.

---

The optional [Playwright browser suite](../test/browser/README.md) loads the built popup with an
isolated bridge and no chain access. It checks Assets cache/row/focus/scroll stability at 10, 100 and
200 synthetic tokens, address contrast, network chooser, History controls, and Settings scenarios.
Run `npm run test:browser` with the separately installed Playwright and Chromium described in that
directory. These fixtures are not unpacked-MV3 or real-chain evidence.

### Visual Record Protocol

The actual-UI inventory is [docs/screenshots/README.md](screenshots/README.md), separate from
the synthetic marketing images in `store-assets/`. The capture command and provenance format
are documented in [the browser runbook](../test/browser/README.md#visual-record-capture).

1. **During implementation:** capture before changing a visible surface, then rebuild and capture
   the active change. Use separate output directories under `test-results/` for comparison. Provide
   the affected screenshots in the progress update, with route/state, theme, viewport, revision and
   fixture-versus-MV3 scope. Never describe an old image as evidence for a newer change.
2. **Before confirmation or merge:** run build, full tests and relevant browser regressions;
   regenerate `docs/screenshots/current/`, inspect affected routes and shared-component consumers,
   and include screenshots plus the manifest in the same change. Add a scenario for any new visible
   state rather than assuming the default route image covers it. Capture checking, stale, empty,
   invalid, offline, pending, rejection and unknown outcome when the change affects those states.
3. **After merge:** recapture from the actual merged revision, not only the PR head. CI retains
   per-run screenshot/manifest artifacts on PRs and pushes; it does not commit images or approve
   a design. The maintainer refreshes the checked-in current record when the merged build differs.
   PR/merge status must be confirmed separately; no image or passing test proves a merge.
4. **Coverage:** use light/dark at popup `400x600`, narrow `320x600`, and wide `820x720`. Capture
   overlays open, their last scrollable controls, and keyboard focus/dismissal where applicable.
   Add real host, resize, zoom, motion and accessibility checks from this runbook. A fixture with
   `thru_panel=1` tests a layout mode, not Chrome's native side-panel hosting.
5. **Integrity and retention:** manifests record exact source revision, uncommitted source/tooling
   changes, source/build/image SHA-256 hashes, browser/platform, viewport, theme, route/state and
   evidence scope. Run `--check` after capture and before treating the record as current. A mismatch
   is stale evidence, never grounds for editing expected hashes. Git preserves prior checked-in
   versions; CI artifacts are supplemental and expire after 30 days. Do not accumulate duplicate
   dated galleries in the maintained docs.
6. **Safety:** use isolated public fixtures and disposable profiles. Never capture real recovery
   phrases, private keys, passwords, credentials or personal account data. Capture `/export` only
   at its password gate; never use fresh-backup mode. Leave import, password, recipient and reset
   inputs blank. No capture may sign, create a real vault, or call the chain. Mocked amounts and
   network status must be labelled as fixtures in the record, not promoted into live-chain claims.

The default gallery covers all registered routes in selected safe states, onboarding forms,
account-cache/error/search states, Assets, and Settings pickers/bottom scrolling. It is not
exhaustive UX, review-flow, native-extension, accessibility or live-network verification.

## 1. Both Contexts: Toolbar Popup and Side Panel

The toolbar popup loads `popup.html`; the side panel loads `popup.html?thru_panel=1` (`side_panel.default_path` in `src/manifest.json`).

| Check | Toolbar Popup | Side Panel |
| --- | --- | --- |
| Opens and lands on expected route | [ ] | [ ] |
| Console clean (zero errors / CSP warnings) | [ ] | [ ] |
| Content scrollable by wheel/trackpad without horizontal overflow | [ ] | [ ] |
| Locking in one context immediately locks the other | [ ] | [ ] |

- **Opening the side panel:** Test both Dashboard header's side-panel icon (`"Open in side panel beside your tab"` — opens panel and closes popup) and Chrome's browser side-panel picker.
- **Side Panel Mode toggle (`/settings`):** Default **OFF** -> clicking toolbar icon opens the **popup**. Toggle **ON** -> toolbar icon opens the **side panel**, and preference persists across service-worker restarts (`preferences.sidePanelMode`). Toggle **OFF** again and confirm the toolbar opens the popup. In fixtures, a rejected save must restore the previous toolbar behavior; a failed restoration must show a warning.
- **Mutual exclusion:** With Side Panel Mode **OFF**, open the side panel, then click the toolbar icon: the popup must open **and** the side panel must close, including on short laptop windows where the side-panel height is `<= 600px` (`THRU_CLOSE_SIDE_PANEL` broadcast + `chrome.sidePanel.close({ windowId })`).

---

## 2. Both Widths (`400px` Popup, `<400px` Narrow, `>=800px` Wide / Desktop)

`--popup-width` is **400px** (`400x600`). Drag the resizable side panel to test both extremes:

1. **Narrow (`~300px`, below `400px`):**
   - [ ] Nothing clips at the right edge (`body { max-width: 100% }`).
   - [ ] Display addresses ellipsis cleanly; `.screen-actions` buttons wrap cleanly; `/export` seed-phrase grid remains legible.
2. **Wide / desktop (`>= 800px`):**
   - [ ] The `400px` column and border sit cleanly without distorted stretching or unreachable controls.
3. **Live resize:**
   - [ ] Dragging between narrow and wide while a route or sheet is open produces zero layout jumps or console errors.

---

## 3. All 15 Routes in Popup and Side Panel

| Route | Required Behavior | Popup | Panel |
| --- | --- | --- | --- |
| `/welcome` | Create/import flows advance; phrase blurred until revealed; zero secrets in URL/hash | [ ] | [ ] |
| `/unlock` | Wrong password keeps focus in input and shows backoff; `Reset` reachable | [ ] | [ ] |
| `/dashboard` | `196px` ink header, account pill, copy & side-panel icons, `Tokens` drawer trigger (real balances, proven `0`, or `—`), frozen `2x3` `88px` action grid, secondary services grid (`Domain`), `CurrentConnection` footer; shell topbar hidden | [ ] | [ ] |
| `/accounts` | Account list and balances; keyring count and `Manage` are labeled; current account uses restrained tint + check; search keyboard focus is distinct without reading as an error; switch and `Add account` work | [ ] | [ ] |
| `/account` | Detail for `#/account?ref=...`; rename, provenance, export/remove actions; invalid ref shows clean error | [ ] | [ ] |
| `/add-account` | Non-persisting HD preview renders; batch/single add returns to `/accounts` | [ ] | [ ] |
| `/keyring` | Source details (`#/keyring?id=...`), password-gated rename/remove, backup status | [ ] | [ ] |
| `/export` | Password prompt before reveal; phrase/key cleared immediately on navigate-away or lock (§5) | [ ] | [ ] |
| `/send` | Form paints immediately before RPC reads; `last known`/unknown balances cannot unlock Max/Review; JIT activation runs only for vault-owned absent recipients; shared `TxReviewCard` (§7) | [x] | [ ] |
| `/send` (token) | Only verified positive-balance mints with chain decimals selectable; review discloses sender-paid recipient token-account init when needed; fee states `not confirmed (paid in THRU)` | [ ] | [ ] |
| `/receive` | Thru-styled QR scans from phone; clicking address box shows `"Copied"` for ~1s; network clearly shown | [ ] | [ ] |
| `/faucet` | Native THRU claim shows network per-claim cap only; no THRUSD rate-limit readout; reviewed via `faucet-claim` card | [x] | [x] |
| `/name` | Two tabs (`Register` & `My Domains`); `.thru`-only search/tier pill (`3` / `4` / `5+` chars) with live on-chain config quote; owned `.thru` search shows `Renew` & `Import`; `My Domains` paints cached rows as stale before live ownership enables `Make primary` / `Unlink` / `Renew` / `Remove`; single toast per submission (`Rule 29`) | [ ] | [ ] |
| `/history` | Flat stream (no `Today`/`Yesterday` headers, no per-card fee); cache-first paint; `YYYY/MM/DD HH:mm` block time or own-send fallback or `Block <slot>`; `Load more` appends cleanly; Detail sheet (`tx-detail-sheet.js`) scrolls all rows to `Program` without flex-shrink clipping (`scripts/preview-tx-sheet.html`) and shows concise **`Fee`** label with accessible declared-fee provenance | [ ] | [ ] |
| `/settings` | Features shortcuts land on the existing routes; keyboard opens separate Network, Signing, Theme and Auto-lock sheets and returns focus to the row on close; Language and Currency are labelled `Planned` and skipped by Tab; legacy custom rows remain inert with `Remove` only; four `?` help cards fit at toolbar width; no full-wallet reset here | [ ] | [ ] |
| `/reset` | Reachable from `/unlock` only; requires uppercase `RESET` confirmation; returns to `/welcome` | [ ] | [ ] |

### Redirect & Offline Resilience Checks
- [ ] `#/welcome` while unlocked redirects to `/dashboard`; `#/dashboard` while locked redirects to `/unlock?returnTo=%2Fdashboard`; `#/nope` redirects to `/unlock`.
- [ ] Block `rpc.betanet.thru.org` in DevTools: Dashboard, Send, Domains, and History paint cached/stale or unavailable states immediately without infinite spinners or false `0` balances.

---

## 4. Keyboard, Focus Trap, and Zoom

- [ ] Password dialogs, `TxReviewCard` sheets, and `tx-detail-sheet` trap `Tab` and `Shift+Tab`, close on `Escape`, and restore focus to the opener control.
  - [x] **Faucet claim sheet only** (2026-11-18, Chrome 150.0.7871.46, toolbar popup and side panel): `Tab`/`Shift+Tab` wrap `Details` ↔ `Cancel`, `Escape` and `Cancel` close, and focus returns to `Claim on-chain` after `Escape`, `Cancel` and an unknown-submission-outcome banner (a real-browser definite rejection remains unverified; tested via Node fixture). Password dialogs and `tx-detail-sheet` were **not** re-checked in this run.
- [ ] `prefers-reduced-motion` suppresses non-essential motion; `150%` and `200%` browser zoom clip no controls.

---

## 5. Secret Hygiene in Live DOM

1. On a disposable test wallet in the side panel, open `/export` and reveal the recovery phrase. Confirm words appear only in visible text nodes — never in `location.hash`, attributes, `data-*`, or input `value`s.
2. Navigate to `/dashboard` (and repeat with background lock): verify zero phrase words or private-key hex strings remain anywhere in the live DOM.

---

## 6. Service Worker Lifecycle, Auto-Lock, and Quarantine

- [ ] Close popup for `>30s` until MV3 service worker goes idle, then reopen: boots cleanly without error.
- [ ] Set Auto-lock to `1 min`, close popup for `2 min`, reopen -> lands on `/unlock`; while actively moving pointer on a screen -> stays unlocked.
- [ ] Seed a legacy `thru_custom_networks` entry + `thru_active_network: 'legacy-smoke'` in worker console and reload extension: self-heals to `'betanet'`, renders inert in `/settings`, and `network.setActive` returns `CUSTOM_NETWORK_DISABLED`.

---

## 7. Shared Transaction Review Card (`v29`–`v32`) & Toast Harnesses

Serve local visual harnesses first (`node scripts/serve-dist.mjs --root . --port 8000` -> `scripts/preview-tx-review.html` [9 fixtures] and `scripts/preview-toast.html`), then verify in the unpacked extension:

- [ ] **Header & Counterparty:** Title states verb + amount (`Send 0.0015 THRU`, `Register name.thru for 1 year`) beside one network badge (`Betanet`) and `From <account> · test network`. Counterparty shows matched name/label above the **full, unshortened 46-character address** (`word-break: break-all`).
- [ ] **Two Compact Tables + One Disclosure:** Money table (`You pay` / `You receive`, `Network fee` as `about ...` or `not confirmed` or `none`, `Total` omitted when fee is `0` or currencies differ) + non-money facts table + closed `Details` disclosure (`open` by default for `Unrecognised transaction`). Confirm button stays reachable at `400x600`.
- [ ] **Honest States & Blocking:** No post-transaction balance or fake simulation (`Simulation: Unavailable` inside `Details`). Blocking warnings appear unfolded on the card and disable Confirm.
- [ ] **Single-Use, Consent & One Toast (`v32`, `Rule 29`):** Confirming opens **one** `pending` toast that updates in place (`success` / `error` / `warning`), without duplicating the verdict into `Banner` or field text; re-submitting a consumed review is impossible; timeout reports outcome unknown (`Check outcome`).

---

## 8. Smoke Run Record Template & Log

### Outstanding checks for the dashboard update

- [ ] Dashboard and Assets: check scrolling, search, details, hide/restore and refresh.
- [ ] Network: check the chooser and recovery after a temporary Betanet connection failure.
- [ ] History: check filters, flat list, details, copy, explorer links and cached status.
- [ ] Settings: check Theme, Auto-lock and Signing choices, password prompts and disabled options.
- [ ] Faucet and Receive: check the claim amount, address copy and QR scan.
- [ ] With an approved disposable Betanet account, check a send appears as pending and then confirmed in History and the explorer, including after reopening; also check faucet.
- [ ] Check keyboard, focus, worker restart, lock, secret cleanup and custom-network restrictions.
- [ ] Run final build, tests, browser checks and independent review on the candidate commit.

- [ ] When a suitable Betanet token is available, import it with a disposable wallet, refresh, close and reopen the extension, and confirm it remains visible with the correct balance.
- [ ] Reopen the side panel several times and after a worker restart; investigate if it ever fails to load again.


```text
Manual smoke: <YYYY-MM-DD>, Chrome <version>, commit <short-sha>
  contexts: popup [ ] side panel [ ]    widths: narrow (<400px) [ ] wide (>=800px) [ ]
  routes: 15/15 [ ]   redirects/offline [ ]   keyboard/focus/zoom [ ]   secret hygiene [ ]
  review card & toast: layout [ ]   fee/no-sim honesty [ ]   blocking/single-use [ ]   one-toast [ ]
  worker/quarantine: idle wake [ ]   auto-lock [ ]   v7 custom-RPC heal [ ]
  live chain (throwaway wallet): v12 JIT [ ]   token transfer [ ]   registrar/record [ ]   history/explorer [ ]
  failures: <none | route + context + symptom>
```

### Recorded Runs
- **Owner report (version and Chrome not recorded):** Side panel opening and closing worked as expected on several attempts; one earlier attempt failed to load. This is partial feedback, not a completed worker-restart or Side Panel Mode recovery test.
- **2026-11-16 (Chrome 157 visual harness, mocked bridge):** Tested source-module boot and real rebuilt `dist/popup.css` at `400x600` and `300x600`, light/dark. Confirmed no intermediate Checking-wallet page, deep-link input preservation, reset/late-bootstrap behavior, readable toast text, wrapping long addresses, and a 14px gap above the actual dashboard network footer with working hit-testing. Evidence: local temporary directory `ui-recheck-20261116-1021-evidence` contains `report.json` and 43 screenshots with asset hashes. This does not verify unpacked-extension hosting, real MV3 suspension, live signing, or later source changes.
- **2026-10-04 (Partial, popup only):** Local build post-`14e16b1` in real Chrome; native Betanet self-send on `/send` verified recipient validation, amount parsing, Review fee, confirmation, and `/history` entry (`/send` popup cell ticked; charged fee not captured; JIT activation, side panel, widths, and `1.4.1` store package remain open).
- **2026-10-27 (Visual harness only):** Chrome inspection of `NameRoute`/`Sheet` with `dist/popup.css` and mocked bridge at `400x600` (light/dark) and `320x700` / `320x400` with a 64-char name confirmed scroll-reachable confirmation actions without document height expansion.

### Recorded Runs (continued)
- **2026-11-18 (Real Chrome 150.0.7871.46, unpacked `dist/`, throwaway vault, partial):** Loaded the built extension into a vendored Chrome 150 `.deb` (SHA-256 matched against Nixpkgs' `150.0.7871.46` pin) driven over CDP. A fresh vault was created through the real `/welcome` route; the toolbar action popup (400x510) and the real side panel (opened by the Dashboard's `Open in side panel beside your tab` control, 360x445, plus 320x520 and 820x720 emulated metrics) both rendered `/faucet` from the real background service worker. The review was prepared by the **real** `tx.prepareReview` path (real decoder, real card): `Claim 0.00001 THRU from the faucet`, `BETANET`, full counterparty address, `YOU RECEIVE +0.00001 THRU`, `NETWORK FEE not confirmed`, closed `Details`. First focus `Details`; `Escape`/`Cancel`/unknown-outcome banner returned focus to `Claim on-chain`; no horizontal overflow of document, sheet or action row at any of the three widths; no console errors in the extension pages. **Not verified:** a live claim (the throwaway account is unregistered, so the real submit path was not exercised to completion — the rejection banner shown was the honest "Could not confirm whether this claim was submitted" state produced by a failing chain read, not a stubbed RPC); the side panel was opened via a trusted CDP click on the shipped control, not by a physical toolbar click; no `thru_panel=1` fixture page was used as evidence. Findings fixed in this run: focus returned to `<body>` after every sheet dismissal (the opener button was disabled while the review was prepared, so the sheet captured no opener — `src/ui/kit/{button,sheet,focus-trap}.js`, `src/ui/app/routes/faucet.js`), and at 360x445 the sticky `.screen-actions` row covered the money table (`src/popup/styles/kit.css`).

---

## 9. Appendix: Chrome DevTools Layout Inspection Snippets

Paste into the popup/side-panel DevTools Console (`$0` = element selected in Elements panel) when checking overflow or flex clipping:

```js
// Inspect computed box & flex/scroll geometry on selected element ($0)
(() => { const s = getComputedStyle($0), r = $0.getBoundingClientRect(); return { rect: r, display: s.display, flexShrink: s.flexShrink, overflowY: s.overflowY, maxHeight: s.maxHeight, clientH: $0.clientHeight, scrollH: $0.scrollHeight }; })();

// Find any element overflowing the 400px popup viewport horizontally
[...document.querySelectorAll('*')].filter(el => el.getBoundingClientRect().right > window.innerWidth + 0.5);
```
