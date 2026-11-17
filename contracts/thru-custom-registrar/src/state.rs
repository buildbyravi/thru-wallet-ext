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
/// Config layout 2 adds the length-tiered schedule and the fee policy. Leases are
/// unchanged (they never carried pricing), so LAYOUT_VERSION above still describes them.
pub const CONFIG_LAYOUT_V1: u8 = 1;
pub const CONFIG_LAYOUT_V2: u8 = 2;

/// Seconds per lease year (365d; chain block_time is ns epoch — see block_ctx.rs).
pub const YEAR_SECONDS: u64 = 31_536_000;

// ---- RegistrarConfig (owned by this program; created by Initialize) ---------------
//  offset  size  field
//  0       4     magic CONFIG_MAGIC
//  4       1     layout version (1 = flat fee, 2 = tiered; see below)
//  5       1     root_name_len (1..=32)
//  6       1     bump (reserved; 0 today — spec-named field, live-tested VM semantics
//                do not yet require it: authority here is the config account itself,
//                located by address, not by bump re-derivation)
//  7       1     reserved (0)
//  8       8     fee_per_year (LEGACY, read-only mirror; layout 1 priced from it,
//                layout 2 always keeps it equal to fee_5plus_char so an old reader
//                shows the cheapest tier rather than zero)
//  16      32    admin
//  48      32    treasury
//  80      32    root_address (name-service root registrar account this config governs)
//  112     32    root_name (zero-padded)
//  -- layout 1 ends at 144 --
//  144     8     fee_3_char    (base units per YEAR for a 3-character label)
//  152     8     fee_4_char    (4-character label)
//  160     8     fee_5plus_char(5..=32-character label)
//  168     1     fee_policy (0 = best effort, 1 = strict; see instruction.rs)
//  169     7     reserved (0)
pub const CONFIG_SIZE_V1: usize = 144;
pub const CONFIG_SIZE: usize = 176;

pub const OFF_CFG_MAGIC: usize = 0;
pub const OFF_CFG_VERSION: usize = 4;
pub const OFF_CFG_ROOT_NAME_LEN: usize = 5;
pub const OFF_CFG_BUMP: usize = 6;
pub const OFF_CFG_FEE_PER_YEAR: usize = 8;
pub const OFF_CFG_ADMIN: usize = 16;
pub const OFF_CFG_TREASURY: usize = 48;
pub const OFF_CFG_ROOT_ADDRESS: usize = 80;
pub const OFF_CFG_ROOT_NAME: usize = 112;
pub const OFF_CFG_FEE_3: usize = 144;
pub const OFF_CFG_FEE_4: usize = 152;
pub const OFF_CFG_FEE_5PLUS: usize = 160;
pub const OFF_CFG_FEE_POLICY: usize = 168;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RegistrarConfig {
    pub admin: [u8; 32],
    pub treasury: [u8; 32],
    /// Legacy flat price. In layout 2 this mirrors `fee_5plus_char`.
    pub fee_per_year: u64,
    pub fee_3_char: u64,
    pub fee_4_char: u64,
    pub fee_5plus_char: u64,
    /// 0 = best effort (a refused charge does not fail the registration), 1 = strict.
    pub fee_policy: u8,
    pub root_address: [u8; 32],
    pub root_name: [u8; crate::instruction::ROOT_NAME_BUF],
    pub root_name_len: u8,
    pub bump: u8,
    /// Which layout the bytes came from (1 or 2); serialize always writes 2.
    pub layout: u8,
}

impl RegistrarConfig {
    /// Always writes the CURRENT layout (2). A layout-1 account is upgraded the first time
    /// any admin write touches it; nothing else has to migrate.
    pub fn serialize(&self) -> [u8; CONFIG_SIZE] {
        let mut out = [0u8; CONFIG_SIZE];
        out[OFF_CFG_MAGIC..OFF_CFG_MAGIC + 4].copy_from_slice(&CONFIG_MAGIC.to_le_bytes());
        out[OFF_CFG_VERSION] = CONFIG_LAYOUT_V2;
        out[OFF_CFG_ROOT_NAME_LEN] = self.root_name_len;
        out[OFF_CFG_BUMP] = self.bump;
        // Invariant: the legacy field mirrors the cheapest tier, so a layout-1 reader shows a
        // real price instead of zero. Written here rather than trusted from the caller.
        out[OFF_CFG_FEE_PER_YEAR..OFF_CFG_FEE_PER_YEAR + 8]
            .copy_from_slice(&self.fee_5plus_char.to_le_bytes());
        out[OFF_CFG_ADMIN..OFF_CFG_ADMIN + 32].copy_from_slice(&self.admin);
        out[OFF_CFG_TREASURY..OFF_CFG_TREASURY + 32].copy_from_slice(&self.treasury);
        out[OFF_CFG_ROOT_ADDRESS..OFF_CFG_ROOT_ADDRESS + 32].copy_from_slice(&self.root_address);
        out[OFF_CFG_ROOT_NAME..OFF_CFG_ROOT_NAME + crate::instruction::ROOT_NAME_BUF]
            .copy_from_slice(&self.root_name);
        out[OFF_CFG_FEE_3..OFF_CFG_FEE_3 + 8].copy_from_slice(&self.fee_3_char.to_le_bytes());
        out[OFF_CFG_FEE_4..OFF_CFG_FEE_4 + 8].copy_from_slice(&self.fee_4_char.to_le_bytes());
        out[OFF_CFG_FEE_5PLUS..OFF_CFG_FEE_5PLUS + 8]
            .copy_from_slice(&self.fee_5plus_char.to_le_bytes());
        out[OFF_CFG_FEE_POLICY] = self.fee_policy;
        out
    }

