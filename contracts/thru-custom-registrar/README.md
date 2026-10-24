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
| 0   | Initialize   | `u16 config_idx`, `u16 root_idx`, `u16 ns_idx`; `u64 fee_per_year`, `32 treasury`, `u32 root_name_len`, `root_name[32]` (zero-padded), `32 config_seed`, `u32 config_proof_len + proof`, `u32 root_proof_len + proof` (admin == fee payer idx 0) |
| 1   | Register     | `u16 treasury_idx`, `u16 root_idx`, `u16 domain_idx`, `u16 lease_idx`, `u16 config_idx`, `u16 ns_idx`, `u16 target_idx` (may be 0 when the fee payer self-registers); `u16 duration_years`, `u32 label_len`, `label[32]`, `32 target_pubkey` (must equal accounts[target_idx].pubkey), `u32 domain_proof_len + proof`, `u32 lease_proof_len + proof` |
| 2   | Renew        | `u16 treasury_idx`, `u16 lease_idx`, `u16 config_idx`; `u16 duration_years`, `u32 label_len`, `label[32]` |
| 3   | UpdateConfig | `u16 config_idx`; `u8 mask` (bit0 fee, bit1 treasury), `u64 new_fee`, `32 new_treasury` |

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
