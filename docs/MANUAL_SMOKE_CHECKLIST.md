# Manual smoke checklist

Everything `npm test` can prove without a browser, it does prove: `test-route-lifecycle.mjs` mounts
all 14 routes in all three vault states through the real Router, guards, bridge and kit, and asserts
teardown, focus trapping and secret hygiene. `scripts/check-routes.mjs` proves the route table is
consistent and that every CSS class the UI uses is defined.

What none of that can prove is **how the thing looks and behaves in Chrome**: real layout at real
widths, real focus rings, the side panel, the toolbar popup, service-worker eviction, and the
clipboard permission prompt. That gap is what this checklist is for. It is deliberately short enough
to run in about 20 minutes, and every item is something that has either broken before or is new
enough to have never been checked in a browser at all.

Run it before merging any change to `src/ui/**`, `src/popup/**` or `src/manifest.json`, and after any
change to the side panel, the popup width, or the modal/focus behaviour.

---

## 0. Load it, and do not get fooled by a stale build

1. `npm run build` — `build.mjs` wipes `dist/` first, so a deleted file cannot survive in the
   output. If the build fails, stop; nothing below is meaningful.
2. `chrome://extensions` → **Developer mode** on → **Load unpacked** → select `dist/`.
3. **The reload trap.** After *every* edit-and-rebuild cycle you must press the reload arrow on the
   extension card, and then **close and reopen the popup**. Two failure modes hide here:
   - The open popup keeps running the *old* bundle. It is a separate document and reloading the
     extension does not refresh it, so you end up testing code you deleted.
   - The service worker is evicted and restarted by the reload, which clears in-memory state and
     fires `onStartup`-style paths a warm worker never runs.
   If a result looks wrong, reload the extension and reopen the popup before believing it.
4. Open DevTools on the popup (right-click the popup → Inspect) and keep the Console visible while
   you work. Any red line is a failure, even if the screen looks right.

## 1. Both contexts

The same `popup.html` is registered twice in the manifest: as the toolbar popup and as
`side_panel.default_path`. They are not the same environment — the panel is resizable, can stay open
for hours, and shares one session with the popup.

| Check | Toolbar popup | Side panel |
| --- | --- | --- |
| Opens and lands on the right screen | [ ] | [ ] |
| Console clean | [ ] | [ ] |
| Scrollbar hidden but content reachable by wheel/trackpad | [ ] | [ ] |
| Locking in one context locks the other | [ ] | [ ] |

To open the panel two ways, and check both:

- **From the wallet**: Dashboard → header **side-panel icon** (the "i" beside it explains what it
  does). This is the deliberate, visible action. It must open the panel on the current window
  without changing anything else, and close the popup. Settings no longer has a Window section.
- **From the browser**: the toolbar icon's context menu / the side panel picker.

Confirm what the button does **not** do: clicking the toolbar icon must still open the popup, not the
panel. Nothing in the code calls `chrome.sidePanel.setPanelBehavior`, and `test-route-lifecycle.mjs`
asserts that stays true. If the toolbar icon ever starts opening the panel instead of the popup,
that is a regression, not a feature.

## 2. Both widths

`--popup-width` is **400px** and `--popup-height` is 600px. The popup is therefore always 400px
wide; the side panel is whatever the user drags it to.

1. **Narrow**: drag the side panel to its narrowest (roughly 300px, and below 400px in any case).
   - [ ] No content is cut off at the right edge. `body { max-width: 100% }` exists for exactly this
     case, and scrollbars are hidden globally, so clipping would be silent.
   - [ ] Long addresses truncate with an ellipsis instead of pushing the layout wider.
   - [ ] Buttons in a `.screen-actions` row wrap rather than overflow.
   - [ ] The seed grid (Export → reveal) still shows its numbered words legibly.
2. **Wide / desktop**: drag the panel to about 800px or more.
   - [ ] The 400px column and the empty space beside it look intentional (border-right visible, no
     stray stretch). **This is the known open question** — if it looks broken, the fix is to make the
     width fluid in the panel only, and it must be decided with a browser open, not by guessing:
     a plain `width: 100%` on `body` would change how Chrome sizes the toolbar popup.
   - [ ] Nothing is centred oddly or stretched to full width.
3. Resize the panel while a screen is open.
   - [ ] No layout jump leaves a control unreachable, and no console error appears.

## 3. Every route, in both contexts

Visit each route in the popup and in the side panel, at the narrow width and the wide width. Use the
hash directly (`#/send`) where the UI has no link, so unmigrated or unreachable screens cannot hide.

