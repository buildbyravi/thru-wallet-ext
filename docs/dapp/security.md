# DApp connection security requirements

**Status: planned.** Thru Wallet does not currently inject a provider, register content scripts,
or accept DApp connection/signing requests. This document records release-blocking requirements
for the future DApp connection implementation; it is not a claim that the boundary is implemented.

## Trust boundary

Origin isolation is not a blanket block on legitimate websites. It ensures that only a specific,
user-approved top-level origin can use an existing connection; unapproved top-level sites may
request a connection, but that request requires explicit wallet approval. A background-owned,
session-scoped approved-origin set should be populated only after approval and cleared on lock,
reset, or browser-session end. An unapproved origin must never inherit another tab's connection.

An optional “Pause new connections” control may reject otherwise-valid connection requests without
opening an approval surface. It must not silently revoke existing approvals or change signing policy;
make those states explicit to the user.

- Keep the extension isolated from ordinary web pages by default. Do not add host permissions,
  `externally_connectable`, a content script, or a page provider unless the DApp feature requires
  it and the permission/API review is documented.
- The page bridge must accept only messages from its own top-level window. Require
  `event.source === window`, `window.top === window.self`, and exact origin equality with the
  current document. Reject malformed, unknown, replayed, and oversized messages. Never treat a
  page-provided origin string as authenticated identity.
- The background service worker is the authorization boundary. It must derive the requesting
  origin from browser-provided sender metadata, require a top-level frame (`sender.frameId === 0`),
  and reject absent, opaque, non-HTTPS, or mismatched origins. The only HTTP exceptions are explicit
  loopback development fixtures (`http://localhost` and `http://127.0.0.1`); do not permit them in
  production builds or broaden the exception to arbitrary hosts. Where both sender origin and tab URL
  are available, compare normalized URL origins; do not infer trust from a parent frame or request
  payload.
- Connection and signing are separate permissions. A connection reveals only the explicitly
  approved public account data. Every signing request requires a fresh, explicit user approval;
  locked wallets refuse without unlocking, and no page message can unlock or approve on the user's
  behalf.
- Approval UI must display the exact requesting origin (scheme, host, and non-default port) in a
  wallet-controlled surface before user action. Do not display a dApp-supplied display name in
  place of the origin. Bind approval to the request, method, account, and network to prevent replay
  or parameter substitution.

## Active-site connection bar requirements

A Rabby-style active-site bar belongs with the DApp connection feature, not as a standalone UI in
this PR. Do not add it while connection approval/state does not exist: displaying “Connected” from
an arbitrary storage object would imply a security decision that the background does not enforce.

When implemented:

- Show the active page's origin using browser-provided tab metadata, safely rendered as text. Handle
  browser/internal pages, restricted URLs, opaque origins, and missing tabs without exposing or
  guessing a site identity. Prefer the narrowest permission that supports the interaction; do not
  add broad `tabs` access solely for decoration without documenting the need and privacy impact.
- The background must be authoritative for connection state. A popup must not grant a connection by
  writing `connectedOrigins` itself. Grant only after explicit user approval of the exact origin;
  signing requests independently require a fresh approval and existing review/consent checks.
- Decide and document persistence before implementation. Persistent origins in
  `chrome.storage.local` survive browser restarts and require clear user-facing management; a
  session-scoped grant is safer by default. Never store a page-supplied origin as trusted identity.
  Consider an optional idle auto-disconnect interval; define what counts as DApp activity, show the
  expiry state, and revoke at the background boundary. Do not conflate connection expiry with wallet
  locking or extend an origin's grant based on unsolicited page traffic.
- Disconnect must revoke the active origin in the background before reporting success, invalidate
  in-flight requests for that origin, update all wallet UI, and notify a connected page only through
  the designed bridge. Do not add `tabs.sendMessage` without a content script and reviewed
  permission boundary.
- Keep network selection independent of site connection state. Use the wallet's existing network
  settings and labels; do not offer network IDs or endpoints that are not actually selectable.

## Planned connection-management and phishing protections

- **Connected Sites management modal:** provide a wallet-owned list of approved origins with exact
  origins, connection/account scope, and revoke controls. Support revoking one site and disconnecting
  all sites. Revoke in the background first, clear or invalidate outstanding request/approval tokens,
  and reflect the result in the active-site bar. Do not use a modal-side storage edit as authority.
- **Block Site action:** distinguish an explicit user block from ordinary disconnect and from a
  phishing-list warning. A blocked origin must not trigger connection or approval prompts until the
  user removes the block in Connected Sites/settings. Make the block reversible and origin-scoped;
  do not silently expand it to a registrable domain or sibling subdomains.
