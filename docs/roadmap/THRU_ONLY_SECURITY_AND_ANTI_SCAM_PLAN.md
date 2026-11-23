# Thru-Only Security and Anti-Scam Plan

**Status: PLANNED — review guide only.** This document groups future hardening ideas and records
what to verify before choosing implementation work. It does not assert that proposed features are
shipped, authorize a DApp bridge, or replace the current source of truth in `src/`, tests, and guards.
The current product remains a standalone Thru wallet; DApp connection work requires a separately
scoped implementation and security review.

## 1. Scope and non-negotiable invariants

- Keep the wallet Thru-only. Do not add EVM, `secp256k1`, other chain families, or chain-selection
  abstractions without a deliberate product decision.
- Preserve the current Thru HD derivation (coin type `8478`, Ed25519) and every golden derivation
  vector. Any SDK update or derivation change is its own reviewed migration; never smuggle one into a
  metadata-only schema change.
- Read `AGENTS.md`, `CONTEXT.md`, `docs/ARCHITECTURE.md`, `docs/AUDIT_REPORT.md`, and the relevant
  subsystem guide before implementation. Architecture and current audit status must be changed only
  when current behavior or conclusions actually change.
- Treat all items below as candidates. Prefer a tested, narrow hardening improvement over adding
  generic multi-chain machinery, broad browser permissions, or an unverified trust label.

## 2. Current baseline to preserve (verify against code when starting work)

- SDK/program packages are exact-pinned at `0.5.2`; `package-lock.json` is the installation source
  of truth.
- `src/lib/vault.js` uses PBKDF2-HMAC-SHA256 at 600,000 iterations and AES-256-GCM. Vault creation
  uses a random 16-byte salt; each AES-GCM write uses a random 12-byte IV. Re-encrypting an existing
  vault retains its per-vault salt so the existing derived key remains valid. Do not reinterpret the
  KDF envelope or change work factors without compatibility tests and measured UX/performance review.
- Decrypted session material is restricted to `chrome.storage.session` trusted contexts. JavaScript
  cannot guarantee erasure of immutable strings or copies retained by the runtime; clear references,
  destroy session data, and zero mutable byte buffers where practical, but do not claim perfect
  process-memory zeroization.
- Secret values intentionally appear only at explicit wallet creation/recovery/export UI steps; do
  not make the absolute claim that secrets never leave the background. Audit every bridge result and
  keep such disclosures scoped to the exact user-visible flow. Export remains password-gated.
- `src/background/index.js` checks `sender.id === chrome.runtime.id` on its internal runtime
  listener. There is no shipped `content_scripts`, `externally_connectable`, `onMessageExternal`
  handler, `window.thru` provider, or `window.postMessage` wallet bridge. Do not add a broad sender
  surface as part of unrelated hardening.
- Transaction review uses background-owned review records and one-time consent tokens. The consent
  token is random, memory-only, bounded, bound to the canonical parameter hash/account/network, and
  expires after 60 seconds. Unknown/undecodable operations are not a blind-sign path. Reuse and test
  this boundary rather than adding a second signing channel.
- MV3 CSP is deliberately restrictive (`default-src 'none'`, packaged scripts only, no frames,
  `object-src 'none'`); `scripts/check-csp.mjs` checks network/CSP consistency, inline event
  handlers, and external-script SRI. The DOM factory and source guard enforce the zero-HTML-sink
  policy. Do not weaken `object-src 'none'` or add unsupported manifest directives to imitate a
  web-page CSP.
- The Semgrep/npm-audit workflow and Playwright smoke coverage are separate from feature-level DApp
  security. A smoke test that proves no provider exists is not evidence of origin authorization.

## 3. Candidate workstream A — Thru-only vault metadata

A `family: 'thru'` and `curve: 'ed25519'` tag could make the current single-chain model explicit, but
it adds persisted data without enabling a current user capability. Defer unless a concrete consumer
needs those fields. Do not add a schema migration just for hypothetical multi-chain support.

If approved later:

1. Define whether tags belong to keyrings, accounts, or both; use one canonical location and document
   it in the schema. Imported private-key keyrings and seed-derived keyrings must be treated equally.
2. Backfill only missing values to `family: 'thru'` and `curve: 'ed25519'`. Reject unknown values
   rather than silently treating them as Thru. Keep migration idempotent and preserve all keyring
   secrets, IDs, derivation indices, labels, and account references.
3. Keep migration compatibility separate from derivation. Assert that before/after derived addresses
   are byte-for-byte identical and that `test/test-derivation.mjs` golden vectors do not change.
4. Add legacy vault, imported-key, seed-keyring, unknown-family refusal, and migration-restart tests
   to `test/test-storage-migrations.mjs` / vault tests before shipping.

## 4. Candidate workstream B — standalone anti-scam defenses

These improve wallet-operated Send, History, naming, or transaction review without adding website
connectivity. Prioritize only after confirming the existing decoder/data model can support an honest
warning.

