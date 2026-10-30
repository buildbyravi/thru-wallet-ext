# thru-custom-registrar

Side-by-side name registrar program for the Thru L1 (ThruVM / RISC-V), built to run
next to the native name-service program — never replacing it. Owner directive
2026-10-24: open public subdomain registration under our own namespace root with a
protocol-collected fee. Owner directive 2026-10-30: the fee is **tiered by label length**
and stored on-chain (Betanet intent: 3 chars = 100 000, 4 = 10 000, 5+ = 1 000 base units
per YEAR), with the whole schedule changeable at runtime via `UpdateConfig`.

> **Nothing here is deployed.** The checked-in `thru-custom-registrar.bin` predates the tiered
> layout and must be rebuilt before it can be deployed; the Rust in this directory has not been
> compiled in this environment (no `cargo`). See "Deploy & initialize" and `docs/DEFECT_LOG.md`
> §17C.

```text
 user (signer, idx 0)
   │  Register{label, years, target}            fee = fee_per_year × years (u64 checked)
   ▼
 ┌────────────────────────────┐  CPI init-root / register-subdomain
 │  thru-custom-registrar     │ ────────────────────────────────▶ native name-service
 │  (this program)            │    InvokeAuth{config account}     (tag 0 / tag 1)
 └────────────────────────────┘
   │ sys_account_transfer(user → treasury, fee)
   ▼
 treasury account
```

## Why this design

The native name-service program enforces **parent authority**: register-subdomain
reverts (error 3) unless the authority account is authorized. The name-service's
`.id`/`.thru`-style roots are closed to foreign signers — live-verified on Betanet
2026-10-24 (owner's probe: `scripts/probe-live-name.mjs`; error -765 / user error 3 in
subsequent transaction traces). ThruVM's CPI framework (`INVOKE` syscall 0x0A +
`InvokeAuth`) lets a *program-owned* account be passed as an authorized authority to a
callee (`is_account_idx_owned_by_current_program`). So:

1. `Initialize` creates the program-owned **config account** (32-byte caller-chosen
   seed), stores admin/treasury/fee/root, then CPIs `init-root` with the config account
   as the root's authority.
2. `Register` validates policy, collects the fee by `sys_account_transfer` user →
   treasury, creates the program-owned **lease account**, then CPIs
   `register-subdomain` with the config account authorized via `InvokeAuth`.
3. `Renew` extends the lease (no name-service CPI needed; the domain record persists):
   new expiry = max(now, expires_at) + years × 31_536_000 s.
4. `UpdateConfig` (admin only) adjusts `fee_per_year` and/or `treasury`.

Checks–Effects–Interactions order is strict: all transaction-account identity checks
and the lease write happen *before* the fee transfer and the CPI; a CPI failure reverts
the whole transaction (fee transfer included).

## Byte formats (pinned, shared with the JS client)

All integers little-endian. Instruction header: `u32 tag`, followed by the instruction's
u16 **account-table indices**, then the semantic args.

**Account-index convention (ABI v2, corrected 2026-10-24).** Indices are carried *inside the
instruction data* — the first-party convention (`txn_tools.rs` builders) — because the published
`@thru/sdk@0.4.2` npm dist byte-sorts each readWrite/readOnly segment before serializing
(`normalizeAccountList` → `.sort(compareAccounts)`; proven live in the sandbox and pinned as a
regression sentinel by `test/test-custom-registrar.mjs`). The VM-visible table is
`[feePayer(0), this program(1), sorted-readWrite…, sorted-readOnly…]`; positional constants are
therefore invalid. Clients must resolve indices via the SDK `InstructionContext.getAccountIndex`
inside the `instructionData` callback (`scripts/registrar/*.mjs` shows exactly how).

| tag | ix           | body |
|-----|--------------|------|
| 0   | Initialize (SUPERSEDED) | the old flat-fee layout; **rejected with 0xD006** by name, so an out-of-date deploy client cannot install a config the price path cannot read |
| 4   | InitializeV2 | `u16 config_idx`, `u16 root_idx`, `u16 ns_idx`; `u64 fee_3`, `u64 fee_4`, `u64 fee_5plus`, `u8 fee_policy`, `32 treasury`, `u32 root_name_len`, `root_name[32]` (zero-padded), `32 config_seed`, `u32 config_proof_len + proof`, `u32 root_proof_len + proof` (admin == fee payer idx 0) |
| 1   | Register     | `u16 treasury_idx`, `u16 root_idx`, `u16 domain_idx`, `u16 lease_idx`, `u16 config_idx`, `u16 ns_idx`, `u16 target_idx` (may be 0 when the fee payer self-registers); `u16 duration_years`, `u32 label_len`, `label[32]`, `32 target_pubkey` (must equal accounts[target_idx].pubkey), `u32 domain_proof_len + proof`, `u32 lease_proof_len + proof` |
| 2   | Renew        | `u16 treasury_idx`, `u16 lease_idx`, `u16 config_idx`; `u16 duration_years`, `u32 label_len`, `label[32]` |
| 3   | UpdateConfig | `u16 config_idx`; `u8 mask` (bit0 treasury, bit1 fee_3, bit2 fee_4, bit3 fee_5plus, bit4 fee_policy), `32 new_treasury`, `u64 new_fee_3`, `u64 new_fee_4`, `u64 new_fee_5plus`, `u8 new_fee_policy` |

Role sets per instruction (order in these lists is meaningless — the SDK sorts):

