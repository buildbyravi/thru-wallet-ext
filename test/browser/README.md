# Optional Playwright browser regressions

These tests run the built popup in Chromium with an isolated **mock extension bridge**. They do not
load an unpacked MV3 extension, use a real vault, sign transactions, call a production RPC, or prove
Chrome side-panel behavior. Use the manual smoke checklist and approved disposable Betanet checks
for those gates. `npm test` is the separate Node/DOM-shim suite and does not run these tests.

Build first. Supply a locally installed `playwright-core` module and a compatible Chromium executable;
they are intentionally not wallet runtime dependencies. Example (adjust paths for your machine):

```sh
npm run build
npm install --prefix /tmp/thru-browser-tools --no-save playwright-core@1.65.1
PLAYWRIGHT_MODULE=/tmp/thru-browser-tools/node_modules/playwright-core/index.mjs \
CHROME_BIN=/path/to/chromium npm run test:browser
```

Some Linux environments require their own shared-library setup. `test:browser` runs all checked-in
scripts sequentially and exits on the first failure. Individual scripts accept an optional directory
argument in place of `dist`.

- `address-contrast.mjs`: wallet and token address contrast and full accessible labels, light/dark.
- `network-chooser.mjs`: dashboard sheet, quarantine, pending/failure/duplicate behavior and focus.
- `network-health.mjs`: bounded recovery from transient probe failure and stale-network reply fencing.
- `token-cache.mjs`: cache-first 10/100/200-token lists, stable rows/scroll and filtering.
- `history-controls.mjs`: flat History, cached status, keyboard detail/copy/link, intercepted explorer and Faucet amount copy.
- `settings.mjs`: full-width preference choices, theme save/reopen success and failure, password-dialog handoff, planned rows and logo.

The browser fixtures cover selected scenarios, not every route, OS, extension lifecycle or wallet
operation. Do not use their synthetic network or balance values as live-chain evidence.
