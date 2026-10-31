//! Instruction decoding for thru-custom-registrar.
//!
//! Wire formats are fixed and pinned byte-for-byte by the JavaScript client ABI in
//! `src/lib/custom-registrar.js` of the thru-wallet-ext repo (test vectors in
//! `test/test-custom-registrar.mjs`). Every multi-byte field is little-endian.
//!
//! ABI v2 (2026-10-24): account positions are carried IN THE DATA as u16 indices into
//! the shared transaction account table, resolved client-side by the SDK's own
//! `getAccountIndex` at build time. This matches the first-party convention
//! (`build_name_service_*_instruction` in rpc/thru-base/src/txn_tools.rs) and is the
//! only honest choice because @thru/sdk 0.4.2 byte-SORTS the readWrite / readOnly
//! lists before serializing (dist chunk normalizeAccountList → dedupeAccountList ends
//! with .sort(compareAccounts)); the VM-visible order is therefore
//! `[feePayer, program, sorted-readWrite, sorted-readOnly]` with byte-lex order, and
//! fixed positional constants would silently address the wrong accounts.
//!
//! Instruction header: `tag: u32` (little-endian), then this program's u16 account
//! indices, then the semantic args.
//!
//!   tag 0 | Initialize (SUPERSEDED — rejects with ERR_TAG_SUPERSEDED)
//!     The old flat-fee layout. Kept only as a named refusal so an out-of-date deploy
//!     client fails loudly instead of installing a config the new program cannot price.
//!   tag 4 | InitializeV2
//!     [u16 config_idx][u16 root_idx][u16 ns_idx]   (admin == fee payer == idx 0)
//!     [u64 fee_3_char][u64 fee_4_char][u64 fee_5plus_char][u8 fee_policy]
//!     [32 treasury][u32 root_name_len | 1..=32][root_name bytes padded to 32]
//!     [32 config_seed][u32 config_proof_len][config_proof][u32 root_proof_len][root_proof]
//!   tag 1 | Register
//!     [u16 treasury_idx][u16 root_idx][u16 domain_idx][u16 lease_idx][u16 config_idx]
//!     [u16 ns_idx][u16 target_idx]
//!     [u16 duration_years][u32 label_len | 3..=32][label bytes padded to 32]
//!     [32 target_pubkey][u32 domain_proof_len][domain_proof][u32 lease_proof_len][lease_proof]
//!     target_pubkey must equal the account at target_idx (owner goes into the lease
//!     AND the name-service CPI; the double-entry is the cross-check).
//!   tag 2 | Renew
//!     [u16 treasury_idx][u16 lease_idx][u16 config_idx]
//!     [u16 duration_years][u32 label_len | 3..=32][label bytes padded to 32]
//!   tag 3 | UpdateConfig
//!     [u16 config_idx][u8 mask][32 new_treasury][u64 new_fee_3][u64 new_fee_4]
//!     [u64 new_fee_5plus][u8 new_fee_policy]
//!     mask bit0 = apply new_treasury, bit1 = fee_3, bit2 = fee_4, bit3 = fee_5plus,
//!     bit4 = fee_policy. The legacy `fee_per_year` is no longer settable: it is a
//!     derived mirror of fee_5plus, so an admin cannot make the two disagree.
//!
//! This module is pure byte layout — no syscalls — so `cargo test` exercises it on the
//! host target too.

#![allow(clippy::missing_errors_doc)]

/// The flat-fee Initialize. No longer parsed; see ERR_TAG_SUPERSEDED.
pub const TAG_INITIALIZE: u32 = 0;
pub const TAG_REGISTER: u32 = 1;
pub const TAG_RENEW: u32 = 2;
pub const TAG_UPDATE_CONFIG: u32 = 3;
/// Tiered Initialize. A NEW tag, not a longer tag 0: an out-of-date deploy script then
/// gets a named error instead of having its `fee_per_year` read as `fee_3_char`.
pub const TAG_INITIALIZE_V2: u32 = 4;

/// `fee_policy` values (config byte 168).
/// 0 — BEST EFFORT: the charge is attempted and a refusal is ignored. This is what the
///     deployed program did; a layout-1 config reads as this.
/// 1 — STRICT: a refused charge reverts the whole instruction. Only correct once a live
///     probe has shown the transfer can succeed on this VM (see DEPLOY notes in README).
pub const FEE_POLICY_BEST_EFFORT: u8 = 0;
pub const FEE_POLICY_STRICT: u8 = 1;

