//! Instruction processors for thru-custom-registrar.
//!
//! Convention shared with the client ABI (`src/lib/custom-registrar.js` in
//! thru-wallet-ext — cross-pin the constants if you change either side).
//!
//! The first-party SDK transaction builder lays out the account table as
//! `[feePayer, program, ...readWrite (caller order), ...readOnly (caller order)]`
//! (web/packages/sdk/thru-ts-client-sdk/domain/transactions/utils.ts
//! createInstructionContext, verified against monorepo a058dd8 + our pinned @thru/sdk
//! 0.4.2 package, 2026-10-24): caller order, NOT sorted; index 0 is always the fee
//! payer/signer. All indices below follow that layout: THIS program is index 1 in
//! every flow because the program account always follows the fee payer.
//!
//!   Initialize:    0 admin(signer)  1 THIS program  2 config(rw, new)
//!                  3 root(rw, new)  4 name-service program(ro)
//!   Register:      0 user(signer)   1 THIS program  2 treasury(rw)   3 root(rw)
//!                  4 domain(rw, new) 5 lease(rw, new) 6 config(ro)  7 name-service(ro)
//!   Renew:         0 user(signer)   1 THIS program  2 treasury(rw)  3 lease(rw, exists)
//!                  4 config(ro)
//!   UpdateConfig:  0 admin(signer)  1 THIS program  2 config(rw)
//!
//! The registrar's name-service authority is its OWN config account (program-owned),
//! not a private key: InvokeAuth marks program-owned accounts authorized for the
//! callee (INVOKE syscall 0x0A; callee-side authority check hits
//! is_account_authorized_by_pubkey, and sys-side the auth entries must pass
//! is_account_idx_owned_by_current_program — account_safe.rs). The root's stored
//! authority therefore never needs a human key — only this program (governed by
//! config.admin) can mint subdomains under the root.

#![no_std]

use thru_core::syscall::{sys_emit_event, SyscallCode};
use thru_core::types::shadow_stack::InvokeAuth;
use thru_core::types::state_proof::StateProof;
use thru_core::{get_txn, AccountManager};

use crate::cpi;
use crate::errors as E;
use crate::instruction as ix;
use crate::state::{self, DomainLease, RegistrarConfig};

// ---- shared account indices (per the table above; program == 1 always) ------------
const IDX_INIT_CONFIG: u16 = 2;
const IDX_INIT_ROOT: u16 = 3;
const IDX_INIT_NS: u16 = 4;

const IDX_REG_TREASURY: u16 = 2;
const IDX_REG_ROOT: u16 = 3;
const IDX_REG_DOMAIN: u16 = 4;
const IDX_REG_LEASE: u16 = 5;
const IDX_REG_CONFIG: u16 = 6;
const IDX_REG_NS: u16 = 7;

const IDX_RNW_TREASURY: u16 = 2;
const IDX_RNW_LEASE: u16 = 3;
const IDX_RNW_CONFIG: u16 = 4;

const IDX_UCFG_CONFIG: u16 = 2;

/// One authorized account (the config) in InvokeAuth wire order.
/// Layout == shadow_stack.rs InvokeAuth{magic, auth_cnt, deauth_cnt} + [u16].
#[repr(C, align(8))]
struct InvokeAuthOne {
    magic: u64,
    auth_cnt: u16,
    deauth_cnt: u16,
    auth0: u16,
}

impl InvokeAuthOne {
    fn one(auth_idx: u16) -> Self {
        Self { magic: cpi::INVOKE_AUTH_MAGIC, auth_cnt: 1, deauth_cnt: 0, auth0: auth_idx }
    }

    fn as_ref(&self) -> &InvokeAuth {
        // SAFETY: repr(C, align(8)); field order/width match thru-core's wire image
        // (u64 magic @0, u16 auth_cnt @8, u16 deauth_cnt @10, flexible u16 idxs @12).
        // The reference is only passed to sys_invoke within this frame.
        unsafe { &*(self as *const InvokeAuthOne as *const InvokeAuth) }
    }
}

/// Locate an account by pubkey within the shared transaction account table.
/// Returns None when the client forgot to include the account at all.
fn find_account_idx(pubkey: &[u8; 32]) -> Option<u16> {
    let txn = get_txn();
    let n = txn.accounts_cnt();
    for i in 0..n {
        if let Ok(pk) = txn.account_pubkey(i) {
            if &pk.0 == pubkey {
                return Some(i);
            }
        }
    }
    None
}

#[inline]
fn map_sys(code: SyscallCode, err: u64) -> Result<(), u64> {
    match code {
        SyscallCode::Success | SyscallCode::SuccessExit => Ok(()),
        _ => Err(err),
    }
}

