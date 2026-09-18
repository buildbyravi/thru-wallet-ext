# Passkey feasibility spike (P3)

Time-boxed research output, per the agreed order: spike first, implementation only if the
questions below have concrete answers. **Nothing here ships.** No new dependencies, no keyring
branch, no `checkAuth` fork.

Date: 2026-09-18. Method: read the installed `@thru/programs@0.3.16` passkey-manager bindings
(`node_modules/@thru/programs/dist/passkey-manager/index.d.ts`, 382 lines, fully typed) plus
the Thru docs page previously fetched (`thru.org/docs/sdks/web-packages/programs/`). Where
the chain's behaviour is not knowable offline, it is flagged, never guessed.

## 1. What the installed bindings already give us

These are real, version-pinned, and importable today — same policy as the token work
(prefer official bindings over hand-rolled wire code):

- **Instruction encoders** for `CREATE` (0), `VALIDATE` (1), `TRANSFER` (2), `ADD_AUTHORITY` (4),
  `REMOVE_AUTHORITY` (5), `REGISTER_CREDENTIAL` (6), plus `encodeInvokeInstruction` and
  `concatenateInstructions` for batching.
- **Challenge construction**: `createValidateChallenge(nonce, accountAddresses,
  walletAccountIdx, authIdx, targetInstruction)` — SHA-256 over the domain
  `thru.passkey.validate` binding **nonce + ordered account list + wallet index + authority
  index + the full target instruction bytes**. This is exactly the binding the critique said
  must hold, and it is only constructible *after* instruction building — confirming that a
  passkey branch cannot live in the api-router's generic `checkAuth()`; it belongs in the
  tx/passkey service at instruction-construction time.
- **Authority model**: `Authority` = tag 1 (passkey, 32-byte X ‖ 32-byte Y) or tag 2 (pubkey);
  `AuthorityRecord` adds `expiresAtBlockTimeSeconds`; `createSessionAuthorityRecord` for
  session keys; `parseWalletAuthorities` reads the on-chain account back with
  `layout: 'authorityRecord' | 'legacyAuthority'` — the chain has run **two program revisions**,
  and both legacy encoders ship alongside the record-carrying ones.
- **Signature plumbing**: DER parse + `normalizeLowS` + 32-byte component normalization
  (`P256_N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551`,
  `P256_HALF_N` exported). In-repo code would never touch raw `r`/`s` math; the bindings own it.
- **Address/seed helpers**: `createWalletSeed(walletName, x, y)`, `deriveWalletAddress`
  (PDA: `SHA256(program || is_ephemeral || seed)`), credential-lookup PDA helpers.
  Passkey wallets are **program-derived accounts**, not keypairs — a passkey wallet *address*
  is deterministic from (name, passkey pubkey) and holds no seed of its own.
- **Nonce handling**: `parseWalletNonce` / `fetchWalletNonce` — the passkey account carries its
  own nonce, so passkey sends are ordinary nonce-sequenced transactions once wrapped.
- **Fee-payer architecture, answered in the bindings**: `buildWalletAccountContext` explicitly
  reserves **index 0 for a fee payer "selected later by the wallet"** and provides
  `assertWalletFeePayerCompatible` for the failure mode where a late payer choice invalidates
  encoded indices. The Thru model is therefore: passkey authorizes, **someone else pays**.
  The passkey account itself is a PDA with no private key — it cannot pay its own fee.

## 2. Answers to the critique's gating questions

### Q1 — Who pays the outer transaction fee? ← mostly answered
Someone other than the passkey. The binding makes the fee payer a first-class, late-bound
parameter. For a *passkey-only* user the realistic answers are: (a) a sponsor/relayer wallet,
(b) a faucet-funded fee flow, or (c) a pubkey authority added to the same account that doubles
as payer. What **remains open**: whether validators accept a VALIDATE-wrapped transaction whose
fee payer is a different account than the wallet being authorized, on today's alphanet build —
and what the fee mechanics are (same 1-base-unit structure as native, or program-specific).
That is a live-chain question, answerable by the same style of throwaway-key probe script as
`scripts/verify-token-transfer.mjs`.

