//! thru-custom-registrar — side-by-side name registrar for the Thru L1.
//!
//! Library side: pure byte-layout modules (instruction/state/cpi) are used by host
//! tests; processor.rs + main.rs are the on-chain path. Overall contract architecture
//! documented in README.md (repo: contracts/thru-custom-registrar/).

#![no_std]

pub mod cpi;
pub mod errors;
pub mod instruction;
pub mod state;

// The processor path pulls in syscalls/helpers that only exist in the on-chain target
// build of thru-core — keep it out of the host-target unit-test build.
#[cfg(target_arch = "riscv64")]
pub mod processor;
