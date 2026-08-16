# Thru Wallet — Rabby-Class Extension Autonomous Build Specification

## 0. Mission

You are the lead engineer, security engineer, product designer, UX engineer, and QA engineer for a Chrome/Chromium self-custody wallet extension for the **Thru Layer 1 blockchain**.

The existing project is a working Thru wallet MVP.

Your task is to transform it into a **Rabby-class wallet experience for Thru**, while preserving all currently working wallet and blockchain functionality.

Do NOT blindly copy Rabby.

Use Rabby as a **UX, information architecture, feature-discovery, and interaction reference**.

Create an original Thru-native design system, branding, icons, copy, component styling, and implementation.

The wallet must be designed so that future capabilities can be added without breaking the wallet core.

Future planned capabilities include:

* fungible token management
* NFTs
* token launchpad
* DEX / AMM
* prediction markets
* portfolio analytics
* address book
* dApp connectivity
* network switching
* notifications
* advanced transaction simulation
* additional Thru networks
* hardware wallets
* passkeys
* other Thru ecosystem applications

The architecture must support these additions without rewriting the vault, signing engine, RPC layer, or existing wallet flows.

---

# 1. NON-NEGOTIABLE RULE

## Preserve the working backend

Before modifying anything:

1. Inspect the entire repository.
2. Identify every currently working feature.
3. Identify which files are security-sensitive.
4. Identify which files communicate with Thru.
5. Identify the current build process.
6. Identify every existing test.
7. Run the complete test suite.
8. Run the production build.
9. Record the baseline results.

Do NOT rewrite working backend/security code merely to make the frontend look better.

The existing functional layers are sacred unless a verified bug requires modification.

Current important layers include:

* wallet vault
* key derivation
* mnemonic generation/import
* private-key import
* account derivation
* encryption/decryption
* session unlock
* auto-lock
* Thru RPC client
* transaction construction
* transaction signing
* transaction submission
* faucet
* balance retrieval
* history
* explorer integration

The UI must consume these capabilities through stable interfaces.

---

# 2. SOURCE MATERIALS

Use these project materials as the starting point:

## Existing README

Read:

`README(20260815-192822).md`

The current MVP already implements:

* real BIP-39 wallet generation
* Thru HD derivation
* multiple accounts
* private-key imports
* encrypted vault
* AES-256-GCM
* PBKDF2
* session-only decrypted vault
* auto-lock
* native THRU balance
* account creation
* faucet
* native transfers
* transaction history
* explorer links

Do not remove those capabilities.

## Existing implementation plan

Read:

`thru-implementation_plan(1).md`

Use it as architectural input, but critically inspect it before implementing it.

Do not assume every proposed design decision remains optimal.

---

# 3. RABBY RESEARCH

Use the public Rabby repository as a reference:

`https://github.com/RabbyHub/Rabby/tree/develop/src`

Study the repository structure and the publicly visible implementation patterns.

Important areas to investigate:

* wallet creation
* seed phrase handling
* address management
* account switcher
* private key import
* seed-based address derivation
* account detail
* settings
* approval flows
* transaction UI
* background architecture
* state management
* event bus
* UI components
* wallet storage architecture
* notification architecture
* desktop/full-page UI
* popup UI
* content scripts
* dApp connectivity architecture
* transaction simulation concepts
* token presentation
* chain/account abstractions

Do NOT copy Rabby's source code into this project.

Do NOT copy Rabby proprietary assets.

Do NOT copy Rabby branding.

Do NOT reproduce Rabby's exact visual design.

Instead extract the underlying UX principles.

---

# 4. UX PRINCIPLES TO EXTRACT FROM RABBY

Study and implement the useful concepts behind the following patterns.

## Account management

Support:

* multiple HD wallets
* multiple addresses from one seed
* independent private-key accounts
* account labels
* account search
* account switching
* account detail
* address copy
* QR receive
* export
* remove/forget imported accounts where technically safe
* wallet/seed distinction
* imported account distinction
* visual account identity

The account switcher should be a dedicated experience rather than a tiny dropdown.

---

# 5. WALLET MODEL

Do NOT model the system simply as:

`one wallet = one address`

Create an explicit hierarchy.

Recommended conceptual model:

