# Domains, Name Service, and Custom Registrar

**Document Class:** Authority (Topical Guide — Shipped Behavior & Live Boundaries)
**Baseline:** Contract **v33** (`23` `name.*` methods, `/name` route) | **Status:** `IMPLEMENTED`, `TESTED`; live Betanet status detailed per capability below.
**Related Authorities:** `docs/DECISIONS.md` (D-013, D-014, D-015, D-016, D-019, D-022) · `docs/GLOBAL_SMART_CONTRACT_POLICY.md` · `contracts/thru-custom-registrar/README.md`

---

## 1. Namespace Architecture (`.thru` vs `.id`)

Thru has a native system Name Service program (`NAME_SERVICE_PROGRAM`, bootstrap address `taNAMEqRNEDeMWp0cDYmMVdZyTZiF5NyGDR9zTwH42rWQG`) plus registrar programs that govern subdomain minting under specific roots:

| Namespace | Program / Authority | Shipped Wallet Capability | Current Betanet State |
| --- | --- | --- | --- |
| **`.thru` (Custom Registrar)** | `contracts/thru-custom-registrar` (`ta2vDCBzzptN2qVZgz6PXsCp5cNB7Nef4yeQ3W-OqzZcfF`), root `taNP1MFOO2shpn6ORofIGSNiQ-qJ9VE2lDkDwvUmgUmaQZ`, config `ta_9lLvhxurg4J5DyZ82W14rzzGWCEfj9B7Y8wa99amPBa` | Register (`name.register` with `via: 'custom'`), Renew (`name.renewLease` with `via: 'custom'`), Lookup, Track/Import, Primary Alias, Record Append (`name.setRecord`), Reverse Lookup | **Active `.thru` route on Betanet.** Layout-2 tiered config (`100,000 / 10,000 / 1,000` base units/yr, `feePolicy: 'strict'`) updated on-chain 2026-10-31; treasury fee collection delta remains `UNVERIFIED` (`collectionProbe.measured: false`). |
| **`.thru` (Official Paid Registry)** | Official `BOOTSTRAP_PROGRAM_ADDRESSES.thru_registrar` (`src/lib/registrar.js`) | Purchase (`name.purchase`), Renew (`name.renewLease`), Claim Expired (`name.claimExpired`), Lookup, Track/Import, Primary Alias | **Absent on Betanet** (verified 2026-10-26); handlers return `{ supported: false }` / `REGISTRY_ABSENT` cleanly. |
| **`.id` (Community Root)** | Native `NAME_SERVICE_PROGRAM` root controlled by third-party authority | Forward Lookup (`name.lookup` with explicit `.id`), Send recipient resolution, Reverse Lookup if already tracked | **Resolution-only in `/name`.** Third-party root authority rejects foreign EOA registration (`NAME_PARENT_AUTHORITY` / user error 3). `/name` never offers `.id` minting. |
| **Generic Root Init** | `name.initRoot` | Gated off behind `FLAGS.NAME_SERVICE === false` (`FEATURE_DISABLED`) | Disabled by design (namespace-level admin operation). |

Root registrar addresses are derived deterministically in `src/lib/name-service.js` (`rootRegistrarAddress(rootName)` using raw root bytes, or SHA-256 first if `> 32` bytes), never hardcoded as untrusted strings (D-013).

---

## 2. Shipped `/name` UI (`src/ui/app/routes/name.js`)

The `/name` route exposes **two tabs** (`Register` and `My Domains`):

1. **`Register` Tab:**
   - Offers `.thru` registration only, automatically preferring the verified custom registrar (`availableThruProviders` in `src/ui/app/routes/name-providers.js`) and falling back to the official paid registry when that is the active `.thru` provider.
   - Debounces availability checks in the background without blocking typing (`Rule 15`) and invalidates stale responses immediately on edit.
   - Displays the label-length tier pill (`3 chars`, `4 chars`, `5+ chars`) and quotes `years * pricePerYearFor(cfg, label)` in BigInt base units formatted with 9-decimal THRU (custom registrar) or verified on-chain mint decimals (official paid registry).
   - When the searched `.thru` label is already owned by the active account (`mine` or `custom-mine`), surfaces **Renew** (preselecting the domain in the renewal flow) and **Import** (`Imported` once tracked via `name.trackDomain`).
   - Opens the shared bottom-sheet `TxReviewCard` (`domain-register`, `domain-purchase`, `domain-renew`, `domain-claim`) and submits via `submitReviewedReview` with a single keyed `pending` toast (`Rule 29`). There is **no** batch registration queue (deleted in `2026-10-30-review-lifecycle-audit.md`).
2. **`My Domains` Tab:**
   - Paints cached candidates immediately (`name.getCachedDomains`, labelled stale so cached ownership cannot enable mutations) and hydrates live ownership with bounded concurrency (`name.listDomains`).
   - Actions on verified owned names: **Make primary** (`name.setPrimaryDomain`), **Unlink** (`name.unlinkPrimary`), **Renew**, and **Remove** from local list (`name.untrackDomain`).
   - Note on release copy blocker (`docs/STATUS_AND_ROADMAP.md` §2): "Import" (`name.trackDomain`, read-only local watching) and "Unlink" (`name.unlinkPrimary`, clears wallet-local primary alias without signing) await owner-selected replacement wording before bumping package version `1.4.1`.

