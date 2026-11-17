# thru-custom-registrar

Side-by-side name registrar program for the Thru L1 (ThruVM / RISC-V), operating alongside the official system Name Service program (`taNAMEqRNEDeMWp0cDYmMVdZyTZiF5NyGDR9zTwH42rWQG`) without replacing it. Implements tiered per-year `.thru` subdomain registration and renewal (`D-016`, `D-019`).

> **Current Artifact vs Live Betanet State (Read First)**
>
> | Target | State |
> | --- | --- |
> | **Checked-in `thru-custom-registrar.bin`** | **33,714 bytes**, `sha256 f93c112b…35dd2`. Includes layout-2 tiered pricing (`fee_3_char`, `fee_4_char`, `fee_5plus_char`, `fee_policy`) **and** canonical config PDA enforcement (`ERR_WRONG_CONFIG` = `0xD112`). |
> | **Deployed on Betanet (`ta2vDCBzzptN2qVZgz6PXsCp5cNB7Nef4yeQ3W-OqzZcfF`)** | **2026-10-31** build (**30,000 bytes**): layout-2 config (`ta_9lLvhxurg4J5DyZ82W14rzzGWCEfj9B7Y8wa99amPBa`) updated on-chain to `100,000 / 10,000 / 1,000` base units/yr with `fee_policy = strict` (`1`), **without** the `0xD112` canonical-PDA check (`scripts/defi-evidence/registrar-deploy-betanet-thru-1793443647724.json`). |
> | **Open Verification Gate** | (1) Upgrade Betanet program to the 33,714-byte `.bin`; (2) execute one live `Register` and `Renew` while measuring the treasury balance delta (`collectionProbe.measured` is currently `false`). |

```text
 user (signer, idx 0)
   |  Register{label, years, target}     fee = total_for_term(label_len, years) (u64 checked)
   v
 +----------------------------+  CPI init-root / register-subdomain
 |  thru-custom-registrar     | ------------------------------------> native name-service
 |  (this program)            |    InvokeAuth{config account}         (tag 0 / tag 1)
 +----------------------------+
   | sys_account_transfer(user -> treasury, total_fee) [strict reverts on refusal; best-effort ignores]
   v
 treasury account
```

## Why This Design

The native Name Service program enforces parent authority: `register-subdomain` reverts (user error `3`) unless signed or CPI-authorized by the root's authority. ThruVM's CPI syscall (`INVOKE` + `InvokeAuth`) allows a program-owned config account to authorize subdomain creation:

1. `InitializeV2` (tag `4`) creates the program-owned `RegistrarConfig` PDA (`TCR:config:v1`), stores admin, treasury, 3/4/5+ character annual tiers, `fee_policy`, and root metadata, then CPIs `init-root` with the config account as root authority. (Legacy flat-fee tag `0` `Initialize` is explicitly rejected with `0xD006`.)
2. `Register` (tag `1`) validates label rules and canonical config PDA, writes the `DomainLease` PDA, applies `collect_fee()` according to `fee_policy`, and CPIs `register-subdomain` via `InvokeAuth`.
3. `Renew` (tag `2`) extends an existing lease (`new_expiry = max(now, expires_at) + years * 31,536,000 s`) and collects the tiered renewal fee.
4. `UpdateConfig` (tag `3`, admin only) updates `treasury`, any of the three character-length tiers (`fee_per_year` remains a derived mirror of `fee_5plus_char`), and/or `fee_policy`, resizing a 144-byte layout-1 account to 176-byte layout-2 in place (`sys_account_resize`).

## Pinned Byte Formats (Shared with `src/lib/custom-registrar.js`)

All integers are little-endian. Because `@thru/sdk@0.4.2` byte-sorts `readWrite` and `readOnly` account lists (`normalizeAccountList`), every instruction encodes explicit `u16` account-table indices resolved via `InstructionContext.getAccountIndex` (`test/test-custom-registrar.mjs`).