/// Verify an account slot currently has no program-state data ("not registered").
/// New (not yet created on-chain) accounts appear in the table with zero-size data.
fn assert_empty<const N: usize>(
    mgr: &AccountManager<N>,
    idx: u16,
    err: u64,
) -> Result<(), u64> {
    let acc = mgr.get_readonly(idx).map_err(|_| E::ERR_MISSING_ACCOUNTS)?;
    if acc.data_size() > 0 {
        return Err(err);
    }
    Ok(())
}

fn now_epoch_seconds() -> u64 {
    // get_block_ctx().block_time is a Unix NANOSECOND timestamp (block_ctx.rs, verified
    // in the first-party SDK on 2026-10-24) — leases are epoch-SECONDS values.
    thru_core::mem::get_block_ctx().block_time / 1_000_000_000
}

// ----------------------------------------------------------------------------------
// Initialize { fee_per_year, treasury, root_name, config_seed, config_proof, root_proof }
// ----------------------------------------------------------------------------------
pub fn initialize<const N: usize>(
    mgr: &AccountManager<N>,
    ix: &ix::InitializeIx<'_>,
) -> Result<u64, u64> {
    // CHECKS
    if ix.root_name.is_empty() || ix.root_name.len() > ix::ROOT_NAME_BUF {
        return Err(ix::ERR_NAME_TOO_LONG);
    }
    let txn = get_txn();
    let admin_pk = txn.account_pubkey(0).map_err(|_| E::ERR_MISSING_ACCOUNTS)?.0;
    let root_pk = txn.account_pubkey(IDX_INIT_ROOT).map_err(|_| E::ERR_MISSING_ACCOUNTS)?.0;

    // Config must be virgin — double-Initialize would silently swap authority.
    {
        let cfg = mgr.get_readonly(IDX_INIT_CONFIG).map_err(|_| E::ERR_MISSING_ACCOUNTS)?;
        if cfg.data_size() > 0 {
            return Err(E::ERR_ALREADY_INITIALIZED);
        }
    }

    let cfg_proof = StateProof::parse_proof(ix.config_proof).map_err(|_| E::ERR_PROOF_PARSE)?;

    // EFFECTS 1/2 — create the config account (it becomes program-owned; that ownership
    // is exactly what later lets InvokeAuth authorize it as the root's authority). The
    // borrow scope must close before ANY further syscall (invoke() panics with live
    // borrows — account_safe.rs).
    {
        let mut config_ref = mgr
            .create_and_init(IDX_INIT_CONFIG, &ix.config_seed, &cfg_proof, state::CONFIG_SIZE as u64)
            .map_err(|_| E::ERR_CREATE_CONFIG)?;
        let data = config_ref.data_mut().ok_or(E::ERR_CONFIG_PARSE)?;
        let mut root_name = [0u8; ix::ROOT_NAME_BUF];
        root_name[..ix.root_name.len()].copy_from_slice(ix.root_name);
        let record = RegistrarConfig {
            admin: admin_pk,
            treasury: ix.treasury,
            fee_per_year: ix.fee_per_year,
            root_address: root_pk,
            root_name,
            root_name_len: ix.root_name.len() as u8,
            bump: 0,
        };
        data[..state::CONFIG_SIZE].copy_from_slice(&record.serialize());
    }

    // INTERACTIONS — CPI the native name-service to create the root with the config
    // account as its authority: authority_account_idx = IDX_INIT_CONFIG, InvokeAuth
    // marks it (program-owned by construction above).
    let mut cpi_buf = [0u8; cpi::NS_IX_MAX];
    let cpi_len = cpi::encode_init_root(
        &mut cpi_buf,
        IDX_INIT_ROOT,
        IDX_INIT_CONFIG,
        ix.root_name,
        ix.root_proof,
    )?;
    let auth = InvokeAuthOne::one(IDX_INIT_CONFIG);
    let (res_code, callee_exit) =
        mgr.invoke(IDX_INIT_NS, &cpi_buf[..cpi_len], Some(auth.as_ref()));
    map_sys(res_code, E::ERR_CPI_INIT_ROOT)?;
    map_sys(callee_exit, E::ERR_CPI_INIT_ROOT)?;

    // Observability: "TCR:I:<root_name>" event.
    let mut ev = [0u8; 8 + ix::ROOT_NAME_BUF];
    ev[..6].copy_from_slice(b"TCR:I:");
    ev[6..6 + ix.root_name.len()].copy_from_slice(ix.root_name);
    unsafe { sys_emit_event(ev.as_ptr(), (6 + ix.root_name.len()) as u64) };
    Ok(0)
}

