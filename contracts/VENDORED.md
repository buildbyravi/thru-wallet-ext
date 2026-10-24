# Vendored first-party Thru on-chain SDK

- Source: Unto-Labs/thru monorepo, `sdks/rust/{core,macros}` (crate names `thru-core`,
  `thru-sdk-macros`).
- Pinned commit: `a058dd8e00ade2a5b81fecfec98dee66330cf300` (main branch tip as fetched
  2026-10-24; repo last pushed 2026-10-14 per GitHub API).
- Files copied verbatim: `LICENSE`, `NOTICE`, `build.rs`, `link.x.in`,
  `.cargo/config.toml` (riscv64imac target + link.x), `sdks/rust/core/**`,
  `sdks/rust/macros/**` into
  `contracts/thru-custom-registrar/{,vendor/thru-core,vendor/thru-sdk-macros}`.
- Rationale: these crates are NOT published on crates.io; the only distribution channel
  is the monorepo. Vendoring keeps the registrar crate buildable for owner host and CI
  without a moving git dependency, and matches the repo rule — no hardcoded addresses
  anywhere; protocol behavior comes from first-party-pinned source.

To re-vendor to a newer monorepo commit: download
`https://codeload.github.com/Unto-Labs/thru/tar.gz/refs/heads/main`, extract, copy the
same paths, update the pinned commit in this file, and re-run `cargo test --lib`.