/// Label policy: 3..=32 chars of [a-z0-9-], no leading/trailing hyphen.
/// (32, not the name-service's 64: the lease account seed is one 32-byte value and
/// labels must embed in it verbatim — the seed IS the label, zero-padded.)
pub const MIN_LABEL_LEN: usize = 3;
pub const MAX_LABEL_LEN: usize = 32;
/// Lease label buffer: exactly one seed slot.
pub const LABEL_BUF: usize = 32;
/// Root names share the same buffer policy.
pub const ROOT_NAME_BUF: usize = 32;
/// A single lease may not exceed this duration; mirrors the wallet UI stepper ceiling
/// and keeps fee multiplication below any realistic overflow surface.
pub const MAX_DURATION_YEARS: u16 = 10;

pub const ERR_TRUNCATED: u64 = 0xD001;
pub const ERR_UNKNOWN_TAG: u64 = 0xD002;
pub const ERR_NAME_TOO_LONG: u64 = 0xD003;
pub const ERR_PROOF_TOO_LONG: u64 = 0xD004;
/// Account-index hygiene: reserved slots (0 fee payer, 1 this program) used for a
/// non-reserved role, or one index reused across roles where the semantics differ.
pub const ERR_BAD_ACCOUNT_INDEX: u64 = 0xD005;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InitializeIx<'a> {
    pub config_idx: u16,
    pub root_idx: u16,
    pub ns_idx: u16,
    pub fee_3_char: u64,
    pub fee_4_char: u64,
    pub fee_5plus_char: u64,
    pub fee_policy: u8,
    pub treasury: [u8; 32],
    pub root_name: &'a [u8],
    pub config_seed: [u8; 32],
    pub config_proof: &'a [u8],
    pub root_proof: &'a [u8],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RegisterIx<'a> {
    pub treasury_idx: u16,
    pub root_idx: u16,
    pub domain_idx: u16,
    pub lease_idx: u16,
    pub config_idx: u16,
    pub ns_idx: u16,
    pub target_idx: u16,
    pub duration_years: u16,
    pub label: &'a [u8],
    pub target: [u8; 32],
    pub domain_proof: &'a [u8],
    pub lease_proof: &'a [u8],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RenewIx<'a> {
    pub treasury_idx: u16,
    pub lease_idx: u16,
    pub config_idx: u16,
    pub duration_years: u16,
    pub label: &'a [u8],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdateConfigIx {
    pub config_idx: u16,
    pub new_treasury: Option<[u8; 32]>,
    pub new_fee_3_char: Option<u64>,
    pub new_fee_4_char: Option<u64>,
    pub new_fee_5plus_char: Option<u64>,
    pub new_fee_policy: Option<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Ix<'a> {
    Initialize(InitializeIx<'a>),
    Register(RegisterIx<'a>),
    Renew(RenewIx<'a>),
    UpdateConfig(UpdateConfigIx),
}

#[inline]
fn take<'a>(data: &mut &'a [u8], n: usize) -> Result<&'a [u8], u64> {
    if data.len() < n {
        return Err(ERR_TRUNCATED);
    }
    let (head, tail) = data.split_at(n);
    *data = tail;
    Ok(head)
}

#[inline]
fn take_u8(data: &mut &[u8]) -> Result<u8, u64> {
    Ok(take(data, 1)?[0])
}

#[inline]
fn take_u16(data: &mut &[u8]) -> Result<u16, u64> {
    Ok(u16::from_le_bytes(take(data, 2)?.try_into().map_err(|_| ERR_TRUNCATED)?))
}

#[inline]
fn take_u32(data: &mut &[u8]) -> Result<u32, u64> {
    Ok(u32::from_le_bytes(take(data, 4)?.try_into().map_err(|_| ERR_TRUNCATED)?))
}

#[inline]
fn take_u64(data: &mut &[u8]) -> Result<u64, u64> {
    Ok(u64::from_le_bytes(take(data, 8)?.try_into().map_err(|_| ERR_TRUNCATED)?))
}

#[inline]
fn take_pubkey(data: &mut &[u8]) -> Result<[u8; 32], u64> {
    Ok(take(data, 32)?.try_into().map_err(|_| ERR_TRUNCATED)?)
}

/// Read a `[u8; N]` zero-padded name buffer plus its length prefix; returns the trimmed
/// view. N bounds the on-wire buffer, len bounds the real bytes (len <= N enforced).
fn take_padded_name<'a>(data: &mut &'a [u8], buf: usize, err: u64) -> Result<&'a [u8], u64> {
    let len = take_u32(data)? as usize;
    let raw = take(data, buf)?;
    if len > buf {
        return Err(err);
    }
    Ok(&raw[..len])
}

