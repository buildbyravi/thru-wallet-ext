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
- `wallet-security.mjs`: MV3 extension load and current absence-of-provider smoke checks; it does not test planned DApp authorization or signing.

The browser fixtures cover selected scenarios, not every route, OS, extension lifecycle or wallet
operation. Do not use their synthetic network or balance values as live-chain evidence.

## Visual Record Capture

`capture-ui.mjs` rebuilds the standard `dist/` and captures the actual bundled popup with an isolated
public bridge fixture. It uses the same external Playwright/Chromium setup as the regressions above;
no production dependency, server, real vault or RPC is required. All requests are intercepted.
Routing covers the entire browser context; service workers are blocked, WebSockets are refused,
and unexpected popups fail capture. Build hashes include icons and artwork, not just bundles.

```sh
node test/browser/capture-ui.mjs dist docs/screenshots/current
node test/browser/capture-ui.mjs dist docs/screenshots/current --check
```

For PowerShell, set the environment variables before capture (adjust local paths):

```powershell
$env:PLAYWRIGHT_MODULE = 'C:\browser-tools\node_modules\playwright-core\index.mjs'
$env:CHROME_BIN = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
node test/browser/capture-ui.mjs dist docs/screenshots/current
```

Use `test-results/ui-before` and `test-results/ui-after` instead of the current output directory
for active-change comparisons. The capture waits for route state, fonts and images; uses reduced
motion; records viewport PNGs rather than hiding scroll constraints with full-page images; and
opens Settings pickers with the keyboard, checking Escape/focus restoration. The manifest and
Markdown gallery are generated only after the entire capture succeeds. Capture failures preserve
the previous record, which must not be represented as fresh evidence.

The former one-off Settings screenshot in `dist/` is removed; the maintained gallery owns that
capture now, outside the extension package.

The matrix is all registered routes plus selected onboarding, account cache/error/search, Assets,
and Settings scenarios, each in light/dark at `400x600`, `320x600` and `820x720`. Fields remain blank;
export is password-gated. Every successful fixture response is enumerated. Unmodelled methods,
browser errors, unexpected requests or filled editable inputs fail capture. Negative controls
prove external/non-asset requests and WebSockets are refused. `--check` needs no browser tooling and rejects
changed source/build/image hashes or incomplete scenario/theme/viewport coverage.

This is not an automatic pixel comparison or design approval. It does not cover every scroll
position, transient state, transaction review, native popup/panel, real wallet or live-chain flow.
Extend the scenario matrix when a change needs those states. Follow the
[visual record protocol](../../docs/MANUAL_SMOKE_CHECKLIST.md#visual-record-protocol).