- **Domain phishing warnings:** check the browser-derived origin against a maintained lookalike/phishing
  source before showing a connection approval. Treat a match as a prominent warning (never as proof
  that an unlisted domain is safe); specify list provenance, update cadence, and offline/stale behavior.
  Normalize origins carefully and cover IDNs/punycode, homograph lookalikes, subdomains, and ports.
  Do not send browsing history or origins to a third party as part of the lookup without explicit
  disclosure and consent.
- **Approval origin display verification:** the approval surface must show the exact browser-derived
  `https://` origin—not only a hostname, favicon, or dApp-provided name. Verify display and approval
  binding together, including punycode/lookalike hosts, deceptive subdomains, and non-default ports.

## Planned request queue, approval isolation, and transaction review

DApp requests are untrusted proposals, never an instruction to sign. Reuse the wallet's existing
background-owned review, revalidation, and one-time consent controls rather than creating a second
signing path or a generic `signAndBroadcast(payload)` helper.

- Keep public DApp messages limited to validated request preparation. They must not call signing,
  unlock the vault, or broadcast. Privileged approval actions must be accepted only from the exact
  wallet-owned approval page, checked using browser-provided `sender.id` and a parsed exact extension
  URL/path—not a loose `startsWith` prefix. Page-provided URLs and request types are not authority.
- Freeze the approved meaning, not just the incoming JavaScript object: validate a strict schema,
  normalize into a wallet-owned canonical request, bind it to origin/account/network/method, and
  render that same canonical request for review. Approval returns an opaque, single-use identifier;
  the background consumes it once, revalidates context immediately before signing, and rejects
  expiry, replay, account/network changes, or any mismatch. A shallow `Object.freeze()` is not
  sufficient for nested payloads; prefer immutable serialized/canonical data and never trust a later
  UI-supplied copy of transaction parameters.
- Keep pending requests memory-only, bounded, short-lived, and origin-scoped. Expire/clear them on
  lock, reset, disconnect, or worker restart; fail closed if worker suspension loses the request.
  Rate-limit requests and approval-window creation so an origin cannot spam the user.
- Decode and display the actual operation, recipient, amount, token/program, and relevant permissions
  from the canonical transaction—not dApp button text. Simulation can inform the review but cannot
  prove safety or replace decoding/revalidation. If decoding or simulation fails, refuse by default;
  do not offer a casual “I understand, sign anyway” bypass for unknown instructions. Any future
  exception must be separately designed as a high-risk feature with clear warnings and explicit
  product/security review.
- Treat clickjacking and fake approval UIs as distinct threats. The approval UI must be a real
  extension page opened only by the background, verify its request identifier, show the exact origin,
  and never ask for credentials on a web origin. A short confirmation delay is only a usability
  measure, not an authorization control. A user-selected phrase/avatar may help recognition but is
  not an authentication factor. Validate any proposed CSP anti-framing directive against Chrome MV3
  manifest rules and browser tests before relying on it; do not loosen the current restrictive CSP.

## Planned simulation and approval-request rate limits

These are future DApp-connection requirements, not current capabilities. The repository currently has
no DApp transaction queue, approval popup, or gRPC-Web client. Verify Thru's actual transaction
encoding, Query/Debug service definitions, request/response schemas, and node support from the
maintained SDK/protobuf sources before selecting any RPC method; do not implement against example
method names or inferred response fields.

### Transaction review and simulation

- Build the review from the wallet's validated, canonical transaction representation and supported
  Thru SDK primitives. Do not treat dApp-provided transaction labels as evidence of what executes.
  Display the decoded operation, program, recipient, asset, amount, fee payer, and relevant account
  or permission changes. Reject malformed types, negative/overflow values, unexpected fields, and
  oversized payloads before showing approval.
- Query pre-state and simulate against the same network and transaction context where supported.
  Show only balance/account changes that the simulator actually returns for the affected accounts;
  clearly mark unavailable fields rather than substituting the pre-state as the post-state. Include
  fees and token/account effects where the protocol reports them.
- Simulation is advisory, not a guarantee: chain state can change before broadcast, a node can be
  stale or dishonest, and a dry run may differ from the final signed transaction. Bind the reviewed
  transaction bytes/meaning and network to signing, and revalidate immediately before execution.
- A VM revert or invalid transaction is non-approvable. If decoding or simulation is unavailable,
  refuse DApp signing by default; do not use a casual checkbox to turn an opaque arbitrary payload into
  an allowed blind-signing path. Any exception requires a separate threat review and explicit design.
  Never claim a transaction is “safe” solely because simulation succeeded.
- Keep RPC transport details and untrusted simulation output behind the background boundary. Parse
  bounded response sizes, validate response fields, and render all logs/text as text—not HTML.

### Popup and request rate limiting

