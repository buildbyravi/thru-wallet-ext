//! CPI encoders for the native name-service program, pinned byte-for-byte against the
//! first-party builder source: Unto-Labs/thru@a058dd8 rpc/thru-base/src/txn_tools.rs
//! (`build_name_service_init_root_instruction` / `..._register_subdomain_instruction`,
//! structs `NameServiceInitializeRootArgs` / `NameServiceRegisterSubdomainArgs`,
//! both #[repr(C, packed)], fetched 2026-10-24). The extension lib has carried an
//! exact-match twin since 2026-10-24 (`buildRegisterSubdomainInstructionData` was proven
//! against the CLI output and live-accepted by Betanet nodes the same day — see
//! thru-wallet-ext docs/DECISIONS.md D-015 and the probe scripts).
//!
//!   register-subdomain instruction data =
//!     [u32 tag = 1]
//!     [u16 domain_account_idx][u16 parent_account_idx][u16 owner_account_idx]
//!     [u16 authority_account_idx][64 name buf][u32 name_len]
//!     [u32 PROOF_INLINE = 0][state_proof bytes]
//!
//!   init-root instruction data =
//!     [u32 tag = 0]
//!     [u16 registrar_account_idx][u16 authority_account_idx]
//!     [64 root_name buf][u32 root_name_len]
//!     [u32 PROOF_INLINE = 0][state_proof bytes]
//!
//! Account indices refer to the SHARED transaction account table — CPI on ThruVM passes
//! the outer transaction's accounts to the invoked program (INVOKE syscall, 0x0A).

/// Name-service instruction selectifiers (txn_tools.rs:4488-4489).
pub const NS_TAG_INIT_ROOT: u32 = 0;
pub const NS_TAG_REGISTER_SUBDOMAIN: u32 = 1;
pub const NS_PROOF_INLINE: u32 = 0;
pub const NS_NAME_BUF: usize = 64; // TN_NAME_SERVICE_MAX_DOMAIN_LENGTH

/// Fixed part sizes (tag + args + inline-proof marker), proofs appended after.
pub const NS_REGISTER_FIXED: usize = 4 + 2 + 2 + 2 + 2 + NS_NAME_BUF + 4 + 4;
pub const NS_INIT_ROOT_FIXED: usize = 4 + 2 + 2 + NS_NAME_BUF + 4 + 4;

/// Worst-case stack buffer sizing: fixed part + proof cap (matches instruction.rs).
pub const NS_IX_MAX: usize = NS_REGISTER_FIXED + 2048;

/// Builds register-subdomain CPI data. `name` is the raw, already-validated label.
pub fn encode_register_subdomain(
    out: &mut [u8],
    domain_idx: u16,
    parent_idx: u16,
    owner_idx: u16,
    authority_idx: u16,
    name: &[u8],
    proof: &[u8],
) -> Result<usize, u64> {
    if name.len() > NS_NAME_BUF {
        return Err(crate::instruction::ERR_NAME_TOO_LONG);
    }
    let total = NS_REGISTER_FIXED + proof.len();
    if out.len() < total {
        return Err(crate::instruction::ERR_TRUNCATED);
    }
    let mut w = 0usize;
    let mut put = |bytes: &[u8]| {
        out[w..w + bytes.len()].copy_from_slice(bytes);
        w += bytes.len();
    };
    put(&NS_TAG_REGISTER_SUBDOMAIN.to_le_bytes());
    put(&domain_idx.to_le_bytes());
    put(&parent_idx.to_le_bytes());
    put(&owner_idx.to_le_bytes());
    put(&authority_idx.to_le_bytes());
    let mut namebuf = [0u8; NS_NAME_BUF];
    namebuf[..name.len()].copy_from_slice(name);
    put(&namebuf);
    put(&(name.len() as u32).to_le_bytes());
    put(&NS_PROOF_INLINE.to_le_bytes());
    put(proof);
    Ok(total)
}

/// Builds init-root CPI data. `root_name` raw bytes; `authority_idx` must reference an
/// account authorized for the callee (here: this program's config account, passed via
/// InvokeAuth — see processor.rs).
pub fn encode_init_root(
    out: &mut [u8],
    registrar_idx: u16,
    authority_idx: u16,
    root_name: &[u8],
    proof: &[u8],
) -> Result<usize, u64> {
    if root_name.is_empty() || root_name.len() > NS_NAME_BUF {
        return Err(crate::instruction::ERR_NAME_TOO_LONG);
    }
    let total = NS_INIT_ROOT_FIXED + proof.len();
    if out.len() < total {
        return Err(crate::instruction::ERR_TRUNCATED);
    }
    let mut w = 0usize;
    let mut put = |bytes: &[u8]| {
        out[w..w + bytes.len()].copy_from_slice(bytes);
        w += bytes.len();
    };
    put(&NS_TAG_INIT_ROOT.to_le_bytes());
    put(&registrar_idx.to_le_bytes());
    put(&authority_idx.to_le_bytes());
    let mut namebuf = [0u8; NS_NAME_BUF];
    namebuf[..root_name.len()].copy_from_slice(root_name);
    put(&namebuf);
    put(&(root_name.len() as u32).to_le_bytes());
    put(&NS_PROOF_INLINE.to_le_bytes());
    put(proof);
    Ok(total)
}