```text
Wallet Container
│
├── Seed Wallet A
│   ├── HD Account 0
│   ├── HD Account 1
│   ├── HD Account 2
│   └── ...
│
├── Seed Wallet B
│   ├── HD Account 0
│   ├── HD Account 1
│   └── ...
│
├── Imported Private Key
├── Imported Private Key
└── Future Hardware Wallet
```

The UI should distinguish:

* wallet
* seed phrase
* HD-derived account
* imported private key
* watch-only address in future
* hardware account in future

Do not conflate these concepts.

---

# 6. ONBOARDING

Create a polished onboarding flow.

Required screens:

## Welcome

Actions:

* Create new wallet
* Import recovery phrase
* Import private key

Future placeholders:

* Connect hardware wallet
* Passkey wallet

## Create wallet

Flow:

1. Generate secure mnemonic.
2. Show backup warning.
3. Reveal mnemonic only when explicitly requested.
4. Confirmation challenge.
5. Confirm backup.
6. Create password.
7. Save encrypted vault.
8. Unlock session.
9. Show account.
10. Offer account naming.

Never log mnemonic/private key.

Never send secrets to a server.

Never put secrets into URLs.

Never put secrets into analytics.

---

# 7. IMPORT FLOWS

Support:

## Import seed phrase

* validate mnemonic
* derive first address
* allow wallet naming
* optionally derive additional addresses
* show derived addresses before final confirmation
* allow selection of accounts to add

## Import private key

* validate format
* derive public key/address
* show resulting address before import
* allow label
* save encrypted
* never display private key after import except explicit authenticated export

## Multiple private keys

Design the data model so bulk import can be added later without changing account storage.

---

# 8. DASHBOARD

Dashboard should follow this information hierarchy:

```text
┌──────────────────────────┐
│ Current Account          │
│ address / identity       │
└──────────────────────────┘

        Total Balance

      THRU / portfolio

        [ Send ]
        [ Receive ]

     [ More actions ]

    Assets
    Activity

    Recent Transactions

    Network Status
```

Do not put every feature on the first screen.

Dashboard is a hub.

The user should immediately understand:

1. Which account is active?
2. What is its balance?
3. What assets does it own?
4. What happened recently?
5. What can I do next?

---

# 9. ACCOUNT SWITCHER

Build a Rabby-class account switcher.

Features:

* wallet grouping
* account grouping
* search
* address truncation
* copy
* balance preview
* active account indicator
* account label
* account type badge
* import account
* create HD account
* switch wallet
* account details

Possible UI:

```text
Accounts

Search accounts...

Seed Wallet
  ● Main Account
    ta8...x9m
    12.43 THRU

  ● Trading
    ta1...abc
    4.22 THRU

Imported
  ● Launchpad
    ta7...xyz
    0.81 THRU

+ Add account
+ Import private key
```

---

# 10. ACCOUNT DETAILS

Create a dedicated account detail screen.

Include:

* identicon
* account label
* full address
* copy
* QR
* account type
* derivation index where appropriate
* wallet/seed association
* balance
* assets
* activity
* explorer link
* export
* rename
* future hardware information

Sensitive actions require password/session authentication.

---

# 11. SEND FLOW

Do not make Send a simple form.

Use a multi-step transaction review flow.

Step 1:

```text
Send

Recipient
[ address ]

Asset
[ THRU ]

Amount
[ 0.10 ]

[ Continue ]
```

Step 2:

Transaction preview.

```text
You're sending

0.10 THRU

To

ta8f2k...x9mP

Network fee

~0.000001 THRU

Total

0.100001 THRU

[ Cancel ] [ Confirm ]
```

Step 3:

Authentication.

Step 4:

Signing.

Step 5:

Submission.

Step 6:

Success state with transaction hash and explorer link.

Never submit simply because the user clicked "Send" once.

---

# 12. SEND SECURITY

Before signing:

* validate recipient
* validate amount
* ensure sufficient balance
* calculate/estimate fee where possible
* check account existence
* detect obvious invalid states
* prevent accidental duplicate submission
* show exact transaction effect
* re-check vault unlock state
* never silently change recipient
* never silently change amount

Use idempotency/pending transaction protection wherever technically applicable.

---

# 13. RECEIVE

Include:

* QR code
* full address
* copy button
* shortened address
* account identity
* network identifier
* explorer link