### 4.1 Address poisoning and unfamiliar recipients

- Consider marking suspicious zero-value/dust or unsolicited incoming rows as **possible spam**;
  do not silently delete chain history or imply that every small transfer is malicious.
- Make copy-address controls explicit and avoid making an unsolicited incoming sender the easiest
  recipient to copy. Preserve provenance and allow the user to inspect the original record.
- In Send, consider a non-blocking unfamiliar-recipient warning when the destination is absent from
  contacts and local prior outbound history. Do not call an address safe merely because it was used
  before; do not upload history to an external service.
- Tests should cover self-owned addresses, prior outbound recipients, contacts, zero/dust values,
  missing/unknown amounts, network/account isolation, and false positives.

### 4.2 `.thru` / `.id` confusable names

- Audit canonicalization at input, lookup, registration, and resolved-name display. Lowercasing alone
  is not Unicode normalization or homograph protection.
- First establish the chain's accepted name alphabet and normalization rules. If the protocol expects
  ASCII, reject unsupported Unicode before RPC; if internationalized names are supported, display a
  safe ASCII/Punycode form and make the Unicode form explicit rather than silently substituting it.
- Always show the resolved `ta...` address in value-moving review. A recent-registration warning is
  appropriate only if authoritative on-chain creation time is available; otherwise show “unknown,”
  never an inferred age.
- Tests should include Cyrillic/Latin lookalikes, combining characters, zero-width characters,
  mixed normalization forms, uppercase input, valid ASCII, and round-trip canonical names.

### 4.3 Program identity and review warnings

- The review UI already has an “Unrecognised program” warning when a decoded operation has no
  recognized program record. Preserve the distinction between a known address and an audited/safe
  program; package membership alone is not proof of deployment identity or security.
- Before adding “Verified Official Program” badges, define provenance per network: exact program ID,
  source/version, live deployment evidence, and last verification. Unknown/unverified addresses must
  remain visibly distinct, and undecodable operations remain blocked by the existing review policy.
- Tests should verify known, unknown, package-declared-but-not-live-verified, and network-mismatched
  program states, including the exact rendered label and warning severity.

## 5. Candidate workstream C — DApp connection (separate future feature)

Do not implement these controls until a provider protocol, content-script/host-permission strategy,
approval lifecycle, and browser-sender contract are approved. `docs/dapp/security.md` is the detailed
DApp design guide, including the candidate `window.thru` method/event surface and MV3 injection
trade-offs. In particular:

- Do not implement the proposed `tn_msg_sign_v1__` domain-separation prefix until the exact Thru
  message-signing format and verifier behavior are verified against maintained protocol/SDK sources
  and test vectors. A prefix is only protective if every verifier enforces it and transaction
  decoders cannot accept the signature as a transaction authorization.
- Any origin grant is based on browser sender metadata and explicit approval, scoped to the exact
  top-level origin, revoked on lock/disconnect, and unavailable to subframes. It is not granted by a
  popup writing a `connectedOrigins` object.
- Phishing-list matches are warnings or explicit blocks with documented provenance, freshness,
  privacy, and offline behavior; an unlisted origin is not thereby “safe.” Approval UI must display
  the exact browser-derived origin.
- Never enable blind signing or rely on an unverified gRPC-Web `DebugReExecute` method. First verify
  Thru transaction formats, service definitions, simulation semantics, and response fields from the
  pinned SDK/protobuf sources. Simulation is advisory and must bind to the same transaction reviewed.
- A live testnet transaction is not a routine CI test. Use mocked RPC/transaction fixtures by default;
  any opt-in broadcast requires a disposable wallet and an explicit operator-run procedure, not a
  repository secret used on every pull request.

## 6. Verification gates for future implementation PRs

- Before/after read `docs/ARCHITECTURE.md`, `docs/AUDIT_REPORT.md`, `docs/PROJECT_LEDGER.md`, and
  `docs/STATUS_AND_ROADMAP.md`; update only documents whose current claims change. Keep this plan
  labeled `PLANNED` until code and tests ship.
- Run `npm run build`, `npm test`, `npm run test:browser`, `npm audit --omit=dev`, and the relevant
  Semgrep scan. Also retain the full lockfile audit (`npm audit --audit-level=high`) in CI.
- For a persistence change, run all storage migration and vault tests. For review/signing changes,
  run the review lifecycle, consent, signing-surface, and transaction-review tests. For UI changes,
  run the real Chromium MV3 suite when available.
- Test negative paths and realistic false positives; do not mark tests skipped to claim completion.
  Do not alter coin type 8478 vectors, loosen CSP, add unnecessary npm packages/permissions, or
  require a live wallet secret for ordinary CI.
- Report shipped facts, planned items, and unavailable verification separately. No “zero issues” or
  “secure” guarantee is implied by passing automated checks.