// ----------------------------------------------------------------------------------
// Register { label, duration_years, target, domain_proof, lease_proof }
// ----------------------------------------------------------------------------------
pub fn register<const N: usize>(
    mgr: &AccountManager<N>,
    ix: &ix::RegisterIx<'_>,
) -> Result<u64, u64> {
    // CHECKS
    ix::validate_label(ix.label)?;
    ix::validate_duration(ix.duration_years)?;

    let cfg = {
        let acc = mgr.get_readonly(IDX_REG_CONFIG).map_err(|_| E::ERR_MISSING_ACCOUNTS)?;
        RegistrarConfig::parse(acc.data())?
    }; // borrow ends

    let txn = get_txn();
    // Account-table identity checks — a spoofed treasury/root must fail CHECKS, not CPI.
    let treasury_pk =
        txn.account_pubkey(IDX_REG_TREASURY).map_err(|_| E::ERR_MISSING_ACCOUNTS)?.0;
    if treasury_pk != cfg.treasury {
        return Err(E::ERR_WRONG_TREASURY);
    }
    let root_pk = txn.account_pubkey(IDX_REG_ROOT).map_err(|_| E::ERR_MISSING_ACCOUNTS)?.0;
    if root_pk != cfg.root_address {
        return Err(E::ERR_WRONG_ROOT);
    }
    // Domain + lease must be virgin slots (the "checks" half of double-registration).
    assert_empty(mgr, IDX_REG_DOMAIN, E::ERR_NAME_TAKEN)?;
    assert_empty(mgr, IDX_REG_LEASE, E::ERR_NAME_TAKEN)?;
    // The domain owner must be present in the table (the native program keys owners
    // by account index).
    let owner_idx = find_account_idx(&ix.target).ok_or(E::ERR_TARGET_NOT_IN_TX)?;

    // Overflow-checked fee (zero-float; if fee×years can't fit u64 we refuse silently
    // NOTHING — we revert with a named code).
    let total_fee = cfg
        .fee_per_year
        .checked_mul(ix.duration_years as u64)
        .ok_or(E::ERR_FEE_OVERFLOW)?;
    let term_secs = state::YEAR_SECONDS
        .checked_mul(ix.duration_years as u64)
        .ok_or(E::ERR_FEE_OVERFLOW)?;
    let now_secs = now_epoch_seconds();

    let lease_proof = StateProof::parse_proof(ix.lease_proof).map_err(|_| E::ERR_PROOF_PARSE)?;
    let lease_seed = state::lease_seed(ix.label);

    // EFFECTS — create + fill the lease BEFORE any external interaction (strict CEI).
    {
        let mut lease_acc = mgr
            .create_and_init(IDX_REG_LEASE, &lease_seed, &lease_proof, state::LEASE_SIZE as u64)
            .map_err(|_| E::ERR_CREATE_LEASE)?;
        let data = lease_acc.data_mut().ok_or(E::ERR_LEASE_PARSE)?;
        let mut label_buf = [0u8; ix::LABEL_BUF];
        label_buf[..ix.label.len()].copy_from_slice(ix.label);
        let lease = DomainLease {
            owner: ix.target,
            resolver: ix.target,
            expires_at: now_secs.saturating_add(term_secs),
            registered_at: now_secs,
            label: label_buf,
            label_len: ix.label.len() as u8,
        };
        data[..state::LEASE_SIZE].copy_from_slice(&lease.serialize());
    }

    // INTERACTIONS 1/2 — collect the fee: user (idx 0, signer) → treasury.
    map_sys(mgr.account_transfer(0, IDX_REG_TREASURY, total_fee), E::ERR_TRANSFER)?;

    // INTERACTIONS 2/2 — CPI into native name-service; authority = our config account.
    let mut cpi_buf = [0u8; cpi::NS_IX_MAX];
    let cpi_len = cpi::encode_register_subdomain(
        &mut cpi_buf,
        IDX_REG_DOMAIN,
        IDX_REG_ROOT,
        owner_idx,
        IDX_REG_CONFIG,
        ix.label,
        ix.domain_proof,
    )?;
    let auth = InvokeAuthOne::one(IDX_REG_CONFIG);
    let (res_code, callee_exit) = mgr.invoke(IDX_REG_NS, &cpi_buf[..cpi_len], Some(auth.as_ref()));
    map_sys(res_code, E::ERR_CPI_REGISTER)?;
    map_sys(callee_exit, E::ERR_CPI_REGISTER)?;

    // Event: "TCR:R:<label>".
    let mut ev = [0u8; 8 + ix::LABEL_BUF];
    ev[..6].copy_from_slice(b"TCR:R:");
    ev[6..6 + ix.label.len()].copy_from_slice(ix.label);
    unsafe { sys_emit_event(ev.as_ptr(), (6 + ix.label.len()) as u64) };
    Ok(0)
}