---

## 3. Storage, Ownership Verification, and Discovery Limits

- **Tracked Registry (`thru_registered_domains::<networkId>`):** Schema `{ version: 1, revision, records }`, owned by `src/background/services/primary-name-service.js` alongside `thru_primary_names::<networkId>`. Legacy v0 primary aliases migrate losslessly on the next mutation; unknown future schema versions fail closed. All mutations run through a per-network serialized queue with revision checks, and `wallet.reset` clears domain records across all networks.
- **Strict Ownership Normalization:** SDK `accounts.get` returns `meta.owner` as a `Pubkey` object; `thruClient.getAccountOwnerAddress` normalizes via `Pubkey.from(...).toThruFmt()` (never `String(meta.owner)`). Ownership requires program owner, derived domain PDA, decoded parent, and wallet address to match.
- **Full On-Chain Enumeration (`BLOCKED`):** Querying `ListAccounts` filtered by the Name Service program owner on Betanet returned `RESOURCE_EXHAUSTED: account listing database budget exceeded` (2026-10-27). `My Domains` is therefore an explicit wallet-tracked inventory, never claimed as complete chain-wide discovery.
- **Reverse Lookup (`name.reverseLookup`, v31):** `auth: 'unlocked'`, bound to the active network. Resolves an address only against this wallet's tracked registry and re-reads the domain forward on-chain to verify current ownership, returning the record's own root (`.thru` or `.id`) or `NO_CANDIDATE`.
- **Text Records (`name.setRecord`, v31):** `auth: 'signing'`, reviewed via kind `domain-record`. Encodes first-party opcode 2 (`APPEND_RECORD`), which **appends** rather than overwriting existing keys. Existence and ownership are three-state (`true` / `false` / `null` unreadable). Currently contract-only (no UI screen); live-chain write `UNVERIFIED`.

---

## 4. Fee Architecture (Protocol Price vs Transaction Network Fee)

Domain writes involve two distinct fee layers — neither may be fabricated (`D-019`, `D-022`):

1. **Transaction Header Network Fee (`tx-units.networkFeeUnits`):**
   - Every registrar and `name.setRecord` header declares `networkFeeUnits({ baseFeeUnits: network.baseFeeUnits, balanceUnits })`: **1 base unit** (`0.000000001 THRU`) on Betanet when the signer is funded, `0n` when unfunded, and `0n` (rendered `"not confirmed"`, never `"none"`) on networks where `baseFeeUnits` is `null` (Mainnet today).
   - Rechecked at `tx.confirmReview` via `assertFeeUnchanged` (`REVIEW_FEE_CHANGED` if balance shifted).
2. **Custom Registrar Protocol Price (`contracts/thru-custom-registrar`):**
   - Stored on-chain in 176-byte layout-2 `RegistrarConfig` (`fee_3_char`, `fee_4_char`, `fee_5plus_char`, `fee_policy`). Layout-1 (144-byte) configs remain backward-compatible as flat `best-effort` schedules and resize in place on `UpdateConfig`.
   - `feeEnforced` equals `fee_policy === 1` (`strict`). Under `strict`, a failed transfer reverts (`0xD206` / `0xD207`); under `best-effort` (`0`), a transfer refusal is ignored and the review surfaces `registrar-fee-unenforced` ("no charge reported", never "free").
   - **Current Artifact vs Chain Gap (Release Blocker #1):** Checked-in `contracts/thru-custom-registrar/thru-custom-registrar.bin` (`33,714` bytes, `sha256 f93c112b…35dd2`) adds canonical config PDA enforcement (`0xD112`), whereas Betanet currently runs the prior **2026-10-31** `30,000`-byte build (`feePolicy: "strict"`, `collectionProbe.measured: false`). Deploying the `33,714`-byte `.bin` and observing a real `Register` + `Renew` treasury balance delta on an RPC-reachable host are required before claiming on-chain fee collection. *(Minor UI hint note `H-5`: `routes/name.js` disables the pre-review CTA when `have < cost` rather than `cost + networkFee`; `registrar-service.js` enforces the full `cost + networkFee` bound before signing.)*
   - **Mainnet Smart-Contract Gates (`docs/GLOBAL_SMART_CONTRACT_POLICY.md`):** Before any Mainnet deployment of `thru-custom-registrar`, add an instruction-level `max_fee` ceiling on `Register`/`Renew` (protecting against concurrent admin `UpdateConfig` changes), gate `InitializeV2` on program upgrade authority (closing the permissionless first-caller config race), and disclose unaudited operator-managed status until externally audited.

---

## 5. Automated Test Coverage

`test/test-name-service.mjs` · `test/test-name-registrar.mjs` · `test/test-name-custom-registrar.mjs` · `test/test-custom-registrar.mjs` · `test/test-name-primary.mjs` · `test/test-name-records.mjs` · `test/test-name-reverse.mjs` · `test/test-name-ui.mjs` · `test/test-route-lifecycle.mjs`.