Make the receive screen extremely clear.

---

# 14. HISTORY

Create a real activity screen.

Filters:

* All
* Sent
* Received
* Faucet
* Failed
* Pending where applicable

Each item should show:

* type
* amount
* account
* timestamp
* status
* transaction signature
* explorer link

Decode known transactions where safe.

Unknown programs should never be incorrectly labeled.

Unknown transaction:

```text
Unknown transaction
```

is better than inventing a meaning.

---

# 15. ASSET SYSTEM

Do NOT build token support directly into the dashboard.

Create an abstraction.

Example:

```ts
interface Asset {
  id: string
  type: 'native' | 'token' | 'nft'
  networkId: string
  address?: string
  symbol: string
  name: string
  decimals: number
  logo?: string
  balance: bigint
}
```

Create:

```text
AssetService
AssetRepository
AssetFormatter
TokenService
NFTService
PortfolioService
```

The native THRU implementation should use this model where appropriate.

That allows token support later without rewriting dashboard components.

Thru currently documents a Token Program and token-specific bindings, so design for that future integration without pretending token functionality exists where it has not yet been verified.

---

# 16. FUTURE TOKEN MANAGEMENT

Design the wallet to eventually support:

* token discovery
* token balances
* token transfer
* token import
* token metadata
* token visibility controls
* spam token hiding
* token search
* token details

Do NOT implement fake balances or unverified token metadata.

Create interfaces now.

Implement only verified Thru functionality.

---

# 17. LAUNCHPAD MODULE

Future module:

```text
Launchpad
```

Keep it isolated from wallet core.

Architecture:

```text
features/
  launchpad/
    api/
    components/
    screens/
    services/
    state/
    types/
```

Launchpad must consume wallet capabilities through interfaces.

It must NOT import vault internals.

It must NOT directly manipulate encrypted storage.

It must request signing through a wallet transaction service.

---

# 18. DEX / AMM MODULE

Future module:

```text
features/dex/
```

Possible future functionality:

* pool list
* token pair
* swap
* quote
* slippage
* price impact
* route
* confirmation
* transaction preview

Thru currently exposes AMM bindings under `@thru/programs/amm`, including pool derivation, instruction builders and swap quoting.

Do not implement DEX behavior until the relevant Thru contracts/program interfaces are verified against the target network.

---

# 19. PREDICTION MARKET MODULE

Future:

```text
features/prediction/
```

The wallet must only provide:

* account
* balances
* signing
* transaction approval

The prediction product itself belongs to its own module.

Do not contaminate the wallet core with application-specific business logic.

---

# 20. DAPP CONNECTOR

This is future work.

Do not invent a fake `window.thru` standard.

Thru's current documented wallet architecture is centered on its hosted embedded wallet and signing flow.

Create an abstraction:

```ts
interface WalletProvider {
  connect(...)
  disconnect(...)
  getAccounts(...)
  signTransaction(...)
}
```

Then later implement:

```text
ThruEmbeddedProvider
ThruExtensionProvider
```

Only implement injected provider behavior once an actual compatibility standard is verified.

---

# 21. BACKEND / FRONTEND SEPARATION

This is mandatory.

Use these boundaries:

```text
UI
 ↓
Application Services
 ↓
Domain Interfaces
 ↓
Thru Adapter / Wallet Adapter
 ↓
RPC / Crypto / Storage
```

Never:

```text
UI
 ↓
vault.js
 ↓
RPC
```

Instead:

```text
UI
 ↓
WalletService
 ↓
VaultPort
 ↓
VaultAdapter
```

and:

```text
UI
 ↓
TransactionService
 ↓
ThruClientPort
 ↓
ThruClientAdapter
```

This allows the UI to be replaced without touching wallet logic.

---

# 22. RECOMMENDED ARCHITECTURE

Use this conceptual structure:

```text
src/

background/
  service-worker/
  alarms/
  notifications/
  messaging/

core/
  router/
  state/
  events/
  permissions/
  errors/
  logging/

domain/
  account/
  wallet/
  asset/
  transaction/
  network/

application/
  wallet-service/
  account-service/
  transaction-service/
  asset-service/
  portfolio-service/
  history-service/

infrastructure/
  vault/
  thru/
  storage/
  rpc/
  crypto/

features/
  onboarding/
  dashboard/
  accounts/
  send/
  receive/
  history/
  settings/

  assets/
  tokens/
  nfts/
  launchpad/
  dex/
  prediction/
  dapp/
  notifications/

ui/
  components/
  icons/
  layouts/
  modals/
  forms/
  tables/
  feedback/

styles/
  tokens/
  base/
  components/
  screens/
  utilities/
```

Do not blindly reproduce this exact structure if the repository would become worse.

The principle is what matters:

**domain and infrastructure must not depend on UI.**

---

# 23. FRONTEND STATE

Create one controlled state architecture.

State should contain things such as:

```ts
{
  session,
  selectedWallet,
  selectedAccount,
  accounts,
  balances,
  assets,
  activity,
  network,
  pendingTransaction,
  ui,
  settings
}
```

Do not create dozens of unrelated global mutable variables.

Use selectors/subscriptions where practical.

---

# 24. EVENT BUS

Use application events for decoupling.

Examples:

```text
wallet:created
wallet:imported
wallet:locked
wallet:unlocked

account:created
account:switched
account:renamed
account:removed

balance:updated

transaction:created
transaction:submitted
transaction:confirmed
transaction:failed

network:online
network:offline

security:timeout
```

This prevents one screen from tightly coupling itself to another screen.

---

# 25. ROUTER

Every screen must have a clean lifecycle:

```ts
mount()
update()
cleanup()
```

Navigation away from sensitive screens must clear sensitive form values.

Back navigation must work.

Prevent duplicate event listeners.

Prevent screen remount duplication.

Prevent stale state.

---

# 26. SECURITY RULES

Never:

* log mnemonic
* log private key
* log decrypted vault
* store raw secrets in ordinary storage
* place secret values in URL parameters
* send wallet secrets to remote services
* use analytics containing wallet secrets
* expose private keys to frontend components unnecessarily
* use localStorage for raw secrets
* use arbitrary third-party crypto libraries when the existing Thru crypto layer is sufficient

Use authenticated access before:

* export seed
* export private key
* signing
* changing security settings
* resetting wallet

Keep decrypted key material in the smallest possible scope.

Clear sensitive variables as soon as they are no longer necessary.

---

# 27. STORAGE

Keep encrypted vault storage isolated.

Preferred conceptual separation:

```text
chrome.storage.local
  encryptedVault
  settings
  labels
  addressBook
  preferences
```

Session/memory-only state:

```text
unlockedVault
private signing material
temporary secrets
pending mnemonic
temporary private key
```

Never persist decrypted wallet material merely for convenience.

---

# 28. UI DESIGN

Create an original Thru design system inspired by the clarity of Rabby but branded specifically for Thru.

Use:

* dark industrial interface
* precise spacing
* compact but readable layouts
* strong typography hierarchy
* tabular financial numbers
* monospace addresses
* deterministic identity visuals
* subtle motion
* clear security warnings
* high information density
* excellent empty/error/loading states

Avoid visual clutter.

Avoid excessive gradients.

Avoid generic Web3 neon styling.

Avoid giant cards for every element.

The wallet should feel like professional financial software rather than a crypto landing page.

---

# 29. RESPONSIVE POPUP

Optimize for approximately:

```text
408 × 580
```

but do not hard-code layouts so tightly that future screens cannot grow.

Some flows may need:

* scrollable panels
* full-page extension window
* desktop/full-page mode

Long flows should not be cramped.

---

# 30. COMPONENT SYSTEM

Create reusable components.

Minimum:

```text
AccountPill
AccountAvatar
AccountRow
WalletGroup
BalanceHero
AssetRow
TransactionRow
TransactionPreview
AddressInput
AmountInput
CopyButton
QRCode
SearchInput
FilterTabs
StatusIndicator
NetworkPill
Modal
Drawer
ConfirmDialog
Toast
Skeleton
EmptyState
ErrorState
WarningBanner
SecurityNotice
SecretReveal
```

No repeated HTML/CSS implementation of the same interaction.

---

# 31. DESIGN TOKENS

Create centralized tokens.

Example:

```css
:root {
  --color-bg;
  --color-surface;
  --color-surface-elevated;
  --color-text;
  --color-text-muted;
  --color-primary;
  --color-success;
  --color-warning;
  --color-danger;

  --radius-sm;
  --radius-md;
  --radius-lg;

  --space-1;
  --space-2;
  --space-3;
  --space-4;
  --space-6;
  --space-8;

  --font-ui;
  --font-mono;

  --transition-fast;
  --transition-normal;
}
```

Do not scatter arbitrary hex colors and spacing values throughout the codebase.

---

# 32. ICONS

Use a single icon system.

Do not copy Rabby's proprietary icon assets.

Create an original Thru icon set or use properly licensed generic icons.

Every icon needs:

* predictable size
* consistent stroke
* accessibility label when interactive

---

# 33. ERROR HANDLING

Never show raw RPC errors directly to users.

Create typed errors:

```ts
WalletLockedError
InvalidAddressError
InsufficientBalanceError
NetworkUnavailableError
TransactionRejectedError
TransactionFailedError
AccountNotFoundError
UnsupportedProgramError
InvalidSecretError
```

Map technical failures into human-readable messages.

Example:

Bad:

```text
rpc error: code -320xx...
```

Better:

```text
The Thru network is temporarily unavailable.
Check your connection and try again.
```

Provide "Details" for developers when appropriate.

---

# 34. NETWORK LAYER

Create:

```ts
NetworkConfig
NetworkService
RpcClient
NetworkHealthService
```

Do not hard-code network information inside UI components.

Example:

```ts
{
  id,
  name,
  rpcUrl,
  explorerUrl,
  nativeAsset,
  environment
}
```

This allows:

```text
Alphanet
Testnet
Mainnet
Local
Custom
```

to exist later without changing wallet UI architecture.

---

# 35. NETWORK HEALTH

Show:

```text
● Connected  120ms
```

or:

```text
● Slow
```

or:

```text
● Offline
```

Use exponential backoff.

Do not hammer the RPC.

Cache last-known balance where safe.

Never imply a transaction succeeded merely because the RPC accepted the request.

---

# 36. TRANSACTION LIFECYCLE

Represent transactions as:

```text
draft
↓
review
↓
awaiting-auth
↓
signed
↓
submitted
↓
confirmed
```

Failure states:

```text
rejected
simulation-failed
submission-failed
network-timeout
unknown
```

This makes the system future-proof for:

* transaction simulation
* multi-step transactions
* batching
* swaps
* token launches
* predictions

---

# 37. FEATURES TO BUILD NOW

Implement and polish these first:

### Phase 1

* onboarding
* create wallet
* import seed
* import private key
* password
* unlock
* lock
* account switcher
* multiple HD accounts
* account labels
* account detail
* dashboard
* balance
* send
* receive
* QR
* faucet
* history
* explorer links
* settings
* network health
* address validation
* transaction review

Do not move to token/DEX/launchpad until this is stable.

---

# 38. PHASE 2

After Phase 1 is stable:

* address book
* recent addresses
* notifications
* auto refresh
* better transaction decoding
* token abstraction
* token balances
* asset visibility
* token transfer
* portfolio abstraction
* full-page wallet experience

---

# 39. PHASE 3

Only after real Thru capabilities are verified:

* dApp connector
* transaction approval requests
* permissions
* connected sites
* signing popups
* token launchpad
* AMM/DEX
* NFT gallery
* prediction applications

---

# 40. PHASE 4

Advanced:

* hardware wallets
* passkeys
* advanced signing
* transaction simulation
* risk warnings
* portfolio analytics
* multi-network
* custom RPC
* developer mode

---

# 41. REGRESSION PROTECTION

Every change must preserve old functionality.

Before modifying code:

```bash
npm test
npm run build
```

After modifying code:

```bash
npm test
npm run build
```

If tests fail:

1. determine whether the failure is pre-existing
2. identify the exact regression
3. fix it
4. rerun the entire suite

Never say "the UI works" if the build/test suite is broken.

---

# 42. ADD TESTS BEFORE MAJOR REFACTORING

Protect:

* mnemonic generation
* seed derivation
* private-key import
* account switching
* export authorization
* encryption
* decrypt/re-encrypt cycle
* lock/unlock
* reset
* balance formatting
* exact THRU amount conversion
* address validation
* transaction construction
* transaction decoding