    /// Reads EITHER layout. A layout-1 account (flat `fee_per_year`, 144 bytes) is presented
    /// as a three-tier schedule where every tier equals that flat fee and the policy is
    /// best-effort — exactly the behaviour the deployed program had, so upgrading the
    /// program before re-initialising the config cannot change what anyone is charged.
    pub fn parse(data: &[u8]) -> Result<Self, u64> {
        if data.len() < CONFIG_SIZE_V1 {
            return Err(errors::ERR_CONFIG_PARSE);
        }
        let u32le = |off: usize| u32::from_le_bytes(data[off..off + 4].try_into().unwrap());
        if u32le(OFF_CFG_MAGIC) != CONFIG_MAGIC {
            return Err(errors::ERR_CONFIG_PARSE);
        }
        let root_name_len = data[OFF_CFG_ROOT_NAME_LEN];
        if root_name_len == 0 || root_name_len as usize > crate::instruction::ROOT_NAME_BUF {
            return Err(errors::ERR_CONFIG_PARSE);
        }
        let u64le = |off: usize| u64::from_le_bytes(data[off..off + 8].try_into().unwrap());
        let pk = |off: usize| -> [u8; 32] { data[off..off + 32].try_into().unwrap() };
        let layout = data[OFF_CFG_VERSION];
        let legacy_fee = u64le(OFF_CFG_FEE_PER_YEAR);
        let (fee_3_char, fee_4_char, fee_5plus_char, fee_policy) = match layout {
            CONFIG_LAYOUT_V1 => (legacy_fee, legacy_fee, legacy_fee, crate::instruction::FEE_POLICY_BEST_EFFORT),
            CONFIG_LAYOUT_V2 => {
                if data.len() < CONFIG_SIZE {
                    return Err(errors::ERR_CONFIG_PARSE);
                }
                let policy = data[OFF_CFG_FEE_POLICY];
                if crate::instruction::validate_fee_policy(policy).is_err() {
                    return Err(errors::ERR_CONFIG_PARSE);
                }
                (u64le(OFF_CFG_FEE_3), u64le(OFF_CFG_FEE_4), u64le(OFF_CFG_FEE_5PLUS), policy)
            }
            _ => return Err(errors::ERR_CONFIG_PARSE),
        };
        Ok(Self {
            admin: pk(OFF_CFG_ADMIN),
            treasury: pk(OFF_CFG_TREASURY),
            fee_per_year: legacy_fee,
            fee_3_char,
            fee_4_char,
            fee_5plus_char,
            fee_policy,
            root_address: pk(OFF_CFG_ROOT_ADDRESS),
            root_name: pk(OFF_CFG_ROOT_NAME),
            root_name_len,
            bump: data[OFF_CFG_BUMP],
            layout,
        })
    }

    /// Price of ONE YEAR for a label of `label_len` bytes.
    ///
    /// 3 → tier 3, 4 → tier 4, 5..=32 → tier 5+. Anything outside the label policy is
    /// refused with the same code `validate_label` uses, so a caller that skipped label
    /// validation still cannot reach a price it was never allowed to quote.
    pub fn price_for_label(&self, label_len: usize) -> Result<u64, u64> {
        match label_len {
            3 => Ok(self.fee_3_char),
            4 => Ok(self.fee_4_char),
            5..=crate::instruction::MAX_LABEL_LEN => Ok(self.fee_5plus_char),
            _ => Err(errors::ERR_BAD_LABEL),
        }
    }