- Enforce a single active approval surface globally, plus per-origin request quotas and cooldowns in
  the background. Rate-limit before creating windows, retain bounded state, and provide a neutral
  refusal response that cannot trigger a popup loop. Disconnect/block actions should revoke the
  origin and invalidate queued requests.
- Track popup identity by actual Chrome window ID; clear it on close, user decision, creation failure,
  and stale-window recovery. Handle races and duplicate requests without losing or misbinding the
  queued request. A single-window lock does not replace per-origin quotas.
- Define what happens when an MV3 service worker is suspended. Pending transactions must fail closed
  and never be reconstructed from page-supplied data after restart; in-memory rate counters may reset,
  so popup creation also needs an independent global/queue bound.
- Test bursts against the background handler with forged sender metadata: for example, ten rapid
  requests must not open ten approval windows, must remain bounded globally and per origin, and must
  not allow one origin to exhaust another origin's quota. A webpage cannot directly call the
  extension's `chrome.runtime` API unless an explicit bridge exposes it, so test that boundary via
  unit/integration messaging fixtures rather than assuming page access.

## Proposed `window.thru` API and MV3 injection design (PLANNED)

This is a candidate interface for a future DApp-connection PR, not a currently shipped provider or a
promise of compatibility with existing Thru dApps. Confirm the Thru ecosystem convention and collect
consumer requirements before freezing method/event names.

### Candidate API contract

- Expose a minimal frozen `window.thru` object with a read-only `isThru === true`, read-only
  `isConnected` boolean, and `publicKey` (`ta...` only for the approved active account, otherwise
  `null`). A getter/property and a method named `isConnected()` conflict; prefer the property and omit
  the method. Keep `getAccount()` only if consumers need a stable object response.
- Promise methods may include `connect({ onlyIfTrusted = false })`, `disconnect()`,
  `signMessage(Uint8Array)`, `signTransaction(serializedTx)`, and
  `signAndSendTransaction(serializedTx)`. Define exact byte/string encoding and return types before
  implementation; do not silently coerce arbitrary objects or expose secrets/tokens.
- A consistent event surface may provide `on(event, listener)`, `off(event, listener)`, and
  `removeListener(event, listener)` for `connect({ publicKey })`, `disconnect()`, and
  `accountChanged(publicKeyOrNull)`. Specify duplicate listener behavior, event order, page reload,
  account switch, lock, and disconnect semantics. `thru#initialized` may be a discovery signal only;
  page-controlled events are spoofable and must never grant permission.
- `connect({ onlyIfTrusted: true })` may return an existing session without UI only when the exact
  browser-derived origin already has a valid background-owned grant. It must not create/revive a
  grant or expose accounts on failure.

### Page/isolated bridge boundary

- If implemented, use a minimal MAIN-world provider and a separate ISOLATED-world content bridge.
  MAIN-world code has no privileged extension APIs and must hold no keys or authorization state.
  The isolated bridge validates source, top-frame status, message shape, allowed method, size, and
  request ID, then forwards only normalized fields.
- `event.source === window` / `event.origin === location.origin` are useful transport checks, not
  authentication: the page can post its own messages and can inspect or replace page-visible
  objects. The bridge treats all page input as attacker-controlled; the background authenticates
  the browser-supplied sender metadata and permission state.
- Only top-level frames may make provider requests. Set `all_frames` false (or omit it) and reject
  `sender.frameId !== 0` in the background even if a future manifest accidentally injects into a
  subframe. Never accept origin values from message payloads.
- Do not relay generic internal contract method names. Use a separate narrow DApp message type and
  explicit method allowlist; DApp requests must never reach `vault.*`, `keyring.*`, internal export,
  or `tx.confirmReview` handlers directly.

### Manifest and permissions review before implementation

- A declarative `world: "MAIN"` content script can expose the page provider without making its file
  web-accessible, but every `matches` pattern is a host-access scope and provider-presence signal.
  Review the broad-site privacy/fingerprinting impact and Chrome Web Store permission disclosure
  before choosing all-HTTPS injection versus a narrower/optional-host strategy.
- For local development, use exact loopback patterns (`http://localhost/*` and
  `http://127.0.0.1/*`) only in a development/test configuration. The proposed
  `http://127.0.0*` pattern is not a safe/valid wildcard substitute. Production origins must be
  HTTPS; local HTTP must never become a production exception.
- Manifest-declared content scripts do not need to be listed in `web_accessible_resources`. Do not
  expose internal background, approval, or signing assets to web pages. Add WAR entries only for a
  narrowly justified resource that a page truly must fetch.
- Keep the current restrictive extension-page CSP. `frame-ancestors` support/acceptance in Chrome's
  MV3 extension CSP must be tested with the target Chrome versions and manifest validator before
  adding it; do not replace a working policy with the abbreviated proposed string or weaken
  `object-src 'none'` to `'self'`.