Use real SDK behavior where possible.

Avoid tests that merely test mocks of the implementation.

---

# 43. SECURITY TEST MATRIX

Create tests for:

### Wrong password

Expected:

```text
unlock rejected
```

### Session expired during Send

Expected:

```text
re-authentication required
```

### Invalid recipient

Expected:

```text
cannot continue
```

### Insufficient funds

Expected:

```text
cannot continue
```

### RPC failure

Expected:

```text
no false success
```

### Duplicate Send click

Expected:

```text
one transaction request
```

### Screen navigation during secret entry

Expected:

```text
sensitive fields cleared
```

---

# 44. BACKEND CONTRACTS

Define stable interfaces.

Example:

```ts
interface WalletRepository {
  createWallet(...)
  importSeed(...)
  importPrivateKey(...)
  lock()
  unlock(...)
  reset(...)
  exportSeed(...)
  exportPrivateKey(...)
}
```

```ts
interface AccountRepository {
  listAccounts(...)
  createHdAccount(...)
  importAccount(...)
  renameAccount(...)
  removeAccount(...)
}
```

```ts
interface TransactionService {
  prepare(...)
  validate(...)
  estimate(...)
  sign(...)
  submit(...)
  getStatus(...)
}
```

The UI must consume these contracts.

Never make components depend directly on cryptography implementations.

---

# 45. FEATURE MODULE CONTRACT

Every future feature should look like:

```text
features/
  feature-name/

    components/
    screens/
    services/
    state/
    api/
    types/
    index.ts
```

Feature modules may depend on:

```text
core
domain
application
ui
```

Feature modules must NOT directly manipulate:

```text
vault encryption internals
raw secret storage
private-key memory management
browser storage internals
```

---

# 46. FUTURE-PROOFING RULE

Whenever adding a new feature, ask:

1. Does this belong to wallet core?
2. Does it belong to a feature module?
3. Does it require a new domain abstraction?
4. Does it require a new Thru adapter?
5. Can it be disabled without breaking the wallet?
6. Can it be tested independently?
7. Can the feature be removed without touching the vault?
8. Can the backend remain unchanged if the UI is redesigned?

If not, redesign the implementation before committing it.

---

# 47. MIGRATION STRATEGY

Do NOT perform a giant rewrite.

Use incremental migration.

Recommended sequence:

```text
Existing MVP
   ↓
protect tests
   ↓
extract contracts
   ↓
introduce application services
   ↓
introduce router
   ↓
introduce state
   ↓
introduce event bus
   ↓
extract screens
   ↓
extract reusable components
   ↓
redesign dashboard
   ↓
redesign account management
   ↓
redesign send
   ↓
redesign remaining screens
```

After each step:

```text
test
build
manual verification
commit
```

Never keep the entire project broken while doing a multi-week refactor.

---

# 48. GIT STRATEGY

Use small commits.

Examples:

```text
refactor: introduce wallet service boundary
refactor: extract account service
feat: add wallet onboarding shell
feat: add account switcher
feat: add account details
feat: add transaction preview
feat: redesign dashboard
feat: add receive QR
feat: add settings
test: add account regression suite
```

Do not mix:

```text
security refactor
+
UI redesign
+
new DEX
```

in one commit.

---

# 49. AUTOMATED AGENT BEHAVIOR

You are allowed to make decisions without asking for approval when:

* requirements are explicit
* existing functionality is preserved
* the change is low risk
* the architecture supports future extension

You MUST stop and document the uncertainty instead of guessing when:

* Thru program semantics are undocumented
* transaction formats are uncertain
* fee units are uncertain
* token standards are uncertain
* signing behavior is uncertain
* explorer URLs are uncertain
* dApp provider standards are uncertain

Do not fabricate protocol behavior.

---

# 50. THRU-SPECIFIC RULE

The blockchain layer is authoritative.

Use official Thru SDKs whenever they provide the needed functionality.

Prefer:

```text
@thru/sdk
@thru/crypto
@thru/programs
@thru/wallet
@thru/passkey
```

over hand-written protocol implementations when the official SDK provides the capability.

Current Thru documentation exposes:

* RPC/client SDK
* crypto helpers
* token program bindings
* passkey-manager bindings
* multicall
* AMM bindings
* embedded wallet tooling