### Q2 — WebAuthn RP origin in a Chrome extension ← the brief was wrong, and this is settled
Chrome extensions **can** call WebAuthn (Chrome 122+). An extension origin can assert RP IDs
covered by its host permissions; `clientDataJSON.origin` remains the extension origin. So the
passkey ceremony can run inside the extension (popup, side panel, or an opened extension page)
without a hosted-companion page. The earlier brief's "no usable RP ID" premise does not hold.
Residual caution: `clientDataJSON.origin` being an extension origin must be accepted by the
on-chain VALIDATE logic — the program verifies the signature over `authenticatorData ‖
SHA256(clientDataJSON)`, and the challenge binding is in `clientDataJSON.challenge`, so the
origin string is **carried but not validated against a chain-side allowlist** in anything the
bindings expose. Verdict: no protocol blocker visible; must be proven with one live VALIDATE.

### Q3 — Transaction building ← fully answered
VALIDATE wraps an arbitrary target instruction (`TargetInstructionParams { programIdx,
instructionData }`) and instructions concatenate for batching. The outer transaction is built
with the wallet's existing `buildAndSign` machinery; the passkey contributes
`authenticatorData`, `clientDataJSON`, and low-S-normalized `signatureR/s` via a `WalletSigner`
shim (`signTransaction(payloadBase64) → base64`). Multi-call batching exists.

### Q4 — Recovery ← answered at the protocol level
`ADD_AUTHORITY`/`REMOVE_AUTHORITY` + expiring authority records give a real recovery story:
register a backup pubkey authority (cold keyring) with its own `authIdx`, use
`resolvePasskeyAuthorityIndex` / `findPasskeyAuthorityIndexInWalletData` to pick the right
authority at sign time, and `REMOVE_AUTHORITY` for rotation. Before any passkey feature is
marketed as a seed replacement, the wallet must ship an "add recovery authority" flow that
works end-to-end on the live program **revision actually deployed** (see Q5).

### Q5 — NEW question the spike surfaced: which program revision is live?
The bindings carry both `encodeCreateInstruction` (AuthorityRecord) and
`encodeLegacyCreateInstruction` (bare Authority), and `parseWalletAuthorities` reports
`layout: 'authorityRecord' | 'legacyAuthority'`. A wallet that encodes CREATE against the wrong
revision bricks the account it creates. This is a chain-config question (`alphanet` entry in
`networks.js` should record the passkey program address + revision with provenance, same
pattern as `baseFeeUnits`) answerable by one on-chain probe: parse an existing passkey account,
or CREATE a throwaway one and read back its layout.

## 3. The one question that is NOT a chain question: lifecycle fit

Passkey ceremonies are user-gesture-bound and can outlive a service-worker's background moment;
the popup can close mid-ceremony. The honest fit for this codebase is: run registration and
signing ceremonies in an **extension tab/side panel** (not the auto-closing popup), the same
shape the roadmap already reserves for full-tab surfaces. No architectural conflict, but it is
a UX constraint that must be designed in, not discovered.

## 4. Verdict

- **Protocol/building blocks: FEASIBLE.** Everything the chain needs is already in the pinned
  bindings, including the hard parts (challenge binding, fee-payer split, authority records,
  low-S normalization).
- **Implementation: NOT YET.** Three concrete unknowns gate it, in order: **(Q5)** live program
  revision, **(Q1-residual)** whether a distinct-account fee payer validates on-chain, and one
  live VALIDATE proving extension-origin `clientDataJSON` is accepted (Q2-residual). All three
  are probe-script answers, not research projects.
- **Next concrete step if the user green-lights exploration:** a `scripts/verify-passkey.mjs`
  probe (throwaway keys, never the vault) answering Q5 then Q1-residual; the Q2-residual proof
  needs a real browser and belongs to the manual/smoke tier alongside the Chrome smoke run.
- **Explicit non-goals reaffirmed:** no keyring branch in `checkAuth`; passkey metadata stored
  as full `PasskeyMetadata` (credentialId, **P-256 X/Y**, rpId, **authIdx**) — never derived
  from a seed; recovery-authority flow precedes any "replace your seed" messaging.
