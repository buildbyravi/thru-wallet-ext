//! On-chain account layouts for thru-custom-registrar. Pure byte-layout module —
//! no syscalls — so host `cargo test` covers it and the JS twin
//! (`src/lib/custom-registrar.js` of thru-wallet-ext) pins the same offsets with
//! golden vectors.
//!
//! All fields little-endian; all pubkeys are 32 raw bytes.

use crate::errors;

/// "TCR1" — config account discriminator. The u32 is the bytes [b'T',b'C',b'R',b'1']
/// little-endian: 0x54 | 0x43<<8 | 0x52<<16 | 0x31<<24 = 0x3152_4354.
pub const CONFIG_MAGIC: u32 = 0x3152_4354;
/// "RLS1" — lease account discriminator.
pub const LEASE_MAGIC: u32 = 0x3153_4C52;
pub const LAYOUT_VERSION: u8 = 1;

/// Seconds per lease year (365d; chain block_time is ns epoch — see block_ctx.rs).
pub const YEAR_SECONDS: u64 = 31_536_000;

// ---- RegistrarConfig (owned by this program; created by Initialize) ---------------
//  offset  size  field
//  0       4     magic CONFIG_MAGIC
//  4       1     state version (== LAYOUT_VERSION)
//  5       1     root_name_len (1..=32)
//  6       1     bump (reserved; 0 today — spec-named field, live-tested VM semantics
//                do not yet require it: authority here is the config account itself,
//                located by address, not by bump re-derivation)
//  7       1     reserved (0)
//  8       8     fee_per_year (base units; testnet default 1000 per owner directive
//                2026-10-24; UpdateConfig may change it — admin only)
//  16      32    admin
//  48      32    treasury
//  80      32    root_address (name-service root registrar account this config governs)
//  112     32    root_name (zero-padded)
pub const CONFIG_SIZE: usize = 144;

pub const OFF_CFG_MAGIC: usize = 0;
pub const OFF_CFG_VERSION: usize = 4;
pub const OFF_CFG_ROOT_NAME_LEN: usize = 5;
pub const OFF_CFG_BUMP: usize = 6;
pub const OFF_CFG_FEE_PER_YEAR: usize = 8;
pub const OFF_CFG_ADMIN: usize = 16;
pub const OFF_CFG_TREASURY: usize = 48;
pub const OFF_CFG_ROOT_ADDRESS: usize = 80;
pub const OFF_CFG_ROOT_NAME: usize = 112;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RegistrarConfig {
    pub admin: [u8; 32],
    pub treasury: [u8; 32],
    pub fee_per_year: u64,
    pub root_address: [u8; 32],
    pub root_name: [u8; crate::instruction::ROOT_NAME_BUF],
    pub root_name_len: u8,
    pub bump: u8,
}

impl RegistrarConfig {
    pub fn serialize(&self) -> [u8; CONFIG_SIZE] {
        let mut out = [0u8; CONFIG_SIZE];
        out[OFF_CFG_MAGIC..OFF_CFG_MAGIC + 4].copy_from_slice(&CONFIG_MAGIC.to_le_bytes());
        out[OFF_CFG_VERSION] = LAYOUT_VERSION;
        out[OFF_CFG_ROOT_NAME_LEN] = self.root_name_len;
        out[OFF_CFG_BUMP] = self.bump;
        out[OFF_CFG_FEE_PER_YEAR..OFF_CFG_FEE_PER_YEAR + 8]
            .copy_from_slice(&self.fee_per_year.to_le_bytes());
        out[OFF_CFG_ADMIN..OFF_CFG_ADMIN + 32].copy_from_slice(&self.admin);
        out[OFF_CFG_TREASURY..OFF_CFG_TREASURY + 32].copy_from_slice(&self.treasury);
        out[OFF_CFG_ROOT_ADDRESS..OFF_CFG_ROOT_ADDRESS + 32].copy_from_slice(&self.root_address);
        out[OFF_CFG_ROOT_NAME..OFF_CFG_ROOT_NAME + crate::instruction::ROOT_NAME_BUF]
            .copy_from_slice(&self.root_name);
        out
    }