### Signing and session protocol gates

- Do not implement `tn_msg_sign_v1__` based only on the supplied example. Verify the exact domain tag,
  byte encoding, verifier rules, and test vectors against maintained Thru SDK/protocol sources first.
  The tag is protective only if all relevant verifiers enforce it and transaction authorization
  cannot accept a message signature. Background code—not the page—must prepend any verified tag.
- DApp signing goes through the existing decoded review and consent boundary. `signTransaction` and
  `signAndSendTransaction` must not create a parallel raw-sign path; undecodable data remains refused.
  Any blocklist is advisory/deny policy with provenance, refresh/staleness, privacy, and false-positive
  handling designed before network fetches are added.
- On lock, reset, disconnect, and account/network change, revoke or invalidate DApp sessions and
  pending requests as specified by the session model. Connected Sites management must revoke in the
  background, not by directly editing storage from the UI.
- Build a local test DApp as a fixture only after the protocol surface is stable. Use mock RPC and
  synthetic keys by default; exercise connect/denial, events, iframe rejection, origin binding,
  locked-state refusal, replay, popup spam, and disconnect. Do not broadcast live transactions in
  ordinary CI.

## Required automated coverage before release

1. Top-level approved-origin connection succeeds only after user approval; denial reveals no
   account and produces no signature.
2. Disconnect revokes the origin at the background boundary; subsequent connection-required requests
   are refused until that origin completes approval again, including requests already in flight.
3. A cross-origin iframe and a same-origin subframe cannot trigger connection, signing, or an
   approval UI, even when embedded by a trusted top-level site.
4. `postMessage` from an unexpected origin, another window, or an opaque origin is rejected.
5. Background requests with `sender.frameId !== 0`, missing sender origin, or an origin inconsistent
   with browser tab/frame metadata are rejected before any approval or signing path runs.
6. Locked-state signing requests refuse without exposing a signature; no request can auto-unlock the
   vault or bypass the review/consent flow.
7. Approval shows the exact browser-derived origin, including scheme, IDN/lookalike-host, subdomain,
   and non-default port cases; use HTTPS in production and permit loopback HTTP only in controlled
   development fixtures. The approval action remains bound to that same origin.
8. The Connected Sites manager revokes one/all origins at the background boundary and invalidates
   outstanding requests; the site bar updates to the revoked state.
9. Known phishing-list matches show a warning, while unlisted domains are not described as safe.
10. Blocking an origin suppresses new connection/approval prompts until explicitly unblocked; ordinary
    disconnect and phishing warnings do not silently create permanent blocks.
11. If idle auto-disconnect is implemented, expiry revokes at the background boundary and does not
    accidentally lock/unlock the wallet or refresh from unsolicited page traffic.
12. No provider exists in iframes, unrelated sites, or before a connection is approved; extension
    pages and the service worker remain inaccessible to page scripts.
13. Public request messages cannot reach a signing/broadcast handler. Forged internal approval messages
    from web pages and untrusted extension pages are rejected; test with injected sender metadata at
    the background handler (ordinary web pages do not directly receive `chrome.runtime` APIs).
14. Malformed, oversized, extra-field, negative-value, replayed, expired, or context-changed requests
    are rejected; mutation after review cannot change the transaction that is signed.
15. Unknown/undecodable operations and failed simulations refuse by default; displayed simulation
    results correspond to the exact request reviewed, and request/window spam is bounded.
16. A burst (including ten rapid requests) cannot create multiple approval windows; quota/cooldown,
    single-window races, disconnect, window-close, and worker-restart behavior are covered.

Use Playwright persistent Chromium contexts with separate origins for the parent and iframe. Serve
fixtures through `context.route()` and observe both extension pages and background messages. Tests
must not depend on valuable or live wallet keys; use isolated disposable fixtures. Do not enable
broad host permissions merely to make a test pass. A local `localhost`/`127.0.0.1` fixture can test
origin separation, but it does not prove production HTTPS behavior or browser-provided sender
metadata; include unit tests that inject realistic sender objects at the background boundary.

Do not put a live transaction in the default CI suite. A “zero-value self-transfer” may be invalid,
may incur fees, and is still a broadcast. Prefer mocked RPC or a transaction-build/simulation test;
any opt-in testnet broadcast needs a separately funded disposable key, explicit operator action,
and a documented spending/fee ceiling. Never require repository secrets for ordinary PR checks.

The current `tests/wallet-security.spec.js` includes only an absence-of-provider iframe smoke test.
It verifies that today's extension opens no extension page in response to forged page messages; it
does not test an approved-origin connection, origin allowlisting, background frame rejection, or a
signing approval flow. Implement those assertions with the DApp feature, not as placeholders that
could be mistaken for enforcement.