| Route | What must be true | Popup | Panel |
| --- | --- | --- | --- |
| `/welcome` | Create/import steps advance; the phrase grid is blurred until revealed; nothing is written to the URL | [ ] | [ ] |
| `/unlock` | Wrong password shows an inline error and keeps focus in the field; lockout countdown runs; Back/Reset reachable | [ ] | [ ] |
| `/dashboard` | Balance, account pill, action tiles, health dot and network badge all populate; the header copy button is the same size and colour as its icon neighbours (no white 32px box); the balance refresh is a quiet frameless icon, not a grey card; the "i" beside the side-panel icon shows its one-line explanation on hover/click and disappears after ~1s; the token ledger has a single "Tokens" tab (no Activity tab — History owns that); no 24h delta or placeholder number is ever shown; token rows show a real balance, a proven-zero (0), or a dash — never a fabricated number; a send that already confirmed shows NO "transaction pending" note | [ ] | [ ] |
| `/accounts` | List, balances, pin/switch, "Add account" | [ ] | [ ] |
| `/account` | Detail for a real ref (`#/account?ref=...` from the Accounts screen); invalid ref shows an error, not a blank screen | [ ] | [ ] |
| `/add-account` | HD preview renders; adding an account returns to `/accounts` | [ ] | [ ] |
| `/keyring` | Source list, rename, backed-up state; `#/keyring?id=<id>` from Accounts | [ ] | [ ] |
| `/export` | Password prompt before any secret; reveal shows the phrase; navigating away removes it (see §5) | [ ] | [ ] |
| `/send` | Recipient validation debounce, amount parsing, fee estimate, confirm step, receipt | [ ] | [ ] |
| `/send` (token) | Asset picker shows token as sendable; amount re-denominates to the symbol; review discloses recipient token-account init fee when the recipient has none; MAX excludes broken values | [ ] | [ ] |
| `/receive` | Address, QR renders in the raised Thru palette (gradient red tiles, slate finder eyes, ice paper) and scans from a phone; clicking the address box copies it, the box says \"Copied\", then returns to the address after ~1s | [ ] | [ ] |
| `/faucet` | Claim state, disabled when already claimed, error when the network has no faucet | [ ] | [ ] |
| `/history` | Entries, filter chips, "load more" appends instead of refetching; token sends appear as "Sent \<amount\> \<SYM\>", receipts as "Received …", mints as "Minted …", and a token-account init never appears as a THRU transfer; a confirmed send never appears BOTH in the list AND as a "Waiting for confirmation" Pending row | [ ] | [ ] |
| `/history` detail sheet (P2) | Tapping a card opens the sheet from the bottom; it shows the tapped transaction (not a neighbour), full signature copies to clipboard, explorer link opens `scan.thru.org/tx/<sig>` in a new tab; Escape and the backdrop both close it and focus visibly returns to the card. **Honesty check — the one CI cannot run:** against a live alphanet transaction, confirm the fee row and block time. **Alphanet DOES populate `header.blockTime`** (verified 2026-09-20 on a live faucet claim at block 12871764 — a real wall-clock time rendered), so on alphanet "Block time: Not available" now indicates a FETCH FAILURE or a node regression, not expected behaviour. On any other network, absence is still legitimate: `blockTime` is optional on the wire and is a per-node property, and confirm the fee row says **"Fee (declared)"** with the note about no charged-fee field. If either ever shows a plausible number that is NOT what the chain returned, that is a merge-blocker — see `docs/TX_DETAIL_SPIKE.md`. | [ ] | [ ] |
| `/history` detail sheet — overflow (REGRESSION) | Open a sheet with EVERY row present (status, amount, counterparty, network, block, block time, fee, program) and a signature long enough to wrap. The sheet must **scroll**, and the last row (`Program`) must be readable in full. No row may be sliced horizontally, and the fee note must not sit on top of a clipped row. This shipped broken once: flex children compressed instead of overflowing, so `.detail-table` clipped its own last rows and no scrollbar appeared — see `docs/DEFECT_LOG.md`. The DOM shim has no layout engine and **cannot** catch this; `scripts/preview-tx-sheet.html` renders both states side by side. | [ ] | [ ] |
| `/history` detail sheet — keyboard | Tab reaches a card (visible focus ring), Enter AND Space both open it, Tab wraps inside the sheet without reaching the list behind it, Escape closes. Clicking the in-card copy button or explorer icon must NOT also open the sheet. | [ ] | [ ] |
| `/settings` | Built-in network controls; any saved custom row says **not selectable**, is inert, and exposes only Remove; auto-lock, security toggle, appearance, danger zone, version. There is **no Window / side-panel section** — the dashboard header owns that action | [ ] | [ ] |
| `/reset` | Warning copy, confirmation text required, reset returns to `/welcome` | [ ] | [ ] |

