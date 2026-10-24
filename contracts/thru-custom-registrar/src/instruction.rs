//! Instruction decoding for thru-custom-registrar.
//!
//! Wire formats are fixed and pinned byte-for-byte by the JavaScript client ABI in
//! `src/lib/custom-registrar.js` of the thru-wallet-ext repo (test vectors in
//! `test/test-custom-registrar.mjs`). Every multi-byte field is little-endian.
//!
//! Instruction header: `tag: u32` (little-endian).
//!
//!   tag 0 | Initialize
//!     [u64 fee_per_year][32 treasury][u32 root_name_len | 1..=32][root_name bytes padded to 32]
//!     [32 config_seed][u32 config_proof_len][config_proof][u32 root_proof_len][root_proof]
//!   tag 1 | Register
//!     [u16 duration_years][u32 label_len | 3..=32][label bytes padded to 32]
//!     [32 target][u32 domain_proof_len][domain_proof][u32 lease_proof_len][lease_proof]
//!   tag 2 | Renew
//!     [u16 duration_years][u32 label_len | 3..=32][label bytes padded to 32]
//!   tag 3 | UpdateConfig
//!     [u8 mask][u64 new_fee][32 new_treasury]
//!     mask bit0 = apply new_fee, bit1 = apply new_treasury.
//!
//! This module is pure byte layout — no syscalls — so `cargo test` exercises it on the
//! host target too.

#![allow(clippy::missing_errors_doc)]

pub const TAG_INITIALIZE: u32 = 0;
pub const TAG_REGISTER: u32 = 1;
pub const TAG_RENEW: u32 = 2;
pub const TAG_UPDATE_CONFIG: u32 = 3;

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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InitializeIx<'a> {
    pub fee_per_year: u64,
    pub treasury: [u8; 32],
    pub root_name: &'a [u8],
    pub config_seed: [u8; 32],
    pub config_proof: &'a [u8],
    pub root_proof: &'a [u8],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RegisterIx<'a> {
    pub duration_years: u16,
    pub label: &'a [u8],
    pub target: [u8; 32],
    pub domain_proof: &'a [u8],
    pub lease_proof: &'a [u8],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RenewIx<'a> {
    pub duration_years: u16,
    pub label: &'a [u8],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdateConfigIx {
    pub new_fee: Option<u64>,
    pub new_treasury: Option<[u8; 32]>,
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

/// Parse one full instruction buffer. Trailing bytes after the parsed structure are
/// rejected — an upgrade must bump the tag or the crate version, never smuggle bytes.
pub fn parse(data: &[u8]) -> Result<Ix<'_>, u64> {
    let mut rest = data;
    let tag = take_u32(&mut rest)?;
    let ix = match tag {
        TAG_INITIALIZE => Ix::Initialize(InitializeIx {
            fee_per_year: take_u64(&mut rest)?,
            treasury: take_pubkey(&mut rest)?,
            root_name: take_padded_name(&mut rest, ROOT_NAME_BUF, ERR_NAME_TOO_LONG)?,
            config_seed: take_pubkey(&mut rest)?,
            config_proof: take_proof(&mut rest)?,
            root_proof: take_proof(&mut rest)?,
        }),
        TAG_REGISTER => Ix::Register(RegisterIx {
            duration_years: take_u16(&mut rest)?,
            label: take_padded_name(&mut rest, LABEL_BUF, ERR_NAME_TOO_LONG)?,
            target: take_pubkey(&mut rest)?,
            domain_proof: take_proof(&mut rest)?,
            lease_proof: take_proof(&mut rest)?,
        }),
        TAG_RENEW => Ix::Renew(RenewIx {
            duration_years: take_u16(&mut rest)?,
            label: take_padded_name(&mut rest, LABEL_BUF, ERR_NAME_TOO_LONG)?,
        }),
        TAG_UPDATE_CONFIG => {
            let mask = take_u8(&mut rest)?;
            let new_fee_raw = take_u64(&mut rest)?;
            let new_treasury_raw = take_pubkey(&mut rest)?;
            Ix::UpdateConfig(UpdateConfigIx {
                new_fee: if mask & 0x01 != 0 { Some(new_fee_raw) } else { None },
                new_treasury: if mask & 0x02 != 0 { Some(new_treasury_raw) } else { None },
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
        v.extend_from_slice(&0u32.to_le_bytes()); // tag
        v.extend_from_slice(&1000u64.to_le_bytes()); // fee_per_year
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
                assert_eq!(ix.fee_per_year, 1000);
                assert_eq!(ix.treasury, [0xAA; 32]);
                assert_eq!(ix.root_name, b"thru");
                assert_eq!(ix.config_seed, [0x07; 32]);
                assert_eq!(ix.config_proof, &[1, 2, 3]);
                assert_eq!(ix.root_proof, &[9, 8, 7, 6]);
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn parse_register_roundtrip() {
        let mut v = Vec::new();
        v.extend_from_slice(&1u32.to_le_bytes());
        v.extend_from_slice(&2u16.to_le_bytes());
        v.extend_from_slice(&5u32.to_le_bytes());
        let mut label = [0u8; LABEL_BUF];
        label[..5].copy_from_slice(b"alice");
        v.extend_from_slice(&label);
        v.extend_from_slice(&[0x11; 32]);
        v.extend_from_slice(&2u32.to_le_bytes());
        v.extend_from_slice(&[0xEE, 0xFF]);
        v.extend_from_slice(&1u32.to_le_bytes());
        v.extend_from_slice(&[0x0A]);
        match parse(&v).unwrap() {
            Ix::Register(ix) => {
                assert_eq!(ix.duration_years, 2);
                assert_eq!(ix.label, b"alice");
                assert_eq!(ix.target, [0x11; 32]);
                assert_eq!(ix.domain_proof, &[0xEE, 0xFF]);
                assert_eq!(ix.lease_proof, &[0x0A]);
            }
            _ => panic!("wrong variant"),
        }
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