/// Length-prefixed trailing bytes (known-size section; strict cap to keep the input
/// bounded — name-service creation proofs are a few hundred bytes today, 2026-10-24).
fn take_proof<'a>(data: &mut &'a [u8]) -> Result<&'a [u8], u64> {
    let len = take_u32(data)? as usize;
    if len > 2048 {
        return Err(ERR_PROOF_TOO_LONG);
    }
    take(data, len)
}

/// Index hygiene shared by every instruction: role indices must escape the two
/// RESERVED slots (0 = fee payer, 1 = this program). `allow0` marks roles that may
/// legitimately address the fee payer (e.g. Register's target owner).
#[inline]
fn check_idx(idx: u16, allow0: bool) -> Result<(), u64> {
    if idx <= 1 && !(allow0 && idx == 0) {
        return Err(ERR_BAD_ACCOUNT_INDEX);
    }
    Ok(())
}

pub fn initialize_idxs_ok(i: &InitializeIx<'_>) -> Result<(), u64> {
    check_idx(i.config_idx, false)?;
    check_idx(i.root_idx, false)?;
    check_idx(i.ns_idx, false)?;
    if i.config_idx == i.root_idx || i.config_idx == i.ns_idx || i.root_idx == i.ns_idx {
        return Err(ERR_BAD_ACCOUNT_INDEX);
    }
    Ok(())
}

pub fn register_idxs_ok(i: &RegisterIx<'_>) -> Result<(), u64> {
    // target MAY equal the fee payer (0) — the common self-register case.
    check_idx(i.target_idx, true)?;
    for idx in [i.treasury_idx, i.root_idx, i.domain_idx, i.lease_idx, i.config_idx, i.ns_idx] {
        check_idx(idx, false)?;
    }
    // The six chain-touching roles must be distinct (target is free-form — it may also
    // collide with treasury legally; the name-service only needs its pubkey present).
    let six = [i.treasury_idx, i.root_idx, i.domain_idx, i.lease_idx, i.config_idx, i.ns_idx];
    for a in 0..six.len() {
        for b in (a + 1)..six.len() {
            if six[a] == six[b] {
                return Err(ERR_BAD_ACCOUNT_INDEX);
            }
        }
    }
    Ok(())
}

pub fn renew_idxs_ok(i: &RenewIx<'_>) -> Result<(), u64> {
    check_idx(i.treasury_idx, false)?;
    check_idx(i.lease_idx, false)?;
    check_idx(i.config_idx, false)?;
    if i.treasury_idx == i.lease_idx || i.treasury_idx == i.config_idx || i.lease_idx == i.config_idx {
        return Err(ERR_BAD_ACCOUNT_INDEX);
    }
    Ok(())
}

pub fn update_config_idxs_ok(i: &UpdateConfigIx) -> Result<(), u64> {
    check_idx(i.config_idx, false)
}