Use only verified APIs.

---

# 51. DO NOT OVER-ENGINEER

Do not add dependencies merely because Rabby uses them.

Do not migrate to React purely to imitate Rabby.

If the current vanilla JS architecture can deliver the required result cleanly, keep it.

Introduce a framework only if it has a measurable architectural benefit.

---

# 52. PERFORMANCE

Target:

```text
Popup render < 200ms when cached state exists
Screen transition < 200ms
No blocking RPC requests during initial UI paint
No unnecessary network polling
```

Use skeleton states.

Do not freeze the popup waiting for RPC.

Render cached state immediately where safe.

Then refresh asynchronously.

---

# 53. ACCESSIBILITY

Support:

* keyboard navigation
* visible focus
* Enter submit
* Escape modal close
* appropriate labels
* sufficient contrast
* reduced motion
* accessible error messages

---

# 54. MANUAL QA CHECKLIST

After every major phase test:

## Onboarding

* create wallet
* backup
* unlock
* reload
* lock
* unlock again

## Import

* seed import
* private key import
* invalid seed
* invalid key

## Accounts

* create account
* switch account
* rename
* export
* multiple accounts
* mixed HD + private key accounts

## Transactions

* send
* invalid address
* insufficient funds
* RPC offline
* duplicate click
* successful transaction
* explorer link

## Receive

* QR
* copy
* full address

## History

* reload
* decode
* filtering
* unknown transaction

## Settings

* auto-lock
* network status
* reset
* version/about

---

# 55. DESIGN REVIEW

After each UI phase, review:

### Visual hierarchy

Is the important information visible first?

### Density

Does the popup feel efficient rather than cramped?

### Consistency

Do all screens use the same components?

### Security

Are dangerous operations visually separated?

### Motion

Does animation improve orientation rather than distract?

### Failure states

Does the app look deliberate when the network is offline?

---

# 56. FINAL PRODUCT PRINCIPLE

The resulting product should feel like:

```text
Rabby-class UX
+
Thru-native blockchain support
+
professional security architecture
+
modular Web3 platform
```

Not:

```text
Rabby clone
```

The wallet itself must remain useful even before tokens, launchpad, DEX, prediction markets, or dApp connectivity exist.

The wallet core must become the stable platform on which those products are later built.

---

# 57. EXECUTION ORDER

Execute in this exact order.

## Step 0

Inspect repository and establish baseline.

## Step 1

Read current README and implementation plan.

## Step 2

Inspect all existing wallet/security/Thru code.

## Step 3

Inspect Rabby architecture and relevant UX flows.

## Step 4

Create architecture document describing:

* current architecture
* target architecture
* boundaries
* migration strategy
* risks

## Step 5

Run current tests/build.

## Step 6

Introduce stable service interfaces without changing behavior.

## Step 7

Introduce modular routing.

## Step 8

Introduce application state.

## Step 9

Introduce event system.

## Step 10

Extract screens.

## Step 11

Build reusable component system.

## Step 12

Build new onboarding.

## Step 13

Build account manager.

## Step 14

Build dashboard.

## Step 15

Build transaction preview/send.

## Step 16

Build receive/QR.

## Step 17

Build activity/history.

## Step 18

Build settings.

## Step 19

Add network health.

## Step 20

Run full regression test.

## Step 21

Only after stability, start Phase 2 features.

---

# 58. AGENT OUTPUT REQUIREMENTS

After each completed phase, report:

```text
PHASE:
FILES ADDED:
FILES MODIFIED:
BACKEND CHANGES:
UI CHANGES:
SECURITY IMPACT:
TESTS:
BUILD:
KNOWN LIMITATIONS:
NEXT PHASE:
```

Do not claim something is tested unless you actually ran the test.

Do not claim something is verified against Thru unless it was actually verified.

---

# 59. MOST IMPORTANT RULE

Never sacrifice working wallet functionality merely to make the interface look better.

The correct development sequence is:

```text
Preserve
→ Abstract
→ Isolate
→ Test
→ Redesign
→ Extend
```

not:

```text
Rewrite everything
→ hope nothing breaks
```

Start now by inspecting the repository, running the baseline test/build, mapping the current architecture, and producing the migration map before making destructive changes.
