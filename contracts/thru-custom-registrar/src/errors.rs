//! Program revert codes (user-error u64). Ranges: 0xD0xx parameter/parse, 0xD1xx
//! business checks, 0xD2xx external effects. The JS twin (`TCR_ERRORS` in
//! thru-wallet-ext src/lib/custom-registrar.js) holds the same table with texts.

#![allow(dead_code)]

// ---- parse-layer (instruction.rs) -------------------------------------------------
pub const ERR_BAD_LABEL: u64 = 0xD100;
pub const ERR_BAD_DURATION: u64 = 0xD101;

// ---- checks-layer ------------------------------------------------------------------
pub const ERR_MISSING_ACCOUNTS: u64 = 0xD102;
pub const ERR_NOT_ADMIN: u64 = 0xD103;
pub const ERR_ALREADY_INITIALIZED: u64 = 0xD104;
pub const ERR_NOT_OWNED_BY_PROGRAM: u64 = 0xD105;
pub const ERR_WRONG_ROOT: u64 = 0xD106;
pub const ERR_WRONG_TREASURY: u64 = 0xD107;
pub const ERR_CONFIG_PARSE: u64 = 0xD108;
pub const ERR_LEASE_PARSE: u64 = 0xD109;
pub const ERR_NAME_TAKEN: u64 = 0xD10A;
pub const ERR_NO_LEASE: u64 = 0xD10B;
pub const ERR_LEASE_LABEL_MISMATCH: u64 = 0xD10C;
pub const ERR_TARGET_NOT_IN_TX: u64 = 0xD10D;
pub const ERR_FEE_OVERFLOW: u64 = 0xD10E;
pub const ERR_WRONG_TREASURY_INDEX: u64 = 0xD10F;

// ---- effects/interactions -----------------------------------------------------------
pub const ERR_CREATE_CONFIG: u64 = 0xD200;
pub const ERR_CREATE_LEASE: u64 = 0xD201;
pub const ERR_TRANSFER: u64 = 0xD202;
pub const ERR_CPI_INIT_ROOT: u64 = 0xD203;
pub const ERR_CPI_REGISTER: u64 = 0xD204;
pub const ERR_PROOF_PARSE: u64 = 0xD205;