/// Parse one full instruction buffer. Trailing bytes after the parsed structure are
/// rejected — an upgrade must bump the tag or the crate version, never smuggle bytes.
pub fn parse(data: &[u8]) -> Result<Ix<'_>, u64> {
    let mut rest = data;
    let tag = take_u32(&mut rest)?;
    let ix = match tag {
        // A flat-fee Initialize cannot express a tiered schedule, and its first u64 would be
        // read as fee_3_char if we simply extended the tag. Refuse by name.
        TAG_INITIALIZE => return Err(crate::errors::ERR_TAG_SUPERSEDED),
        TAG_INITIALIZE_V2 => Ix::Initialize(InitializeIx {
            config_idx: take_u16(&mut rest)?,
            root_idx: take_u16(&mut rest)?,
            ns_idx: take_u16(&mut rest)?,
            fee_3_char: take_u64(&mut rest)?,
            fee_4_char: take_u64(&mut rest)?,
            fee_5plus_char: take_u64(&mut rest)?,
            fee_policy: take_u8(&mut rest)?,
            treasury: take_pubkey(&mut rest)?,
            root_name: take_padded_name(&mut rest, ROOT_NAME_BUF, ERR_NAME_TOO_LONG)?,
            config_seed: take_pubkey(&mut rest)?,
            config_proof: take_proof(&mut rest)?,
            root_proof: take_proof(&mut rest)?,
        }),
        TAG_REGISTER => Ix::Register(RegisterIx {
            treasury_idx: take_u16(&mut rest)?,
            root_idx: take_u16(&mut rest)?,
            domain_idx: take_u16(&mut rest)?,
            lease_idx: take_u16(&mut rest)?,
            config_idx: take_u16(&mut rest)?,
            ns_idx: take_u16(&mut rest)?,
            target_idx: take_u16(&mut rest)?,
            duration_years: take_u16(&mut rest)?,
            label: take_padded_name(&mut rest, LABEL_BUF, ERR_NAME_TOO_LONG)?,
            target: take_pubkey(&mut rest)?,
            domain_proof: take_proof(&mut rest)?,
            lease_proof: take_proof(&mut rest)?,
        }),
        TAG_RENEW => Ix::Renew(RenewIx {
            treasury_idx: take_u16(&mut rest)?,
            lease_idx: take_u16(&mut rest)?,
            config_idx: take_u16(&mut rest)?,
            duration_years: take_u16(&mut rest)?,
            label: take_padded_name(&mut rest, LABEL_BUF, ERR_NAME_TOO_LONG)?,
        }),
        TAG_UPDATE_CONFIG => {
            let config_idx = take_u16(&mut rest)?;
            let mask = take_u8(&mut rest)?;
            let new_treasury_raw = take_pubkey(&mut rest)?;
            let fee_3_raw = take_u64(&mut rest)?;
            let fee_4_raw = take_u64(&mut rest)?;
            let fee_5plus_raw = take_u64(&mut rest)?;
            let policy_raw = take_u8(&mut rest)?;
            if mask & 0x10 != 0 {
                validate_fee_policy(policy_raw)?;
            }
            Ix::UpdateConfig(UpdateConfigIx {
                config_idx,
                new_treasury: if mask & 0x01 != 0 { Some(new_treasury_raw) } else { None },
                new_fee_3_char: if mask & 0x02 != 0 { Some(fee_3_raw) } else { None },
                new_fee_4_char: if mask & 0x04 != 0 { Some(fee_4_raw) } else { None },
                new_fee_5plus_char: if mask & 0x08 != 0 { Some(fee_5plus_raw) } else { None },
                new_fee_policy: if mask & 0x10 != 0 { Some(policy_raw) } else { None },
            })
        }
        _ => return Err(ERR_UNKNOWN_TAG),
    };
    if !rest.is_empty() {
        return Err(ERR_TRUNCATED);
    }
    Ok(ix)
}

/// Label policy shared by Register and Renew path validation. Returns the same error
/// codes the processor surfaces (host tests pin this table against the JS twin).
pub fn validate_label(label: &[u8]) -> Result<(), u64> {
    if label.len() < MIN_LABEL_LEN || label.len() > MAX_LABEL_LEN {
        return Err(crate::errors::ERR_BAD_LABEL);
    }
    if !label.iter().all(|b| matches!(b, b'a'..=b'z' | b'0'..=b'9' | b'-')) {
        return Err(crate::errors::ERR_BAD_LABEL);
    }
    if label.first() == Some(&b'-') || label.last() == Some(&b'-') {
        return Err(crate::errors::ERR_BAD_LABEL);
    }
    Ok(())
}

/// fee_policy must be one of the two known values. An unknown policy is refused at parse
/// time rather than defaulted, because "silently treat it as best effort" is how a
/// contract ends up not charging when it was configured to charge.
pub fn validate_fee_policy(policy: u8) -> Result<(), u64> {
    if policy == FEE_POLICY_BEST_EFFORT || policy == FEE_POLICY_STRICT {
        return Ok(());
    }
    Err(crate::errors::ERR_BAD_FEE_POLICY)
}