| ix           | roles |
|--------------|-------|
| Initialize   | 0 admin(fee payer) · 1 this program · config(rw,new) · root(rw,new) · name-service(ro) |
| Register     | 0 user(fee payer) · 1 this program · treasury(rw) · root(rw) · domain(rw,new) · lease(rw,new) · config(ro) · name-service(ro) · target(0 if self, else an extra ro entry) |
| Renew        | 0 user(fee payer) · 1 this program · treasury(rw) · lease(rw) · config(ro) |
| UpdateConfig | 0 admin(fee payer) · 1 this program · config(rw) |

Index hygiene enforced in-program (`ERR_BAD_ACCOUNT_INDEX` = 0xD005): role indices may not be
the reserved slots 0/1 (target excepted) and disjoint roles may not share an index. In addition
to the index, the program cross-checks what each index *is*: treasury and root pubkeys must equal
the values stored in the config account, and `accounts[target_idx]` must equal the instruction's
`target_pubkey`. Never trust an index alone.

State accounts (both owned by this program; magic discriminators `TCR1` / `RLS1`):

- **RegistrarConfig** — two layouts, and the program reads both:
  - **layout 1 (144 B)**, what the deployed program wrote: `admin[32]`, `treasury[32]`,
    `fee_per_year u64`, `root_address[32]`, `root_name[32]+len u8`, `bump u8`. It reads as a
    FLAT schedule (every tier = `fee_per_year`) with the best-effort policy, i.e. exactly the
    behaviour it had — so shipping the new program does not change anyone's price.
  - **layout 2 (176 B)** appends `fee_3_char u64`, `fee_4_char u64`, `fee_5plus_char u64`,
    `fee_policy u8`. `fee_per_year` stays as a DERIVED mirror of `fee_5plus_char` so a
    layout-1 reader shows the cheapest tier rather than zero. `UpdateConfig` grows a layout-1
    account to 176 B in place (`account_resize`), so no re-initialisation is needed.
- `fee_policy`: `0` best effort (the charge is attempted and a refusal is ignored — the
  deployed behaviour), `1` strict (a refused charge reverts: `0xD206`, or `0xD207` when the
  balance cannot cover it). **Strict is not the default anywhere**: the deployed program's
  charge has only ever failed (VM `-10 AccountNotWritable`, surfaced as `0xD20A`), so it must
  be switched on only after a charge is observed to land.
- **DomainLease** (120 B): `owner[32]`, `resolver[32]`, `expires_at u64` (epoch s),
  `registered_at u64`, `label[32]+len u8`.

The name-service CPI payloads are re-encoded inside the program from the FIRST-PARTY
layout (Unto-Labs/thru@`a058dd8` `rpc/thru-base/src/txn_tools.rs`,
`#[repr(C, packed)]` args + inline creation proofs) — see `src/cpi.rs` tests; the
extension registers the same byte formats against the live CLI since 2026-10-24.

## Build

```bash
cargo build --release --bin thru-custom-registrar            # → ELF
rust-objcopy -O binary \
  target/riscv64imac-unknown-none-elf/release/thru-custom-registrar \
  thru-custom-registrar.bin                                   # deployable blob
```

Requirements: current stable Rust + `rustup target add riscv64imac-unknown-none-elf` +
`cargo install cargo-binutils`. The first-party SDK is **vendored** under `./vendor`
(pin + provenance: `../VENDORED.md`).

Host-side unit tests (byte layouts only — no VM):

```bash
cargo test --lib
# or, explicitly on the host target:
cargo test --lib --target "$(rustc -vV | sed -n 's/^host: //p')"
```

## Deploy & initialize (scripts in `scripts/registrar/`)

Deployment and root setup are driven from the wallet repo (this monorepo) with the
pinned `@thru/programs` deploy workflows — `scripts/registrar/deploy-and-init.mjs`.
It needs the owner host (live RPC is sandbox-blocked here):

```bash
# 1) Rebuild the blob FIRST — the checked-in .bin is the pre-tiered layout:
cargo build --release --bin thru-custom-registrar && rust-objcopy -O binary \
  target/riscv64imac-unknown-none-elf/release/thru-custom-registrar \
  thru-custom-registrar.bin

# 2) Deploy + initialize with the tiered schedule. Defaults are the Betanet intent;
#    the policy starts at best-effort because strict can revert every registration
#    until a charge is proven collectable (see below).
THRU_SEED="..." node scripts/registrar/deploy-and-init.mjs \
  --root thru --fee-3 100000 --fee-4 10000 --fee-5plus 1000 \
  --fee-policy best-effort --treasury <OWNER_TREASURY_ADDRESS> \
  --bin contracts/thru-custom-registrar/target/riscv64imac-unknown-none-elf/release/thru-custom-registrar.bin

# 3) Prove collection, then enforce it:
#    a. --probe-collection prints and records the treasury balance;
#    b. register one name for real (wallet or CLI);
#    c. run the probe again and compare — a delta is the only evidence that counts;
#    d. re-run with --fee-policy strict --collection-proven "<where you saw the delta>".
THRU_SEED="..." node scripts/registrar/deploy-and-init.mjs --root thru \
  --fee-policy strict --collection-proven "0.000001 THRU in treasury after tx <sig>" ...
```

The script asserts, from a re-read of the chain, that the layout is 2, that the three tiers
equal the requested schedule, and that the policy matches. A deployment that silently kept the
old config therefore fails the run instead of looking successful.

Live-verification happens on the owner host (same machine, `npm run test:live`
pattern); nothing about this program is presented in the wallet UI until that evidence
lands.