    pub fn parse(data: &[u8]) -> Result<Self, u64> {
        if data.len() < CONFIG_SIZE {
            return Err(errors::ERR_CONFIG_PARSE);
        }
        let u32le = |off: usize| u32::from_le_bytes(data[off..off + 4].try_into().unwrap());
        if u32le(OFF_CFG_MAGIC) != CONFIG_MAGIC {
            return Err(errors::ERR_CONFIG_PARSE);
        }
        if data[OFF_CFG_VERSION] != LAYOUT_VERSION {
            return Err(errors::ERR_CONFIG_PARSE);
        }
        let root_name_len = data[OFF_CFG_ROOT_NAME_LEN];
        if root_name_len == 0 || root_name_len as usize > crate::instruction::ROOT_NAME_BUF {
            return Err(errors::ERR_CONFIG_PARSE);
        }
        let u64le = |off: usize| u64::from_le_bytes(data[off..off + 8].try_into().unwrap());
        let pk = |off: usize| -> [u8; 32] { data[off..off + 32].try_into().unwrap() };
        Ok(Self {
            admin: pk(OFF_CFG_ADMIN),
            treasury: pk(OFF_CFG_TREASURY),
            fee_per_year: u64le(OFF_CFG_FEE_PER_YEAR),
            root_address: pk(OFF_CFG_ROOT_ADDRESS),
            root_name: pk(OFF_CFG_ROOT_NAME),
            root_name_len,
            bump: data[OFF_CFG_BUMP],
        })
    }
}

// ---- DomainLease (owned by this program; created by Register) ---------------------
// Spec-named fields (owner, expiration_timestamp, resolver) mapped to concrete bytes:
//  offset  size  field
//  0       4     magic LEASE_MAGIC
//  4       1     version
//  5       1     label_len (3..=32)
//  6       2     reserved
//  8       8     expires_at (epoch SECONDS)
//  16      8     registered_at (epoch SECONDS)
//  24      32    owner (the original registrant)
//  56      32    resolver (the account the name resolves to; == owner today — the chain
//                name-service will carry records only if/when first-party record ops are
//                enabled in the wallet; the lease mirrors the target for now)
//  88      32    label (zero-padded)
pub const LEASE_SIZE: usize = 120;

pub const OFF_LSE_MAGIC: usize = 0;
pub const OFF_LSE_VERSION: usize = 4;
pub const OFF_LSE_LABEL_LEN: usize = 5;
pub const OFF_LSE_EXPIRES_AT: usize = 8;
pub const OFF_LSE_REGISTERED_AT: usize = 16;
pub const OFF_LSE_OWNER: usize = 24;
pub const OFF_LSE_RESOLVER: usize = 56;
pub const OFF_LSE_LABEL: usize = 88;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DomainLease {
    pub owner: [u8; 32],
    pub resolver: [u8; 32],
    pub expires_at: u64,
    pub registered_at: u64,
    pub label: [u8; crate::instruction::LABEL_BUF],
    pub label_len: u8,
}

impl DomainLease {
    pub fn serialize(&self) -> [u8; LEASE_SIZE] {
        let mut out = [0u8; LEASE_SIZE];
        out[OFF_LSE_MAGIC..OFF_LSE_MAGIC + 4].copy_from_slice(&LEASE_MAGIC.to_le_bytes());
        out[OFF_LSE_VERSION] = LAYOUT_VERSION;
        out[OFF_LSE_LABEL_LEN] = self.label_len;
        out[OFF_LSE_EXPIRES_AT..OFF_LSE_EXPIRES_AT + 8]
            .copy_from_slice(&self.expires_at.to_le_bytes());
        out[OFF_LSE_REGISTERED_AT..OFF_LSE_REGISTERED_AT + 8]
            .copy_from_slice(&self.registered_at.to_le_bytes());
        out[OFF_LSE_OWNER..OFF_LSE_OWNER + 32].copy_from_slice(&self.owner);
        out[OFF_LSE_RESOLVER..OFF_LSE_RESOLVER + 32].copy_from_slice(&self.resolver);
        out[OFF_LSE_LABEL..OFF_LSE_LABEL + crate::instruction::LABEL_BUF]
            .copy_from_slice(&self.label);
        out
    }

