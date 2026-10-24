//! On-chain entrypoint: parse once, dispatch to processor, propagate the revert code.

#![no_std]
#![no_main]
#![cfg(target_arch = "riscv64")]

#[allow(unused_imports)]
use thru_custom_registrar::{instruction, processor};
use thru_sdk_macros::*;

#[entry(stack_size = 16384)]
fn main(
    instr_data: &[u8],
    mgr: thru_core::AccountManager<16>,
) -> Result<u64, u64> {
    match instruction::parse(instr_data)? {
        instruction::Ix::Initialize(ix) => processor::initialize(&mgr, &ix),
        instruction::Ix::Register(ix) => processor::register(&mgr, &ix),
        instruction::Ix::Renew(ix) => processor::renew(&mgr, &ix),
        instruction::Ix::UpdateConfig(ix) => processor::update_config(&mgr, &ix),
    }
}
