// First-party Thru package address pins, re-exported for use OUTSIDE adapters (layering rule:
// "first-party protocol packages are contained in src/lib adapters"). External packages may
// only be imported inside src/lib; services/UI consume this stable re-export instead. These
// currently supported bootstrap pins come from @thru/programs; the removed rate-limit program
// compatibility reader and its historical seed are isolated in ratelimit.js.
export {
  BOOTSTRAP_PROGRAM_ADDRESSES,
  BOOTSTRAP_FAUCET_VAULT_ADDRESS,
} from '@thru/programs/bootstrap-addresses';
