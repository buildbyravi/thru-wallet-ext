# Audit report — Thru Wallet Extension

**This file is the audit index and the current conclusion.** Full audit findings, evidence, and
remediation records live as dated files under `docs/audits/` and are append-only history — a new
audit adds a dated file and refreshes the summary here; a dated record is never edited. The
open readiness gates below are current state and are maintained here, not in the records.

## Current conclusion (2026-10-04)

**Production-rules conformance audit — accepted baseline. No P0 fund-loss/security defect.**
All eight findings (F-01…F-08: two security-policy documentation defects, stale ledger
identifiers, a public-policy permission omission, a fee-provenance dead branch, stale rule text,
and two dead-code leftovers) are fixed, re-verified, and covered by regression tests — including
a negative control. The prior 2026-10-03 remediations (MR-01…MR-07: signing-operation network
lock, legacy send retirement, serialized pending writes, schema versioning, signing-default
decision, status refresh, derivation provenance) are all present in source and tested.
The architecture is frozen (see `AGENTS.md`); the remaining work is verification, not
restructuring. External audit remains required; no external audit exists.

Baseline evidence (re-run green 2026-10-04): `npm run build` PASS · `npm test` PASS
(derivation 16/16, contract 80/80, lifecycle 1017/1017, 1647 assertions) ·
`npm audit --omit=dev` 0 vulnerabilities.

## Mainnet-readiness gates — open (classified 2026-10-04)

Classification basis: the accepted 2026-10-04 conformance audit (all findings F-01…F-08 fixed
and re-verified) and the same-day hardening pass. The categories are never merged: a passing
Node test cannot close a browser item, a Betanet observation cannot prove Mainnet behavior, and
a source audit is not an external audit. Full findings and remediation detail live in the dated
records below.

**A. Automated verified (deterministic, local — re-run green on 2026-10-04):**

- `npm run build` — PASS, no warnings; `dist/` regenerated from current source.
- `npm test` — PASS: derivation goldens 16/16 (pinned 0.4.1), QR 15/15, layering 80 files /
  0 violations / 0 DOM sinks, CSP↔enabled-networks two-way, routes 14/14 both directions,
  CSS nesting, launchpad quarantine 47/47, contract both directions 80/80, security-checks 20,
  DOM/refs 130/130, route lifecycle 1017/1017, storage migrations (v0→v1 + future-version
  fail-closed), vault, Thru client wire goldens, token balances, network-scoped balances,
  History cache/block-time, registration policy, API-router (auth, serialization, quarantine,
  checked sends, fee provenance), auto-lock.
- `npm audit --omit=dev` — 0 vulnerabilities.
- Contract v16, 81 methods: manifest ↔ router ↔ shipped-callers agreement enforced.

**B. Browser verified: PARTIAL — OPEN.** One partial real-Chrome run is recorded (2026-10-04;
run record in `docs/MANUAL_SMOKE_CHECKLIST.md` §7): local build of the current source tree
loaded unpacked, toolbar popup only — a native Betanet send to the tester's own account
verified recipient acceptance, amount parsing, the Review fee display, confirmation, and the
History entry, so the `/send` route row's popup cell is ticked. The charged-fee figure was not
captured, and a self-send does not exercise v12 recipient activation. Everything else remains
open: popup/side-panel layout at narrow/wide widths, real focus rings, QR canvas, popup/panel
mutual exclusion, clipboard permission prompt, and MV3 worker eviction/restart all remain open
in `docs/MANUAL_SMOKE_CHECKLIST.md`. The `1.4.1` store package went live 2026-10-04 on
automated evidence alone, predates the same-day fee-provenance/dead-code fixes, and still has
no browser verification (`extension.md` §9) — the partial run is not evidence about it.
A green DOM-shim suite is not evidence here.

**C. Betanet live verified (provenance retained; the historical 2026-09 observations do NOT
certify the current v12/v16 code paths):**

- Native transfer program behavior and the 1-base-unit fee, measured on the managed-genesis
  chain 2026-09-26 (the same program deployment Betanet runs); recorded per-network with
  `feeSource: 'measured'`.
- Faucet instruction layout credited 10,000 units from the bootstrap vault PDA (2026-09-26).
- Explorer `/address/` route with `?network=` scoping verified 2026-09-27; ~6-second block
  cadence verified 2026-09-29.
- Current-code send observation, partial (2026-10-04): a native Betanet send to the tester's
  own account was driven end-to-end through the real Chrome popup from a local build of the
  current source tree (post-`14e16b1`) and confirmed on-chain, appearing in History. One
  self-send only: the charged-fee figure was not captured, v12 JIT recipient activation was
  not exercised, and token paths were untouched.

Still open on Betanet: live v12 account activation and Send JIT, token-transfer
recipient-owner acceptance and the actual token-program fee, current block-time
availability/latency, confirmation of the explorer `/tx/` route, and any authoritative
charged-fee source. Use only throwaway wallets for these.

**D. Mainnet-specific verification: NONE.** Mainnet is declared but disabled; its fee is
explicitly unknown (`baseFeeUnits: null`, estimate returns `supported: false`), its RPC origin
is not in `connect-src`, and no mainnet-specific testing exists. A Betanet observation cannot
prove Mainnet behavior — fee schedule, program deployment, and explorer routing may all differ.
Before mainnet enablement: re-measure fees on mainnet, verify program ids, and re-run the
live-chain items against it.

**E. External security audit: NOT PERFORMED — EXTERNAL AUDIT REQUIRED.** The 2026-10-03 and
2026-10-04 source audits and remediations are internal work and are not a substitute. No
external audit of this wallet exists; no claim of one may be made.

---

## Audit records (append-only, dated)

| Date | Record | Scope |
| --- | --- | --- |
| 2026-10-04 | [`docs/audits/2026-10-04-conformance.md`](audits/2026-10-04-conformance.md) | Production-rules conformance: baseline, findings F-01…F-08, remediation units U1–U5. |
| 2026-10-03 | [`docs/audits/2026-10-03-mainnet-readiness.md`](audits/2026-10-03-mainnet-readiness.md) | Mainnet-readiness: findings MR-01…MR-07 and their source remediations. |
| 2026-09-18 | [`docs/audits/2026-09-18-baseline.md`](audits/2026-09-18-baseline.md) | Baseline security audit: findings F-01…F-09 of the original review (historical; superseded states are labeled inside). |

Rules: append a new dated file per audit; refresh the summary and gates above; never edit or
delete a dated record; keep the five gate categories separate from one another.
