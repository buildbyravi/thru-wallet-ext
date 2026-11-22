# Changes and what to verify

Use a disposable wallet for live checks. Mocked previews are not installed-extension or live-network proof. Full technical status: [Status and roadmap](STATUS_AND_ROADMAP.md).

## Changes

- Dashboard: inset balance card, token icons and network chooser without the extra Network heading.
- Assets: search, token details, custom-token import and hide/restore.
- History: flat list, filters, details, copy, clickable explorer links and shorter cached status.
- Settings: full-width theme, auto-lock and signing choices; planned options remain disabled.
- Appearance: readable addresses in both themes and wallet logo in Settings.
- Network: retry a failed health check and ignore old-network results; ms is RPC latency, not block time.
- Faucet: removed the explanatory sentence under the fixed claim amount.
- Receive: previous design kept; the redesign was reverted.

## Verify together when ready to merge

- [ ] Dashboard and Assets: layout, scrolling, search, details, import, hide/restore and refresh.
- [ ] Network: open the chooser and check that Betanet status recovers after a temporary connection failure.
- [ ] History: check filters, flat list, details, copy, explorer links and the short cached status.
- [ ] Settings: check full-width theme, auto-lock and signing choices, password prompts and disabled options in both themes.
- [ ] Faucet: check the claim amount remains visible without the extra sentence.
- [ ] Receive: copy the address and scan its QR code with another device.
- [ ] Chrome: test toolbar popup and side panel, switching, resizing, keyboard focus and worker restart.
- [ ] Security: check lock, secret cleanup, transaction review and custom-network restrictions.
- [ ] Betanet: with approved disposable test accounts, check token import, balances, send, faucet and History against the explorer.
- [ ] Check malformed pending History amounts and the reported refresh-spinner issue.
- [ ] Fix and retest the token-cache race where an older read can overwrite a newer refresh.
- [ ] Investigate and fix the stale Side Panel preference read; verify recovery in real Chrome.
- [ ] Run final build, tests, browser checks and independent review on the final commit.
- [ ] Review the results with the owner and get explicit approval before merging.

Detailed browser and release checks are in the [manual checklist](MANUAL_SMOKE_CHECKLIST.md) and [audit gates](AUDIT_REPORT.md). Remove this temporary list after recording the final results.
