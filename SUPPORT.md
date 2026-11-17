# Support & Frequently Asked Questions — Thru Wallet Extension

**Repository:** [github.com/buildbyravi/thru-wallet-ext](https://github.com/buildbyravi/thru-wallet-ext)  
**Website:** [thruwallet.vercel.app](https://thruwallet.vercel.app)  
**Telegram Channel:** [t.me/walletext](https://t.me/walletext)  
**Telegram Support Group:** [t.me/+dA8TwsOECcIxZWZl](https://t.me/+dA8TwsOECcIxZWZl)  
**Issue Tracker:** [github.com/buildbyravi/thru-wallet-ext/issues](https://github.com/buildbyravi/thru-wallet-ext/issues)

Thru Wallet is an open-source, self-custody Chrome MV3 extension for Thru's **Betanet** (a non-EVM RISC-V Layer-1 blockchain), built on the official `@thru/sdk` (`@thru/sdk/crypto`) and `@thru/programs` packages.

**Betanet is Thru's final testnet before Mainnet** (`https://rpc.betanet.thru.org`, ~6-second blocks). Expect occasional testnet resets or RPC maintenance prior to Mainnet launch.

---

## 1. Getting Help & Reporting Issues

1. **Telegram Support Group:** Reach maintainers and community members at [t.me/+dA8TwsOECcIxZWZl](https://t.me/+dA8TwsOECcIxZWZl).
2. **Search Existing Issues:** Check [GitHub Issues](https://github.com/buildbyravi/thru-wallet-ext/issues).
3. **Open a Bug Report:** Include your extension version (`1.5.0`), Chrome version, OS, reproduction steps, and visible error text. **Never share your 12-word recovery phrase, private key, or password.**

---

## 2. Current Scope & Known Limitations

* **Betanet Only:** Only Thru Betanet (`rpc.betanet.thru.org`) is enabled in the shipped build; Mainnet remains disabled until Mainnet launch, fee measurement, and external security audit completion.
* **External Security Audit Pending:** Internal engineering and security guards are in place, but a formal third-party security audit has not yet been completed. **Do not import keys holding real financial value.**
* **No Dry-Run Transaction Simulation:** Thru RPC does not currently expose a transaction dry-run endpoint, so transaction reviews display deterministic amounts, counterparties, and declared network fees rather than simulated post-transaction balances.
* **Tracked Domain List:** On-chain enumeration of all Name Service accounts is budget-limited by Betanet RPC, so **Domains -> My Domains** displays names registered or imported in your wallet (verified live against on-chain ownership).
* **No Injected dApp Provider:** Thru Wallet operates as a standalone self-custody wallet and side panel; it does not inject `window.thru` into websites.

---

## 3. Frequently Asked Questions (FAQ)

### Q: Is Thru Wallet safe to use with real Mainnet funds?
**A:** **No.** The current release targets **Thru Betanet** only and has not yet undergone an independent external security audit. Use throwaway testnet keys only.

### Q: How do I back up my recovery phrase or private key?
**A:**
1. Unlock the extension and open **Accounts** -> select your account (`Account` detail view).
2. Choose the **Export** action and verify your master password.
3. Write down your 12-word BIP-39 recovery phrase (or 64-character private key) offline in a secure location. Navigating away or locking immediately clears the revealed secret from screen memory.

### Q: Why can't I send native THRU to a brand-new external address?
**A:** On Thru L1, an account must exist on-chain before receiving native `THRU` transfers. Thru Wallet automatically activates accounts created inside your own wallet (on creation, Dashboard load, or when selected as one of your own accounts in Send). An external recipient's wallet must activate its own address first.

### Q: How do I reset the wallet if I forgot my password?
**A:** From the **Unlock** (lock) screen, select **Reset**, read the warning, and type `RESET` in uppercase to erase the local encrypted vault (`chrome.storage.local`). You can then restore your accounts only if you previously backed up your recovery phrase or private keys.