Also check the redirects a browser can trigger but the tests cannot:

- [ ] `#/welcome` with an unlocked wallet bounces to `/dashboard`.
- [ ] `#/dashboard` with a locked wallet bounces to `/unlock?returnTo=%2Fdashboard`, and unlocking
  lands back on `/dashboard`.
- [ ] A garbage hash (`#/nope`) lands on `/unlock` rather than a blank panel.
- [ ] Browser Back from a deep screen returns to the previous screen, not to a dead end.

## 4. Keyboard and focus

`src/ui/kit/focus-trap.js` is unit-tested against a DOM shim. These are the parts only a browser can
confirm:

- [ ] Open any password dialog (Export → reveal). Tab repeatedly: focus cycles **inside** the dialog
  and never reaches the screen behind the overlay.
- [ ] Shift+Tab from the first control wraps to the last.
- [ ] Escape cancels the dialog.
- [ ] After the dialog closes, focus is back on the control that opened it — not on the page body.
- [ ] The dialog opens with focus already in the password field, and the field is not scrolled out of
  view by that focus.
- [ ] Navigating between routes moves focus to the new screen (a screen-reader user hears the new
  title) without drawing a focus ring around a control they did not choose.
- [ ] With the OS "reduce motion" setting on, nothing animates distractingly.
- [ ] Zoom the browser to 150% and 200%: no control becomes unreachable, no text is clipped.

## 5. Secret hygiene, in a real document

The automated test asserts no password, phrase or private key survives in the DOM. Confirm it in the
thing that actually persists — the side panel document, which can stay open for days:

1. In the side panel, go to `/export`, reveal the phrase with your password.
2. In DevTools, run `document.documentElement.outerHTML.includes('<one of your words>')` → must be
  `false` for attributes and for the whole document only while the phrase is on screen.
3. Navigate to `/dashboard`, then re-run the same check → must be `false`.
4. Run `[...document.querySelectorAll('input')].map(i => i.value)` → no password anywhere.
5. Trigger a background lock (wait out auto-lock, or lock from the popup) with the phrase on screen
   → the phrase must disappear immediately and the screen must go to `/unlock`.
6. Check the URL bar / `location.hash` at every step: no phrase, no key, no password.

## 6. Network and service worker

- [ ] Switch network in Settings: balances, history and pending transactions all change, and the
  badge in the topbar matches.
- [ ] Switch to a network whose RPC is unreachable: the health dot goes offline, screens show an
  error state rather than an eternal spinner, and the wallet is still usable.
- [ ] Let the service worker go idle (wait ~30s with the popup closed), then open the popup: it must
  load without a "service did not respond" banner.
- [ ] **Contract-v7 startup heal.** In the extension service-worker console, seed one disposable
  legacy record and select it as stale state, then reload the extension:
  ```js
  await chrome.storage.local.set({
    thru_custom_networks: [{ id: 'legacy-smoke', name: 'Legacy smoke',
      rpcUrl: 'https://legacy.invalid', explorerUrl: '', environment: 'devnet' }],
    thru_active_network: 'legacy-smoke',
  });
  ```
  Open the popup. It must show Alphanet, and
  `(await chrome.storage.local.get('thru_active_network')).thru_active_network` must be
  `'alphanet'`; the legacy endpoint must never appear as the bound/active network.
- [ ] In Settings, **Legacy smoke** is still listed, says **not selectable**, and its main row cannot
  be focused or clicked as a network control. **Remove** is its only action.
- [ ] From an extension-page console, send the bypass request directly:
  ```js
  await chrome.runtime.sendMessage({ method: 'network.setActive',
    params: { networkId: 'legacy-smoke' } });
  ```
  It must return `{ ok: false, error: { code: 'CUSTOM_NETWORK_DISABLED', retryable: false, ... } }`;
  the badge and stored active id must remain Alphanet.
- [ ] Click Remove. The legacy row disappears and built-in switching still works. There is
  deliberately no Add control; re-enablement requires all four conditions in
  `docs/STATUS_AND_ROADMAP.md` Step 2b.

## 7. Recording the result

Copy this block into the PR description and fill it in. An unchecked box with a reason is far more
useful than a silently skipped section.

```
Manual smoke: <date>, Chrome <version>, build <git short sha>
  contexts: popup [ ] side panel [ ]
  widths:   narrow (<400px) [ ] wide (>=800px) [ ]
  routes:   14/14 [ ]   redirects [ ]   keyboard/focus [ ]
  secret hygiene [ ]   network/worker [ ]
  failures found: <none | list, each with the route and the context>
```