    /// Total for a term. Checked: a tier × years that cannot fit u64 reverts with a named
    /// code rather than wrapping to a small number.
    pub fn total_for_term(&self, label_len: usize, years: u16) -> Result<u64, u64> {
        self.price_for_label(label_len)?
            .checked_mul(years as u64)
            .ok_or(errors::ERR_FEE_OVERFLOW)
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
            fee_3_char: 100_000,
            fee_4_char: 10_000,
            fee_5plus_char: 1_000,
            fee_policy: crate::instruction::FEE_POLICY_STRICT,
            root_address: [0x03; 32],
            root_name: {
                let mut n = [0u8; 32];
                n[..4].copy_from_slice(b"thru");
                n
            },
            root_name_len: 4,
            bump: 0,
            layout: CONFIG_LAYOUT_V2,
        }
    }

    #[test]
    fn config_roundtrip() {
        let cfg = sample_config();
        let bytes = cfg.serialize();
        assert_eq!(bytes.len(), CONFIG_SIZE);
        assert_eq!(&bytes[OFF_CFG_MAGIC..OFF_CFG_MAGIC + 4], b"TCR1");
        assert_eq!(bytes[OFF_CFG_VERSION], CONFIG_LAYOUT_V2);
        // The legacy mirror is DERIVED from fee_5plus, not copied from the struct.
        assert_eq!(&bytes[OFF_CFG_FEE_PER_YEAR..OFF_CFG_FEE_PER_YEAR + 8], &1000u64.to_le_bytes());
        assert_eq!(&bytes[OFF_CFG_FEE_3..OFF_CFG_FEE_3 + 8], &100_000u64.to_le_bytes());
        assert_eq!(&bytes[OFF_CFG_FEE_4..OFF_CFG_FEE_4 + 8], &10_000u64.to_le_bytes());
        assert_eq!(&bytes[OFF_CFG_FEE_5PLUS..OFF_CFG_FEE_5PLUS + 8], &1_000u64.to_le_bytes());
        assert_eq!(bytes[OFF_CFG_FEE_POLICY], crate::instruction::FEE_POLICY_STRICT);
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
    fn config_rejects_an_unknown_fee_policy() {
        let mut bytes = sample_config().serialize();
        bytes[OFF_CFG_FEE_POLICY] = 7;
        assert_eq!(RegistrarConfig::parse(&bytes), Err(errors::ERR_CONFIG_PARSE));
    }

    /// The upgrade path that matters in production: a 144-byte layout-1 account left behind
    /// by the deployed program must keep working, with every tier equal to the flat fee and
    /// the legacy best-effort policy, so deploying the new program changes nobody's price.
    #[test]
    fn layout1_config_reads_as_a_flat_schedule() {
        let mut v1 = [0u8; CONFIG_SIZE_V1];
        v1[OFF_CFG_MAGIC..OFF_CFG_MAGIC + 4].copy_from_slice(&CONFIG_MAGIC.to_le_bytes());
        v1[OFF_CFG_VERSION] = CONFIG_LAYOUT_V1;
        v1[OFF_CFG_ROOT_NAME_LEN] = 4;
        v1[OFF_CFG_FEE_PER_YEAR..OFF_CFG_FEE_PER_YEAR + 8].copy_from_slice(&1000u64.to_le_bytes());
        v1[OFF_CFG_ADMIN..OFF_CFG_ADMIN + 32].copy_from_slice(&[0x01; 32]);
        v1[OFF_CFG_TREASURY..OFF_CFG_TREASURY + 32].copy_from_slice(&[0x02; 32]);
        v1[OFF_CFG_ROOT_ADDRESS..OFF_CFG_ROOT_ADDRESS + 32].copy_from_slice(&[0x03; 32]);
        v1[OFF_CFG_ROOT_NAME..OFF_CFG_ROOT_NAME + 4].copy_from_slice(b"thru");

        let cfg = RegistrarConfig::parse(&v1).unwrap();
        assert_eq!(cfg.layout, CONFIG_LAYOUT_V1);
        assert_eq!(cfg.fee_policy, crate::instruction::FEE_POLICY_BEST_EFFORT);
        assert_eq!(cfg.price_for_label(3).unwrap(), 1000);
        assert_eq!(cfg.price_for_label(4).unwrap(), 1000);
        assert_eq!(cfg.price_for_label(9).unwrap(), 1000);

        // Serialising that account upgrades it in place to layout 2.
        let upgraded = cfg.serialize();
        assert_eq!(upgraded.len(), CONFIG_SIZE);
        assert_eq!(upgraded[OFF_CFG_VERSION], CONFIG_LAYOUT_V2);
        assert_eq!(RegistrarConfig::parse(&upgraded).unwrap().layout, CONFIG_LAYOUT_V2);
    }

    #[test]
    fn price_schedule_follows_label_length() {
        let cfg = sample_config();
        assert_eq!(cfg.price_for_label(3), Ok(100_000));
        assert_eq!(cfg.price_for_label(4), Ok(10_000));
        assert_eq!(cfg.price_for_label(5), Ok(1_000));
        assert_eq!(cfg.price_for_label(32), Ok(1_000));
        assert_eq!(cfg.price_for_label(2), Err(errors::ERR_BAD_LABEL));
        assert_eq!(cfg.price_for_label(33), Err(errors::ERR_BAD_LABEL));
        // Term total, checked.
        assert_eq!(cfg.total_for_term(3, 1), Ok(100_000));
        assert_eq!(cfg.total_for_term(3, 10), Ok(1_000_000));
        assert_eq!(cfg.total_for_term(5, 0), Ok(0));
    }

    #[test]
    fn term_total_refuses_to_wrap() {
        let mut cfg = sample_config();
        cfg.fee_3_char = u64::MAX;
        assert_eq!(cfg.total_for_term(3, 2), Err(errors::ERR_FEE_OVERFLOW));
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