    pub fn parse(data: &[u8]) -> Result<Self, u64> {
        if data.len() < LEASE_SIZE {
            return Err(errors::ERR_LEASE_PARSE);
        }
        let u32le = |off: usize| u32::from_le_bytes(data[off..off + 4].try_into().unwrap());
        if u32le(OFF_LSE_MAGIC) != LEASE_MAGIC {
            return Err(errors::ERR_LEASE_PARSE);
        }
        if data[OFF_LSE_VERSION] != LAYOUT_VERSION {
            return Err(errors::ERR_LEASE_PARSE);
        }
        let label_len = data[OFF_LSE_LABEL_LEN];
        if (label_len as usize) < crate::instruction::MIN_LABEL_LEN
            || label_len as usize > crate::instruction::MAX_LABEL_LEN
        {
            return Err(errors::ERR_LEASE_PARSE);
        }
        let u64le = |off: usize| u64::from_le_bytes(data[off..off + 8].try_into().unwrap());
        let pk = |off: usize| -> [u8; 32] { data[off..off + 32].try_into().unwrap() };
        Ok(Self {
            owner: pk(OFF_LSE_OWNER),
            resolver: pk(OFF_LSE_RESOLVER),
            expires_at: u64le(OFF_LSE_EXPIRES_AT),
            registered_at: u64le(OFF_LSE_REGISTERED_AT),
            label: pk(OFF_LSE_LABEL),
            label_len,
        })
    }
}

/// The lease account seed IS the label, zero-padded to the one-seed-slot 32 bytes —
/// same input on both sides: client derives the lease address with
/// deriveProgramAddress(registrar_program, seed_padded_label), the program passes the
/// identical seed to account_create.
pub fn lease_seed(label: &[u8]) -> [u8; 32] {
    let mut seed = [0u8; 32];
    seed[..label.len()].copy_from_slice(label);
    seed
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_config() -> RegistrarConfig {
        RegistrarConfig {
            admin: [0x01; 32],
            treasury: [0x02; 32],
            fee_per_year: 1000,
            root_address: [0x03; 32],
            root_name: {
                let mut n = [0u8; 32];
                n[..4].copy_from_slice(b"thru");
                n
            },
            root_name_len: 4,
            bump: 0,
        }
    }

    #[test]
    fn config_roundtrip() {
        let cfg = sample_config();
        let bytes = cfg.serialize();
        assert_eq!(bytes.len(), CONFIG_SIZE);
        assert_eq!(&bytes[OFF_CFG_MAGIC..OFF_CFG_MAGIC + 4], b"TCR1");
        assert_eq!(&bytes[OFF_CFG_FEE_PER_YEAR..OFF_CFG_FEE_PER_YEAR + 8], &1000u64.to_le_bytes());
        assert_eq!(&bytes[OFF_CFG_ROOT_NAME..OFF_CFG_ROOT_NAME + 4], b"thru");
        assert_eq!(RegistrarConfig::parse(&bytes).unwrap(), cfg);
    }

    #[test]
    fn config_rejects_bad_magic_and_versions() {
        let mut bytes = sample_config().serialize();
        bytes[0] ^= 1;
        assert!(RegistrarConfig::parse(&bytes).is_err());
        let mut bytes = sample_config().serialize();
        bytes[OFF_CFG_VERSION] = 99;
        assert!(RegistrarConfig::parse(&bytes).is_err());
    }

    #[test]
    fn lease_roundtrip() {
        let lease = DomainLease {
            owner: [0x09; 32],
            resolver: [0x09; 32],
            expires_at: 1_830_000_000,
            registered_at: 1_798_464_000,
            label: {
                let mut l = [0u8; 32];
                l[..7].copy_from_slice(b"my-name");
                l
            },
            label_len: 7,
        };
        let bytes = lease.serialize();
        assert_eq!(&bytes[OFF_LSE_MAGIC..OFF_LSE_MAGIC + 4], b"RLS1");
        assert_eq!(&bytes[OFF_LSE_LABEL..OFF_LSE_LABEL + 7], b"my-name");
        assert_eq!(DomainLease::parse(&bytes).unwrap(), lease);
    }

    #[test]
    fn lease_seed_pads_to_32() {
        let s = lease_seed(b"alice");
        assert_eq!(&s[..5], b"alice");
        assert!(s[5..].iter().all(|b| *b == 0));
    }
}