/// duration_years policy: 1..=MAX_DURATION_YEARS.
pub fn validate_duration(years: u16) -> Result<(), u64> {
    if years == 0 || years > MAX_DURATION_YEARS {
        return Err(crate::errors::ERR_BAD_DURATION);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn legend_initialize() -> Vec<u8> {
        // Hand-assembled per the header comment; JS twin vectors pin the same bytes.
        let mut v = Vec::new();
        v.extend_from_slice(&TAG_INITIALIZE_V2.to_le_bytes());
        v.extend_from_slice(&2u16.to_le_bytes()); // config_idx
        v.extend_from_slice(&3u16.to_le_bytes()); // root_idx
        v.extend_from_slice(&4u16.to_le_bytes()); // ns_idx
        v.extend_from_slice(&100_000u64.to_le_bytes()); // fee_3_char
        v.extend_from_slice(&10_000u64.to_le_bytes()); // fee_4_char
        v.extend_from_slice(&1_000u64.to_le_bytes()); // fee_5plus_char
        v.push(FEE_POLICY_STRICT);
        v.extend_from_slice(&[0xAA; 32]); // treasury
        v.extend_from_slice(&4u32.to_le_bytes()); // root_name_len
        let mut name = [0u8; ROOT_NAME_BUF];
        name[..4].copy_from_slice(b"thru");
        v.extend_from_slice(&name);
        v.extend_from_slice(&[0x07; 32]); // config_seed
        v.extend_from_slice(&3u32.to_le_bytes()); // config_proof_len
        v.extend_from_slice(&[1, 2, 3]);
        v.extend_from_slice(&4u32.to_le_bytes()); // root_proof_len
        v.extend_from_slice(&[9, 8, 7, 6]);
        v
    }

    #[test]
    fn parse_initialize_roundtrip() {
        let buf = legend_initialize();
        match parse(&buf).unwrap() {
            Ix::Initialize(ix) => {
                assert_eq!(ix.config_idx, 2);
                assert_eq!(ix.root_idx, 3);
                assert_eq!(ix.ns_idx, 4);
                assert_eq!(ix.fee_3_char, 100_000);
                assert_eq!(ix.fee_4_char, 10_000);
                assert_eq!(ix.fee_5plus_char, 1_000);
                assert_eq!(ix.fee_policy, FEE_POLICY_STRICT);
                assert_eq!(ix.treasury, [0xAA; 32]);
                assert_eq!(ix.root_name, b"thru");
                assert_eq!(ix.config_seed, [0x07; 32]);
                assert_eq!(ix.config_proof, &[1, 2, 3]);
                assert_eq!(ix.root_proof, &[9, 8, 7, 6]);
                assert!(initialize_idxs_ok(&ix).is_ok());
            }
            _ => panic!("wrong variant"),
        }
    }

    /// The old flat-fee tag must fail BY NAME. If it were parsed with the new layout its
    /// `fee_per_year` would silently become `fee_3_char`.
    #[test]
    fn flat_fee_initialize_tag_is_superseded() {
        let mut v = Vec::new();
        v.extend_from_slice(&TAG_INITIALIZE.to_le_bytes());
        v.extend_from_slice(&[0u8; 64]);
        assert_eq!(parse(&v), Err(crate::errors::ERR_TAG_SUPERSEDED));
    }

    #[test]
    fn unknown_fee_policy_cannot_be_initialised() {
        let mut buf = legend_initialize();
        // policy byte sits right after the three u64 tiers: 4 + 6 + 24 = 34
        buf[34] = 9;
        assert_eq!(parse(&buf), Err(crate::errors::ERR_BAD_FEE_POLICY));
        assert_eq!(validate_fee_policy(9), Err(crate::errors::ERR_BAD_FEE_POLICY));
        assert!(validate_fee_policy(FEE_POLICY_STRICT).is_ok());
        assert!(validate_fee_policy(FEE_POLICY_BEST_EFFORT).is_ok());
    }

    #[test]
    fn update_config_selects_only_masked_tiers() {
        let mut v = Vec::new();
        v.extend_from_slice(&TAG_UPDATE_CONFIG.to_le_bytes());
        v.extend_from_slice(&2u16.to_le_bytes()); // config_idx
        v.push(0x02 | 0x10); // fee_3 + policy
        v.extend_from_slice(&[0xBB; 32]); // treasury (ignored: bit0 clear)
        v.extend_from_slice(&7u64.to_le_bytes()); // fee_3
        v.extend_from_slice(&8u64.to_le_bytes()); // fee_4 (ignored)
        v.extend_from_slice(&9u64.to_le_bytes()); // fee_5plus (ignored)
        v.push(FEE_POLICY_BEST_EFFORT);
        match parse(&v).unwrap() {
            Ix::UpdateConfig(ix) => {
                assert_eq!(ix.new_fee_3_char, Some(7));
                assert_eq!(ix.new_fee_4_char, None);
                assert_eq!(ix.new_fee_5plus_char, None);
                assert_eq!(ix.new_treasury, None);
                assert_eq!(ix.new_fee_policy, Some(FEE_POLICY_BEST_EFFORT));
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn update_config_rejects_an_unknown_policy() {
        let mut v = Vec::new();
        v.extend_from_slice(&TAG_UPDATE_CONFIG.to_le_bytes());
        v.extend_from_slice(&2u16.to_le_bytes());
        v.push(0x10);
        v.extend_from_slice(&[0u8; 32]);
        v.extend_from_slice(&0u64.to_le_bytes());
        v.extend_from_slice(&0u64.to_le_bytes());
        v.extend_from_slice(&0u64.to_le_bytes());
        v.push(3);
        assert_eq!(parse(&v), Err(crate::errors::ERR_BAD_FEE_POLICY));
    }

    #[test]
    fn parse_register_roundtrip() {
        let mut v = Vec::new();
        v.extend_from_slice(&1u32.to_le_bytes());
        for idx in [2u16, 3, 4, 5, 6, 7, 0] {
            v.extend_from_slice(&idx.to_le_bytes());
        }
        v.extend_from_slice(&2u16.to_le_bytes()); // years
        v.extend_from_slice(&5u32.to_le_bytes());
        let mut label = [0u8; LABEL_BUF];
        label[..5].copy_from_slice(b"alice");
        v.extend_from_slice(&label);
        v.extend_from_slice(&[0x11; 32]); // target pubkey
        v.extend_from_slice(&2u32.to_le_bytes());
        v.extend_from_slice(&[0xEE, 0xFF]);
        v.extend_from_slice(&1u32.to_le_bytes());
        v.extend_from_slice(&[0x0A]);
        match parse(&v).unwrap() {
            Ix::Register(ix) => {
                assert_eq!(ix.treasury_idx, 2);
                assert_eq!(ix.ns_idx, 7);
                assert_eq!(ix.target_idx, 0); // fee payer self-register
                assert_eq!(ix.duration_years, 2);
                assert_eq!(ix.label, b"alice");
                assert_eq!(ix.target, [0x11; 32]);
                assert_eq!(ix.domain_proof, &[0xEE, 0xFF]);
                assert_eq!(ix.lease_proof, &[0x0A]);
                assert!(register_idxs_ok(&ix).is_ok());
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn reserved_index_rejected() {
        // config_idx = 1 (the program's own reserved slot) must not parse clean.
        let mut buf = legend_initialize();
        buf[6] = 1;
        buf[7] = 0;
        let ix = match parse(&buf).unwrap() {
            Ix::Initialize(i) => i,
            _ => panic!("wrong variant"),
        };
        assert_eq!(initialize_idxs_ok(&ix), Err(ERR_BAD_ACCOUNT_INDEX));
    }

    #[test]
    fn duplicate_index_rejected() {
        let mut buf = legend_initialize();
        buf[6] = 2;
        buf[7] = 0; // root_idx = 2 == config_idx
        let ix = match parse(&buf).unwrap() {
            Ix::Initialize(i) => i,
            _ => panic!("wrong variant"),
        };
        assert_eq!(initialize_idxs_ok(&ix), Err(ERR_BAD_ACCOUNT_INDEX));
    }

    #[test]
    fn parse_rejects_trailing_garbage() {
        let mut buf = legend_initialize();
        buf.push(0);
        assert_eq!(parse(&buf), Err(ERR_TRUNCATED));
    }

    #[test]
    fn parse_rejects_unknown_tag() {
        assert_eq!(parse(&0xDEADu32.to_le_bytes()), Err(ERR_UNKNOWN_TAG));
    }

    #[test]
    fn label_policy() {
        assert!(validate_label(b"abc").is_ok());
        assert!(validate_label(b"a1-b").is_ok());
        assert_eq!(validate_label(b"ab"), Err(crate::errors::ERR_BAD_LABEL));
        assert_eq!(validate_label(b"-abc"), Err(crate::errors::ERR_BAD_LABEL));
        assert_eq!(validate_label(b"abc-"), Err(crate::errors::ERR_BAD_LABEL));
        assert_eq!(validate_label(b"ABC"), Err(crate::errors::ERR_BAD_LABEL));
        assert_eq!(validate_label(b"a.c"), Err(crate::errors::ERR_BAD_LABEL));
        assert_eq!(validate_label(&[b'a'; 33]), Err(crate::errors::ERR_BAD_LABEL));
    }

    #[test]
    fn duration_policy() {
        assert!(validate_duration(1).is_ok());
        assert!(validate_duration(10).is_ok());
        assert_eq!(validate_duration(0), Err(crate::errors::ERR_BAD_DURATION));
        assert_eq!(validate_duration(11), Err(crate::errors::ERR_BAD_DURATION));
    }
}