// ----------------------------------------------------------------------------------
// Renew { label, duration_years }
// ----------------------------------------------------------------------------------
pub fn renew<const N: usize>(
    mgr: &AccountManager<N>,
    ix: &ix::RenewIx<'_>,
) -> Result<u64, u64> {
    ix::validate_label(ix.label)?;
    ix::validate_duration(ix.duration_years)?;

    let cfg = {
        let acc = mgr.get_readonly(IDX_RNW_CONFIG).map_err(|_| E::ERR_MISSING_ACCOUNTS)?;
        RegistrarConfig::parse(acc.data())?
    };
    let txn = get_txn();
    if txn.account_pubkey(IDX_RNW_TREASURY).map_err(|_| E::ERR_MISSING_ACCOUNTS)?.0 != cfg.treasury
    {
        return Err(E::ERR_WRONG_TREASURY);
    }
    // Lease must exist, be program-owned, and carry the same label.
    let mut lease = {
        let acc = mgr.get_readonly(IDX_RNW_LEASE).map_err(|_| E::ERR_NO_LEASE)?;
        if !acc.is_owned_by_current_program() {
            return Err(E::ERR_NOT_OWNED_BY_PROGRAM);
        }
        DomainLease::parse(acc.data())?
    };
    if &lease.label[..lease.label_len as usize] != ix.label {
        return Err(E::ERR_LEASE_LABEL_MISMATCH);
    }

    // Rolling-extension semantics: never shorten an unexpired lease.
    let now_secs = now_epoch_seconds();
    let base = lease.expires_at.max(now_secs);
    lease.expires_at = base
        .checked_add(
            state::YEAR_SECONDS
                .checked_mul(ix.duration_years as u64)
                .ok_or(E::ERR_FEE_OVERFLOW)?,
        )
        .ok_or(E::ERR_FEE_OVERFLOW)?;

    // EFFECTS
    if mgr.set_account_data_writable(IDX_RNW_LEASE) != SyscallCode::Success {
        return Err(E::ERR_LEASE_PARSE);
    }
    {
        let mut acc = mgr.get(IDX_RNW_LEASE).map_err(|_| E::ERR_LEASE_PARSE)?;
        let data = acc.data_mut().ok_or(E::ERR_LEASE_PARSE)?;
        data[..state::LEASE_SIZE].copy_from_slice(&lease.serialize());
    }

    // INTERACTIONS — fee (renewal policy: no CPI into name-service; the on-chain domain
    // registration persists, our lease layer owns expiry bookkeeping).
    let total_fee = cfg
        .fee_per_year
        .checked_mul(ix.duration_years as u64)
        .ok_or(E::ERR_FEE_OVERFLOW)?;
    map_sys(mgr.account_transfer(0, IDX_RNW_TREASURY, total_fee), E::ERR_TRANSFER)?;

    let mut ev = [0u8; 8 + ix::LABEL_BUF];
    ev[..6].copy_from_slice(b"TCR:N:");
    ev[6..6 + ix.label.len()].copy_from_slice(ix.label);
    unsafe { sys_emit_event(ev.as_ptr(), (6 + ix.label.len()) as u64) };
    Ok(0)
}

// ----------------------------------------------------------------------------------
// UpdateConfig { new_fee?, new_treasury? } — admin keyed; config.admin == acct 0.
// ----------------------------------------------------------------------------------
pub fn update_config<const N: usize>(
    mgr: &AccountManager<N>,
    ix: &ix::UpdateConfigIx,
) -> Result<u64, u64> {
    let txn = get_txn();
    let caller = txn.account_pubkey(0).map_err(|_| E::ERR_MISSING_ACCOUNTS)?.0;

    // CHECKS (incl. admin) BEFORE any writability flip.
    let mut cfg = {
        let acc = mgr.get_readonly(IDX_UCFG_CONFIG).map_err(|_| E::ERR_MISSING_ACCOUNTS)?;
        RegistrarConfig::parse(acc.data())?
    };
    if caller != cfg.admin {
        return Err(E::ERR_NOT_ADMIN);
    }
    if let Some(f) = ix.new_fee {
        cfg.fee_per_year = f;
    }
    if let Some(t) = ix.new_treasury {
        cfg.treasury = t;
    }

    // EFFECTS
    if mgr.set_account_data_writable(IDX_UCFG_CONFIG) != SyscallCode::Success {
        return Err(E::ERR_CONFIG_PARSE);
    }
    {
        let mut acc = mgr.get(IDX_UCFG_CONFIG).map_err(|_| E::ERR_CONFIG_PARSE)?;
        let data = acc.data_mut().ok_or(E::ERR_CONFIG_PARSE)?;
        data[..state::CONFIG_SIZE].copy_from_slice(&cfg.serialize());
    }
    let ev: &[u8] = b"TCR:C";
    unsafe { sys_emit_event(ev.as_ptr(), ev.len() as u64) };
    Ok(0)
}