| Tag | Instruction | Payload |
| ---: | --- | --- |
| `0` | `Initialize` *(superseded)* | Rejected with `0xD006` so stale flat-fee clients cannot miswrite layout-2 slots. |
| `4` | `InitializeV2` | `u16 config_idx`, `u16 root_idx`, `u16 ns_idx`, `u64 fee_3`, `u64 fee_4`, `u64 fee_5plus`, `u8 fee_policy`, `32B treasury`, `u32 root_name_len`, `root_name[32]`, `32B config_seed`, `u32 config_proof_len + proof`, `u32 root_proof_len + proof` |
| `1` | `Register` | `u16 treasury_idx`, `u16 root_idx`, `u16 domain_idx`, `u16 lease_idx`, `u16 config_idx`, `u16 ns_idx`, `u16 target_idx`, `u16 duration_years`, `u32 label_len`, `label[32]`, `32B target_pubkey`, `u32 domain_proof_len + proof`, `u32 lease_proof_len + proof` |
| `2` | `Renew` | `u16 treasury_idx`, `u16 lease_idx`, `u16 config_idx`, `u16 duration_years`, `u32 label_len`, `label[32]` |
| `3` | `UpdateConfig` | `u16 config_idx`, `u8 mask` (`b0 treasury`, `b1 fee_3`, `b2 fee_4`, `b3 fee_5plus`, `b4 fee_policy`), `32B new_treasury`, `u64 new_fee_3`, `u64 new_fee_4`, `u64 new_fee_5plus`, `u8 new_fee_policy` |

### State Accounts (`TCR1` / `RLS1`)

- **`RegistrarConfig`:**
  - **Layout 1 (`144 B`):** `admin[32]`, `treasury[32]`, `fee_per_year u64`, `root_address[32]`, `root_name[32]+len u8`, `bump u8` (parsed as flat tiers + `best-effort` policy).
  - **Layout 2 (`176 B`):** Appends `fee_3_char u64`, `fee_4_char u64`, `fee_5plus_char u64`, `fee_policy u8` at offset `144`.
- **`fee_policy`:** `0` = `best-effort` (attempts transfer, ignores VM refusal; wallet displays `registrar-fee-unenforced` / "no charge reported"); `1` = `strict` (reverts with `0xD206` on refused transfer or `0xD207` on insufficient balance; configured on Betanet as of 2026-10-31, collection delta still unmeasured).
- **`DomainLease` (`120 B`):** `owner[32]`, `resolver[32]`, `expires_at u64`, `registered_at u64`, `label[32]+len u8`.

## Build & Host Unit Tests

Requires stable Rust + `rustup target add riscv64imac-unknown-none-elf` + `cargo-binutils`. First-party Rust SDK crates are vendored in `./vendor` (`../VENDORED.md`).

```bash
cargo build --release --bin thru-custom-registrar
rust-objcopy -O binary \
  target/riscv64imac-unknown-none-elf/release/thru-custom-registrar \
  thru-custom-registrar.bin
cargo test --lib
```

## Deploy, Initialize, and Prove Fee Collection

Run on an RPC-reachable host using `scripts/registrar/deploy-and-init.mjs` (which verifies `admin` and `treasury` ownership after readback and persists `collectionAttested` / `collectionNote`):

```bash
# 1) Initialize or update with best-effort while measuring treasury collection:
THRU_SEED="..." node scripts/registrar/deploy-and-init.mjs \
  --root thru --fee-3 100000 --fee-4 10000 --fee-5plus 1000 \
  --fee-policy best-effort --treasury <OWNER_TREASURY_ADDRESS> \
  --bin contracts/thru-custom-registrar/thru-custom-registrar.bin

# 2) Record pre/post treasury balance across a real Register + Renew (--probe-collection),
#    then enable strict only with verified delta attestation:
THRU_SEED="..." node scripts/registrar/deploy-and-init.mjs \
  --root thru --fee-policy strict \
  --collection-proven "Observed treasury delta after tx <sig>" \
  --bin contracts/thru-custom-registrar/thru-custom-registrar.bin
```

Wallet integration details live in `docs/guides/domains-and-registrar.md`.
