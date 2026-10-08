// First-party Thru package address pins, re-exported for use OUTSIDE adapters (layering rule:
// "first-party protocol packages are contained in src/lib adapters"). External packages may
// only be imported inside src/lib; services/UI consume this stable re-export instead. The
// authoritative values live in the pinned package itself — this file deliberately adds no
// logic; any managed-genesis move lands via a pinned package bump, never an edit here.
export { BOOTSTRAP_PROGRAM_ADDRESSES, BOOTSTRAP_FAUCET_VAULT_ADDRESS } from '@thru/programs/bootstrap-addresses';