/// InvokeAuth wire image for ONE authorized account (plus zero deauth entries).
/// Layout = repr(C) { magic u64, auth_cnt u16, deauth_cnt u16 } + [u16; auth_cnt].
/// 12-byte header per shadow_stack.rs::ACC_IDXS_OFFSET (8 + 2 + 2).
pub const INVOKE_AUTH_MAGIC: u64 = 0xC3F7_A1D9_E5B2_0846;
pub const INVOKE_AUTH_LEN_ONE: usize = 8 + 2 + 2 + 2;

/// Serializes the auth struct backing bytes. The caller passes a pointer to the
/// returned buffer to sys_invoke; alignment of the u64 magic must be 8 — keep the
/// buffer in an aligned wrapper (see processor.rs).
pub fn encode_invoke_auth1(out: &mut [u8; INVOKE_AUTH_LEN_ONE], auth_idx: u16) {
    out[0..8].copy_from_slice(&INVOKE_AUTH_MAGIC.to_le_bytes());
    out[8..10].copy_from_slice(&1u16.to_le_bytes());
    out[10..12].copy_from_slice(&0u16.to_le_bytes());
    out[12..14].copy_from_slice(&auth_idx.to_le_bytes());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn register_subdomain_matches_cli_layout() {
        let mut out = [0u8; NS_IX_MAX];
        let n = encode_register_subdomain(
            &mut out,
            3, // domain idx
            2, // parent idx
            0, // owner idx
            5, // authority idx
            b"alice",
            &[0xCA, 0xFE],
        )
        .unwrap();
        assert_eq!(n, NS_REGISTER_FIXED + 2);
        assert_eq!(&out[0..4], &1u32.to_le_bytes()); // tag
        assert_eq!(&out[4..6], &3u16.to_le_bytes()); // domain
        assert_eq!(&out[6..8], &2u16.to_le_bytes()); // parent
        assert_eq!(&out[8..10], &0u16.to_le_bytes()); // owner
        assert_eq!(&out[10..12], &5u16.to_le_bytes()); // authority
        assert_eq!(&out[12..17], b"alice"); // name buf start
        assert!(out[17..76].iter().all(|b| *b == 0)); // zero padding
        assert_eq!(&out[76..80], &5u32.to_le_bytes()); // name_len
        assert_eq!(&out[80..84], &0u32.to_le_bytes()); // PROOF_INLINE
        assert_eq!(&out[84..86], &[0xCA, 0xFE]); // proof
    }

    #[test]
    fn init_root_matches_cli_layout() {
        let mut out = [0u8; NS_IX_MAX];
        let n = encode_init_root(&mut out, 2, 1, b"thru", &[0xAB]).unwrap();
        assert_eq!(n, NS_INIT_ROOT_FIXED + 1);
        assert_eq!(&out[0..4], &0u32.to_le_bytes());
        assert_eq!(&out[4..6], &2u16.to_le_bytes());
        assert_eq!(&out[6..8], &1u16.to_le_bytes());
        assert_eq!(&out[8..12], b"thru");
        assert_eq!(&out[72..76], &4u32.to_le_bytes()); // name_len
        assert_eq!(&out[76..80], &0u32.to_le_bytes()); // PROOF_INLINE
        assert_eq!(out[80], 0xAB);
    }

    #[test]
    fn invoke_auth_layout() {
        let mut buf = [0u8; INVOKE_AUTH_LEN_ONE];
        encode_invoke_auth1(&mut buf, 3);
        let magic = u64::from_le_bytes(buf[0..8].try_into().unwrap());
        assert_eq!(magic, INVOKE_AUTH_MAGIC);
        assert_eq!(u16::from_le_bytes(buf[8..10].try_into().unwrap()), 1);
        assert_eq!(u16::from_le_bytes(buf[10..12].try_into().unwrap()), 0);
        assert_eq!(u16::from_le_bytes(buf[12..14].try_into().unwrap()), 3);
    }
}
