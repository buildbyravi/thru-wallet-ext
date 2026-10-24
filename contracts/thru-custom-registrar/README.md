# thru-custom-registrar

Side-by-side name registrar program for the Thru L1 (ThruVM / RISC-V), built to run
next to the native name-service program — never replacing it. Owner directive
2026-10-24: open public subdomain registration under our own namespace root with a
protocol-collected fee (testnet: **1000 base units/year**; mainnet price decided later
against the THRU market price, changed at runtime via `UpdateConfig`).

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

All integers little-endian. Instruction header: `u32 tag`.

| tag | ix           | body |
|-----|--------------|------|
| 0   | Initialize   | `u64 fee_per_year`, `32 treasury`, `u32 root_name_len`, `root_name[32]` (zero-padded), `32 config_seed`, `u32 config_proof_len + proof`, `u32 root_proof_len + proof` |
| 1   | Register     | `u16 duration_years`, `u32 label_len`, `label[32]` (zero-padded), `32 target`, `u32 domain_proof_len + proof`, `u32 lease_proof_len + proof` |
| 2   | Renew        | `u16 duration_years`, `u32 label_len`, `label[32]` |
| 3   | UpdateConfig | `u8 mask` (bit0 fee, bit1 treasury), `u64 new_fee`, `32 new_treasury` |

Account-table conventions (outer tx; index 0 = fee payer like every CLI flow):

| ix           | accounts |
|--------------|----------|
| Initialize   | 0 admin · 1 this program · 2 config(rw,new) · 3 root(rw,new) · 4 name-service(ro) |
| Register     | 0 user · 1 this program · 2 config(ro) · 3 treasury(rw) · 4 root(rw) · 5 domain(rw,new) · 6 lease(rw,new) · 7 name-service(ro) |
| Renew        | 0 user · 1 this program · 2 config(ro) · 3 treasury(rw) · 4 lease(rw) |
| UpdateConfig | 0 admin · 1 this program · 2 config(rw) |

State accounts (both owned by this program; magic discriminators `TCR1` / `RLS1`):

- **RegistrarConfig** (144 B): `admin[32]`, `treasury[32]`, `fee_per_year u64`,
  `root_address[32]`, `root_name[32]+len u8`, `bump u8`.
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
THRU_SEED="..." node scripts/registrar/deploy-and-init.mjs \
  --root thru --fee 1000 --treasury <OWNER_TREASURY_ADDRESS> \
  --bin contracts/thru-custom-registrar/target/riscv64imac-unknown-none-elf/release/thru-custom-registrar.bin
```

Live-verification happens on the owner host (same machine, `npm run test:live`
pattern); nothing about this program is presented in the wallet UI until that evidence
lands.
