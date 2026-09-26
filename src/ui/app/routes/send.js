// Send route — the only flow that moves money.
//
// MERGED FROM TWO EXISTING IMPLEMENTATIONS after diffing them:
//
//   From screens/send.js (better):
//     - explicit zero-amount guard
//     - a MAX affordance at all
//     - a review step separate from the form
//
//   From popup.js (better):
//     - an inline error surface next to the field rather than a toast that vanishes
//
//   Fixed here, wrong in BOTH:
//     - MAX WAS BROKEN. send.js:260 computed `Math.floor(sendable * 10000) / 10000` where
//       `sendable` is a BigInt. Mixing BigInt with Number throws a TypeError, so pressing MAX
//       threw rather than filling the field. It is also precisely the float-math-on-money
//       pattern shared/format.js exists to prevent.
//     - THE ENTER-KEY HAZARD. A global handler clicked the first enabled .btn.primary in the
//       visible screen, and on the review step that is Sign & Broadcast. Enter here advances the
//       form to review and does nothing at all on the review step; broadcasting needs a
//       deliberate click on a distinct control.
//     - the gas reserve was a hardcoded 10_000 base units — 10,000x the measured fee, enough to
//       reserve an entire faucet-funded balance. It now comes from tx.estimateFee.
//     - neither checked whether the recipient exists on-chain, so sending to a never-used
//       address surfaced a raw vmError=-765. Thru requires the recipient to be registered.

import { h, disposer } from '../../kit/dom.js';
import { icon } from '../../kit/icon.js';
import { Button } from '../../kit/button.js';
import { Field } from '../../kit/field.js';
import { PageHeader, Banner, Spinner } from '../../kit/feedback.js';
import { AccountAvatar } from '../../domain/account-avatar.js';
import { AccountPicker } from '../../domain/account-picker.js';
import { AssetSelector } from '../../domain/asset-selector.js';
import { requirePassword } from '../../domain/password-prompt.js';
import * as bridge from '../bridge.js';
import { formatThru, parseThruAmount, formatTokenAmount, parseTokenAmount, truncateAddress } from '../../../shared/format.js';
import { safeAddressParam } from '../../../shared/refs.js';

export function SendRoute({ params, navigate, back }) {
  const d = disposer();
  const owned = [];

  let account = null;          // the sending account
  let accounts = [];           // every account, for the From and To pickers
  let keyrings = [];           // for grouping both pickers by source
  let contacts = [];
  let tokens = [];             // registry records from token.list
  let tokenBalanceState = new Map(); // mintAddress -> token.getBalances entry for the active account
  let asset = { isNative: true, symbol: 'THRU', mintAddress: null }; // what this send moves
  let balanceUnits = null;      // live balance only; unknown is NEVER zero
  let cachedBalanceUnits = null; // advisory display only, never used to enable a send
  let balanceStatus = 'checking';
  let tokenBalanceStatus = 'checking';
  let tokensStatus = 'checking';
  let feeStatus = 'checking';
  let accountsStatus = 'checking';
  let keyringsStatus = 'checking';
  let network = null;
  let feeInfo = null;          // from tx.estimateFee (native THRU fee only)
  let recipientState = null;   // { valid, isSelf, exists, reason, tokenAccountExists }
  let amountUnits = 0n;
  let loadSeq = 0;             // invalidate late RPCs after account/network changes
  let balanceRequestSeq = 0;   // a retry supersedes an older read on the SAME account
  let tokenRequestSeq = 0;
  let feeRequestSeq = 0;
  let destroyed = false;
  let switchingAccount = false;

  function track(c) { owned.push(c); return c; }

  const banner = Banner({ tone: 'error' });
  const body = h('div', { class: 'stack stack-4' }, Spinner({ label: 'Loading' }).el);

  // Form state survives an excursion into a sub-view. Without this, opening the asset or
  // recipient picker and coming back cleared whatever had been typed.
  let formState = { to: safeAddressParam(params.to) || '', amount: '' };
  let liveReviewBtn = null;         // the Review control of the currently mounted form
  let liveForm = null;              // only the nodes updated when a background read finishes
  let viewDisposer = disposer();    // sub-view listeners must go away on EACH internal transition
  let recipientValidationSeq = 0;   // invalidates stale async recipient checks (typed-over)

  /**
   * Enable the Review control iff the form is currently submittable. Lives at route scope so
   * validateRecipient can re-evaluate when its async work finishes — the regression this
   * guards was amount-first typing leaving the button disabled forever, because only input
   * handlers refreshed it.
   */
  function refreshReviewEnabled() {
    // The owner-existence gate is native-only: a token recipient needs no registered wallet
    // account, only (eventually) a token account the sender can create.
    const spendable = spendableUnits();
    const ready = spendable != null && amountUnits > 0n && amountUnits <= spendable
      && (asset.isNative || (balanceUnits != null && balanceUnits > 0n))
      && recipientState?.valid === true
      && recipientState?.isSelf !== true
      // An owned recipient can prove absent while an activation is in flight. Do not let a
      // concurrent balance/fee update unlock Review before that activation has completed.
      && (asset.isNative
        ? recipientState?.checking !== true && recipientState?.exists !== false : true);
    liveReviewBtn?.update({ disabled: !ready });
    if (liveForm) liveForm.feeText.textContent = feeText();
  }

  // The asset / From / recipient views are INTERNAL states of this one route, not separate
  // routes. The header was built once with `onBack: () => back()`, so its arrow always left the
  // route entirely and landed on the dashboard — losing the form with it. A one-deep step stack
  // makes the arrow mean "back to the form" while inside a sub-view, and "leave Send" only from
  // the form itself.
  let subView = null;

  function handleBack() {
    if (subView) {
      subView = null;
      renderForm(formState);
      return;
    }
    back();
  }

  const header = PageHeader({ title: 'Send', onBack: () => handleBack() });
  const el = h('section', { class: 'screen' }, [header.el, banner.el, body]);

  function clearBody() {
    recipientValidationSeq += 1;
    liveReviewBtn = null;
    liveForm = null;
    viewDisposer.dispose();
    viewDisposer = disposer();
    for (const c of owned) c.destroy?.();
    owned.length = 0;
    while (body.firstChild) body.removeChild(body.firstChild);
  }

  /** Base units the user may actually send of the CURRENT asset. */
  function spendableUnits() {
    if (!asset.isNative) {
      // Token spendable is the token account balance, in the mint's own units. The THRU fee is
      // a separate constraint on the THRU balance, not deducted from the token amount.
      const state = tokenBalanceState.get(asset.mintAddress);
      if (state?.error === true || !state) return null;
      if (state.tokenAccountExists === false) return 0n;
      return state.tokenAccountExists === true && state.amountUnits != null
        ? BigInt(state.amountUnits) : null;
    }
    // No live balance or verified reserve means no MAX and no Review. An absent fee estimate
    // used to silently become a zero reserve, which could spend the fee payer's entire balance.
    if (balanceUnits == null || feeInfo?.reserveUnits == null) return null;
    const reserve = BigInt(feeInfo.reserveUnits);
    return balanceUnits > reserve ? balanceUnits - reserve : 0n;
  }

  function nativeBalanceText() {
    if (balanceUnits != null) return `${formatThru(balanceUnits)} THRU`;
    if (cachedBalanceUnits != null) return `${formatThru(cachedBalanceUnits)} THRU (last known)`;
    return balanceStatus === 'error' ? 'Balance unavailable' : 'Checking balance…';
  }

  function spendableText() {
    const available = spendableUnits();
    if (available == null) return 'Spendable: unavailable until balance and fee are checked';
    return `Spendable: ${asset.isNative
      ? `${formatThru(available)} THRU`
      : `${formatTokenAmount(available, tokenDecimals())} ${asset.symbol || 'TOKEN'}`}`;
  }

  /** Update just the mounted form's facts, without replacing inputs or losing typed text/focus. */
  function updateFormBalances() {
    if (!liveForm) return;
    liveForm.fromBalance.textContent = nativeBalanceText();
    liveForm.assetBalance.textContent = assetBalanceText();
    liveForm.spendable.textContent = spendableText();
    liveForm.max.update({ disabled: spendableUnits() == null });
    const failed = balanceStatus === 'error' || feeStatus === 'error';
    liveForm.retry.el.classList.toggle('hidden', !failed);
    liveForm.amount.setError('');
    parseAmount(liveForm.amount);
    refreshReviewEnabled();
  }

  /** Registry records merged with this account's balance state, for the asset picker. */
  function mergedTokens() {
    return (tokens || []).map((token) => {
      const state = tokenBalanceState.get(token.mintAddress);
      return state ? { ...token, ...state } : token;
    });
  }

  /** Display balance of the currently selected asset, as an already-formatted string. */
  function assetBalanceText() {
    if (asset.isNative) return nativeBalanceText();
    const symbol = asset.symbol || 'TOKEN';
    const state = tokenBalanceState.get(asset.mintAddress);
    if (state?.error === true) return 'balance unknown';
    if (state?.tokenAccountExists && state.amountUnits != null) {
      return `${formatTokenAmount(BigInt(state.amountUnits), tokenDecimals())} ${symbol}`;
    }
    if (state?.tokenAccountExists === false) return `0 ${symbol}`;
    return tokenBalanceStatus === 'checking' ? 'Checking balance…' : 'balance unknown';
  }

  function tokenDecimals() {
    if (asset.isNative) return 9;
    const state = tokenBalanceState.get(asset.mintAddress);
    if (Number.isInteger(state?.decimals)) return state.decimals;
    return Number.isInteger(asset.decimals) ? asset.decimals : 0;
  }

  // ---- Step 1: compose ----------------------------------------------------
  function renderForm(prefill = {}) {
    // Base state: leaving from here exits the route.
    subView = null;
    formState = { to: prefill.to ?? formState.to, amount: prefill.amount ?? formState.amount };
    clearBody();
    recipientState = null; // a picker choice/reopened form must never reuse the previous address's proof
    banner.clear();
    header.setTitle('Send');

    // -- From: now tappable. The legacy card had a chevron implying it was, but nothing was
    //    wired to it, so there was no way to send from a different account without leaving the
    //    screen and switching the active account first.
    const fromBalance = h('span', { class: 'row-value', text: nativeBalanceText() });
    const fromCard = h('button', { type: 'button', class: 'row clickable' }, [
      AccountAvatar({
        address: account.address,
        imported: account.keyring?.type === 'privateKey',
      }),
      h('span', { class: 'row-body' }, [
        h('span', { class: 'row-title', text: account.label || 'Account' }),
        // Which SOURCE this account came from, so "send from" is unambiguous when several
        // accounts share a similar name.
        h('span', { class: 'row-sub', text: account.keyring?.label || 'Unknown source' }),
      ]),
      fromBalance,
      h('span', { class: 'account-pill-chevron' }, icon('chevronRight', 13)),
    ]);
    viewDisposer.on(fromCard, 'click', () => renderFromPicker());

    body.appendChild(h('div', { class: 'stack stack-2' }, [
      h('span', { class: 'eyebrow', text: 'From' }),
      fromCard,
    ]));

    // -- Asset: reflects the selected asset (native THRU or a funded token) --
    const assetTitleChildren = [
      h('span', { class: 'row-title', text: asset.symbol || 'TOKEN' }),
    ];
    if (asset.isNative) assetTitleChildren.push(h('span', { class: 'tag-native', text: 'Native' }));
    const assetBalance = h('span', { class: 'row-value', text: assetBalanceText() });
    const assetCard = h('button', { type: 'button', class: 'row clickable' }, [
      h('div', { class: 'token-row-avatar' }, asset.isNative
        ? icon('bolt', 15)
        : h('span', { text: (asset.symbol || 'TOKEN').slice(0, 3).toUpperCase() })),
      h('span', { class: 'row-body' }, [
        h('span', { class: 'row-flex', style: { gap: '6px' } }, assetTitleChildren),
        h('span', { class: 'row-sub', text: asset.isNative ? 'Thru Native Token' : (asset.name || 'Token') }),
      ]),
      assetBalance,
      h('span', { class: 'account-pill-chevron' }, icon('chevronRight', 13)),
    ]);
    viewDisposer.on(assetCard, 'click', () => renderAssetPicker());

    body.appendChild(h('div', { class: 'stack stack-2' }, [
      h('span', { class: 'eyebrow', text: 'Asset' }),
      assetCard,
    ]));

    // -- Recipient --
    const recipientStatus = h('p', { class: ['hint', 'hidden'] });

    const recipient = track(Field({
      label: 'Recipient address',
      placeholder: 'ta…',
      value: prefill.to || '',
      autocomplete: 'off',
      onInput: () => {
        recipient.setError('');
        recipientStatus.classList.add('hidden');
        recipientState = null;
        // Any in-flight async check below refers to an address the user already typed past.
        recipientValidationSeq += 1;
        // Keep the shared state current so an excursion into a picker and back does not lose it.
        formState.to = recipient.value;
        refreshReviewEnabled();
      },
    }));
    // Validation is debounced and asynchronous, so typing does not fire a request per keystroke.
    let checkTimer = null;
    viewDisposer.on(recipient.control, 'input', () => {
      clearTimeout(checkTimer);
      const value = recipient.value.trim();
      if (!value) return;
      checkTimer = setTimeout(() => validateRecipient(value, recipientStatus), 350);
    });
    viewDisposer.add(() => clearTimeout(checkTimer));

    const pasteBtn = track(Button({
      label: 'Paste',
      variant: 'secondary',
      size: 'sm',
      iconName: 'copy',
      onClick: async () => {
        try {
          const text = await navigator.clipboard.readText();
          recipient.value = text.trim();
          formState.to = recipient.value;
          validateRecipient(recipient.value, recipientStatus);
        } catch {
          // clipboardRead is in the manifest, but the user can still refuse the prompt.
          recipient.setError('Could not read the clipboard. Paste with Ctrl+V instead.');
        }
      },
    }));

    const pickBtn = track(Button({
      label: 'My accounts',
      variant: 'secondary',
      size: 'sm',
      iconName: 'wallet',
      onClick: () => renderPicker(recipient),
    }));

    body.appendChild(h('div', { class: 'stack stack-2' }, [
      recipient.el,
      recipientStatus,
      h('div', { class: 'row-flex' }, [pasteBtn.el, pickBtn.el]),
    ]));

    // -- Amount --
    // Max sits inline on the spendable line rather than as a full-width button of its own. A
    // 100%-wide Max read as heavily as the primary Review action, which made a convenience
    // shortcut compete visually with the thing that actually advances the flow.
    const amount = track(Field({
      label: `Amount (${asset.symbol || 'TOKEN'})`,
      type: 'text',
      inputMode: 'decimal',
      placeholder: '0.0',
      value: prefill.amount || '',
      onInput: () => {
        amount.setError('');
        formState.amount = amount.value;
        parseAmount(amount);
        refreshReviewEnabled();
      },
      // Enter advances to review. It deliberately does NOT broadcast — see the header note.
      onEnter: () => reviewBtn.el.click(),
    }));

    const maxBtn = track(Button({
      label: 'Max',
      variant: 'secondary',
      size: 'sm',
      disabled: spendableUnits() == null,
      onClick: () => {
        const spendable = spendableUnits();
        if (spendable == null) {
          amount.setError('Balance or fee is not available yet. Retry checks before using Max.');
          return;
        }
        if (spendable <= 0n) {
          amount.setError(asset.isNative
            ? 'Balance is too low to cover the network fee.'
            : `No ${asset.symbol || 'token'} balance to send.`);
          return;
        }
        // BigInt formatting only. The legacy MAX did Math.floor(bigint * 10000), which throws.
        amount.value = asset.isNative
          ? formatThru(spendable)
          : formatTokenAmount(spendable, tokenDecimals());
        formState.amount = amount.value;
        parseAmount(amount);
        refreshReviewEnabled();
      },
    }));
    maxBtn.el.classList.add('w-auto');

    const spendable = h('span', { class: 'hint', text: spendableText() });
    const feeNote = h('p', { class: 'hint', text: feeText() });
    const retryBtn = track(Button({
      label: 'Retry checks',
      variant: 'secondary',
      size: 'sm',
      onClick: () => {
        refreshNativeBalance(loadSeq, account.address);
        refreshFee(loadSeq);
        refreshTokenBalances(loadSeq, account.address);
      },
    }));
    retryBtn.el.classList.toggle('hidden', balanceStatus !== 'error' && feeStatus !== 'error');
    body.appendChild(h('div', { class: 'stack stack-2' }, [
      amount.el,
      h('div', { class: 'row-flex between' }, [spendable, maxBtn.el]),
      feeNote,
      retryBtn.el,
    ]));

    // -- Review --
    const reviewBtn = liveReviewBtn = track(Button({
      label: 'Review',
      variant: 'primary',
      disabled: true,
      onClick: () => {
        if (!validateBeforeReview(recipient, amount)) return;
        renderReview(recipient.value.trim(), amount.value.trim());
      },
    }));
    body.appendChild(h('div', { class: 'screen-actions' }, reviewBtn.el));
    liveForm = { fromBalance, assetBalance, spendable, feeText: feeNote,
      max: maxBtn, retry: retryBtn, amount, recipientStatus };

    // Re-validate a prefilled recipient (e.g. arriving from a contact link).
    if (prefill.to) validateRecipient(prefill.to, recipientStatus);
    if (prefill.amount) parseAmount(amount);
    refreshReviewEnabled();
  }

  function feeText() {
    if (!asset.isNative) {
      // The fee is paid in THRU, and only the NATIVE transfer fee has been measured. Token
      // program fees are a distinct, unmeasured quantity — stating a number here would be
      // fabrication (docs/BACKEND_GAPS.md C2), so the text says what is known and no more.
      let text = 'Network fee is paid in THRU and has not been measured for token transfers yet.';
      if (recipientState?.tokenAccountExists === false) {
        text += ` This send also creates the recipient's ${asset.symbol || 'token'} account,`
          + ' which costs one additional THRU fee.';
      }
      if (balanceUnits === 0n) text += ' This account holds no THRU to pay it.';
      if (balanceUnits == null) text += ' THRU balance is not verified yet.';
      return text;
    }
    if (!feeInfo) return feeStatus === 'error'
      ? 'Network fee unavailable. Retry checks to send safely.'
      : 'Checking the network fee…';
    if (!feeInfo.supported) {
      // No reserve is known on this network: claiming to hold back "a small amount" when Max
      // would in fact reserve zero is unsafe. Pause native sends until a fee is configured.
      return `Network fee is unknown on ${network?.label || 'this network'}. Native sends need a `
        + 'verified fee reserve.';
    }
    return `Network fee: ${formatThru(BigInt(feeInfo.feeUnits))} THRU`
      + (feeInfo.source === 'assumed' ? ' (assumed, not measured on this network)' : '');
  }

  /** Parse the amount field into BigInt base units of the CURRENT asset, surfacing its own errors. */
  function parseAmount(amountField) {
    const raw = amountField.value.trim();
    amountUnits = 0n;
    if (!raw) return;
    try {
      amountUnits = asset.isNative
        ? parseThruAmount(raw)
        : parseTokenAmount(raw, tokenDecimals());
    } catch (error) {
      amountField.setError(error.message || 'Enter a valid amount.');
      return;
    }
    const available = spendableUnits();
    if (available != null && amountUnits > available) {
      amountField.setError(
        asset.isNative
          ? `More than you can send. Spendable: ${formatThru(available)} THRU.`
          : `More than you hold. Balance: ${formatTokenAmount(available, tokenDecimals())} ${asset.symbol || 'TOKEN'}.`,
      );
    }
  }

  /**
   * Ask the BACKGROUND to validate, then check on-chain existence.
   *
   * Thru requires the recipient to already exist on-chain; sending to a never-used address
   * reverts with vmError=-765, and the sender cannot register an account it holds no key for.
   * Surfacing that here turns an unexplained failure into something the user can act on.
   */
  async function validateRecipient(value, statusEl) {
    const seq = ++recipientValidationSeq;
    recipientState = null; // invalidate the previous address BEFORE the first async bridge call
    refreshReviewEnabled();
    const stale = () => seq !== recipientValidationSeq;
    try {
      const addr = String(value || '').trim();
      if (!addr) return;

      let result;
      try {
        result = await bridge.send('tx.validateAddress', { address: addr });
      } catch (error) {
        if (stale()) return;
        statusEl.textContent = error.message || 'Could not validate that address.';
        statusEl.classList.remove('hidden');
        return;
      }

      if (stale()) return;
      recipientState = { ...result, exists: null, checking: true };

      if (!result.valid) {
        statusEl.textContent = result.reason || 'That is not a valid Thru address.';
        statusEl.classList.remove('hidden');
        return;
      }
      if (result.isSelf) {
        statusEl.textContent = result.reason || "That's the address you're sending from.";
        statusEl.classList.remove('hidden');
        return;
      }

      statusEl.textContent = 'Checking the recipient…';
      statusEl.classList.remove('hidden');

      if (!asset.isNative) {
        // Token sends do NOT require the recipient's wallet account to be registered: their
        // token account is a program-derived address the sender can initialize in the same
        // flow. Whether initialize-account tolerates a never-registered OWNER is an open chain
        // question (docs/BACKEND_GAPS.md) verified by scripts/verify-token-transfer.mjs — the
        // chain decides, and this screen neither promises nor pre-refuses.
        try {
          const tokenAccount = await bridge.send('token.deriveTokenAccount', {
            ownerAddress: addr,
            mintAddress: asset.mintAddress,
          });
          if (stale()) return;
          const info = await bridge.send('tx.getAccountInfo', { address: tokenAccount });
          if (stale()) return;
          recipientState.tokenAccountExists = Boolean(info.exists);
          statusEl.textContent = info.exists
            ? `Recipient already has a ${asset.symbol || 'token'} account.`
            : `First ${asset.symbol || 'TOKEN'} for this recipient — their token account will be`
              + ' created with this send.';
        } catch {
          if (stale()) return;
          recipientState.tokenAccountExists = null;
          statusEl.textContent = 'Could not check the recipient\'s token account. The send may '
            + 'still create it, or fail clearly.';
        }
        return;
      }

      try {
        const info = await bridge.send('tx.getAccountInfo', { address: addr });
        if (stale()) return;
        recipientState.exists = Boolean(info.exists);
        if (!info.exists) {
          // tx.autoCreateAccount would register the ACTIVE sender, not this recipient. Only a
          // wallet-owned address may be activated here, and the background rechecks ownership
          // before signing. Never attempt to register a saved contact or an arbitrary address.
          const ownDest = accounts.find((a) => a.address === addr && a.address !== account?.address);
          if (ownDest) {
            statusEl.textContent = `Activating your account on-chain… (${ownDest.label || 'Account'})`;
            try {
              const registered = await bridge.send('tx.registerAccount', { address: ownDest.address });
              if (stale()) return;
              if (registered?.address !== addr || registered?.networkId !== network?.id
                || registered?.exists !== true) {
                throw new Error('Could not confirm activation on this network.');
              }
              recipientState.exists = true;
              statusEl.textContent = `${ownDest.label || 'Account'} is active on this network.`;
            } catch (error) {
              if (stale()) return;
              recipientState.exists = false;
              statusEl.textContent = `Could not activate ${ownDest.label || 'this account'}. `
                + `${error.message || 'Check the connection and try selecting it again.'}`;
            }
          } else {
            statusEl.textContent = 'This address has never been used on this network, so it cannot '
              + 'receive a transfer yet. The owner needs to activate it first.';
          }
        } else {
          statusEl.textContent = `Recipient is active. Balance ${formatThru(BigInt(info.balance))} THRU.`;
        }
      } catch {
        if (stale()) return;
        // Unknown is not the same as absent; allow the attempt and let the background decide.
        recipientState.exists = null;
        statusEl.textContent = 'Could not confirm the recipient exists. The transfer may fail.';
      }
    } finally {
      // Whatever path this took (valid, invalid, self, token or native), the Review gate
      // re-evaluates — unless a newer check superseded this one, in which case it stays put.
      if (seq === recipientValidationSeq) {
        if (recipientState) recipientState.checking = false;
        refreshReviewEnabled();
      }
    }
  }

  function validateBeforeReview(recipientField, amountField) {
    const to = recipientField.value.trim();
    if (!to) {
      recipientField.setError('Enter a recipient address.');
      return false;
    }
    if (recipientState?.valid !== true) {
      recipientField.setError('That is not a valid Thru address.');
      return false;
    }
    if (recipientState?.isSelf) {
      recipientField.setError("That's the address you're sending from.");
      return false;
    }
    if (asset.isNative && recipientState?.checking) {
      recipientField.setError('Checking whether this account is active on-chain…');
      return false;
    }
    if (asset.isNative && recipientState?.exists === false) {
      recipientField.setError('This account must be active on-chain before it can receive.');
      return false;
    }
    if (amountUnits <= 0n) {
      amountField.setError('Enter an amount greater than zero.');
      return false;
    }
    const available = spendableUnits();
    if (available == null || (!asset.isNative && balanceUnits == null)) {
      amountField.setError('Balance or fee is not available yet. Retry checks before reviewing.');
      return false;
    }
    if (!asset.isNative && balanceUnits <= 0n) {
      amountField.setError('This account holds no THRU to pay the token network fee.');
      return false;
    }
    if (amountUnits > available) {
      amountField.setError(asset.isNative
        ? `More than you can send. Spendable: ${formatThru(available)} THRU.`
        : `More than you hold. Balance: ${formatTokenAmount(available, tokenDecimals())} ${asset.symbol || 'TOKEN'}.`);
      return false;
    }
    return true;
  }

  // ---- Choose which account to send FROM ----------------------------------
  function renderFromPicker() {
    subView = 'from';
    clearBody();
    header.setTitle('Send from');

    body.appendChild(h('p', { class: 'hint', text:
      'Grouped by the recovery phrase or key each account comes from.' }));

    const picker = track(AccountPicker({
      accounts,
      keyrings,
      activeRef: account.ref,
      emptyText: accountsStatus === 'checking' || keyringsStatus === 'checking'
        ? 'Loading accounts…'
        : accountsStatus === 'error' ? 'Could not load accounts.' : 'No other accounts in this wallet.',
      onPick: async (pick) => {
        if (!pick.ref) return;
        switchingAccount = true;
        try {
          // Switching the active account is the honest model: tx.send always signs with the
          // active account, so the From selection must actually change it rather than be a
          // display-only preference the backend ignores.
          await bridge.send('account.switch', { ref: pick.ref });
          if (!destroyed) await load();
        } catch (error) {
          if (!destroyed) banner.set(error.message || 'Could not switch account.');
        } finally {
          switchingAccount = false;
        }
      },
    }));
    body.appendChild(picker.el);

    body.appendChild(h('div', { class: 'screen-actions' },
      track(Button({ label: 'Cancel', variant: 'text', onClick: () => renderForm() })).el));
  }

  // ---- Choose the asset ---------------------------------------------------
  function renderAssetPicker() {
    subView = 'asset';
    clearBody();
    header.setTitle('Choose asset');

    const selector = track(AssetSelector({
      nativeBalance: balanceUnits?.toString() ?? null,
      nativeBalanceLabel: nativeBalanceText(),
      balancesPending: tokenBalanceStatus === 'checking',
      tokens: mergedTokens(),
      selectedMint: asset.mintAddress,
      onSelect: (picked) => {
        asset = picked?.isNative
          ? { isNative: true, symbol: 'THRU', mintAddress: null }
          : { ...picked, isNative: false };
        // The amount is denominated in the newly selected asset now, and the recipient check
        // depends on the mint — passing them as prefill forces renderForm to re-run both.
        recipientState = null;
        renderForm({ to: formState.to, amount: formState.amount });
      },
    }));
    body.appendChild(selector.el);
    if (tokensStatus === 'checking') {
      body.appendChild(h('p', { class: 'hint', text: 'Loading your token list…' }));
    } else if (tokensStatus === 'error') {
      body.appendChild(h('p', { class: 'hint', text: 'Could not load your token list.' }));
      body.appendChild(track(Button({
        label: 'Retry token list', variant: 'secondary',
        onClick: () => refreshTokenList(loadSeq),
      })).el);
    }
    if (tokenBalanceStatus === 'checking') {
      body.appendChild(h('p', { class: 'hint', text: 'Checking token balances in the background…' }));
    } else if (tokenBalanceStatus === 'error') {
      body.appendChild(h('p', { class: 'hint', text: 'Token balances unavailable. They are not zero.' }));
      body.appendChild(track(Button({
        label: 'Retry token balances',
        variant: 'secondary',
        onClick: () => refreshTokenBalances(loadSeq, account.address),
      })).el);
    }

    body.appendChild(h('div', { class: 'screen-actions' },
      track(Button({ label: 'Cancel', variant: 'text', onClick: () => renderForm() })).el));
  }

  // ---- Choose a recipient -------------------------------------------------
  function renderPicker(recipientField) {
    if (recipientField) formState.to = recipientField.value;
    subView = 'recipient';
    clearBody();
    header.setTitle('Choose recipient');

    body.appendChild(h('p', { class: 'hint', text:
      'Choose one of your accounts or contacts. If an account you own is not yet active '
      + 'on this network, it will be activated before you send.' }));

    const picker = track(AccountPicker({
      accounts,
      keyrings,
      contacts,
      // Cannot send to the account you are sending from. excludeRef compares by keyringId +
      // index, unlike the legacy picker which compared the OLD ref shape and could mis-match.
      excludeRef: account.ref,
      emptyText: accountsStatus === 'checking' || keyringsStatus === 'checking'
        ? 'Loading accounts…'
        : accountsStatus === 'error' ? 'Could not load accounts.'
          : 'No other accounts or saved contacts yet.',
      onPick: (pick) => renderForm({ to: pick.address, amount: formState.amount }),
    }));
    body.appendChild(picker.el);

    body.appendChild(h('div', { class: 'screen-actions' },
      track(Button({
        label: 'Back',
        variant: 'text',
        onClick: () => renderForm({ to: formState.to, amount: formState.amount }),
      })).el));
  }

  // ---- Step 2: review ----------------------------------------------------
  function renderReview(to, amountText) {
    clearBody();
    header.setTitle('Confirm send');

    const symbol = asset.isNative ? 'THRU' : (asset.symbol || 'TOKEN');
    const displayAmount = asset.isNative
      ? `${formatThru(amountUnits)} THRU`
      : `${formatTokenAmount(amountUnits, tokenDecimals())} ${symbol}`;
    const feeUnits = feeInfo?.supported ? BigInt(feeInfo.feeUnits) : 0n;
    const total = amountUnits + feeUnits;
    const destAccount = accounts.find((a) => a.address === to);
    const destContact = contacts.find((c) => c.address === to);
    const destLabel = destAccount
      ? (destAccount.label || destAccount.keyring?.label || 'Account')
      : destContact?.label;

    const rows = [
      h('div', { class: 'detail-row' }, [
        h('span', { class: 'eyebrow', text: 'From' }),
        h('div', { class: 'detail-val' }, [
          h('div', { text: account.label || 'Account' }),
          h('div', { class: 'mono hint', text: truncateAddress(account.address) }),
        ]),
      ]),
      h('div', { class: 'detail-row' }, [
        h('span', { class: 'eyebrow', text: 'To' }),
        // The human label helps identify an own account/contact, but the FULL address must
        // remain visible at review: a nickname alone cannot authorize an irreversible send.
        h('div', { class: 'detail-val' }, [
          ...(destLabel ? [h('div', { class: 'strong', text: destLabel })] : []),
          h('div', { class: 'mono', style: { wordBreak: 'break-all' }, text: to }),
        ]),
      ]),
      h('div', { class: 'detail-row' }, [
        h('span', { class: 'eyebrow', text: 'Amount' }),
        h('div', { class: 'detail-val mono', text: displayAmount }),
      ]),
    ];

    if (!asset.isNative && recipientState?.tokenAccountExists === false) {
      // A real, user-visible consequence: this send is two chain transactions, not one, and
      // the second fee is part of the cost of sending to a first-time holder.
      rows.push(h('div', { class: 'detail-row' }, [
        h('span', { class: 'eyebrow', text: 'Recipient token account' }),
        h('div', { class: 'detail-val', text: `Will be created for them — one extra THRU fee applies.` }),
      ]));
    }

    rows.push(h('div', { class: 'detail-row' }, [
      h('span', { class: 'eyebrow', text: 'Network fee' }),
      h('div', {
        class: 'detail-val mono',
        text: asset.isNative
          ? (feeInfo?.supported ? `${formatThru(feeUnits)} THRU` : 'unknown')
          : 'paid in THRU · unmeasured for token transfers',
      }),
    ]));

    rows.push(h('div', { class: 'detail-row' }, [
      h('span', { class: 'eyebrow', text: 'Total' }),
      h('div', {
        class: 'detail-val mono strong',
        text: asset.isNative
          ? (feeInfo?.supported ? `${formatThru(total)} THRU` : `${formatThru(amountUnits)} THRU + fee`)
          : `${displayAmount} + THRU fee`,
      }),
    ]));

    rows.push(h('div', { class: 'detail-row' }, [
      h('span', { class: 'eyebrow', text: 'Network' }),
      h('div', { class: 'detail-val', text: network?.label || '—' }),
    ]));

    body.appendChild(h('div', { class: 'detail-table' }, rows));

    // The confirm control is `accent`, not `primary`. The legacy global Enter handler clicked the
    // first enabled .btn.primary in the visible screen, which on this step was Sign & Broadcast.
    // Nothing on this step is .btn.primary, and this route registers no Enter handler here, so
    // broadcasting requires a deliberate click.
    const confirmBtn = track(Button({
      label: 'Sign & send',
      variant: 'accent',
      iconName: 'send',
      busyLabel: 'Sending…',
      onClick: () => submit(to),
    }));

    const editBtn = track(Button({
      label: 'Edit',
      variant: 'text',
      onClick: () => renderForm({ to, amount: amountText }),
    }));

    body.appendChild(h('div', { class: 'screen-actions' }, [confirmBtn.el, editBtn.el]));
  }

  // ---- Step 3: submit ----------------------------------------------------
  async function submit(to) {
    banner.clear();
    // Capture the reviewed facts BEFORE an async settings read or password prompt. Another
    // extension page may switch source/network while that dialog is open; the checked
    // background methods refuse to sign against anything but this exact reviewed context.
    let sendStarted = false;
    const reviewed = {
      fromAddress: account.address,
      network: { ...network },
      asset: { ...asset },
      amountUnits,
      decimals: tokenDecimals(),
    };
    try {
      const method = reviewed.asset.isNative ? 'tx.sendChecked' : 'token.transferChecked';
      const params = reviewed.asset.isNative
        ? { toAddress: to, amountUnits: reviewed.amountUnits.toString() }
        : { mintAddress: reviewed.asset.mintAddress, toAddress: to,
          amountUnits: reviewed.amountUnits.toString() };
      params.fromAddress = reviewed.fromAddress;
      params.networkId = reviewed.network.id;
      const symbol = reviewed.asset.isNative ? 'THRU' : (reviewed.asset.symbol || 'TOKEN');
      const prefs = await bridge.send('settings.get').catch(() => null);
      const sendChecked = (extra = {}) => {
        sendStarted = true;
        return bridge.send(method, { ...params, ...extra });
      };
      const result = prefs?.requirePasswordForSigning === false
        ? await sendChecked()
        : await requirePassword({
          title: 'Confirm send',
          body: `Re-enter your password to sign and broadcast this ${symbol} transfer.`,
          confirmLabel: 'Sign & send',
          verify: (password) => sendChecked({ password }),
        });
      if (!result || destroyed) return;
      renderSuccess(to, result, reviewed);
    } catch (error) {
      if (destroyed) return;
      // The background owns the authoritative guards (whitelist, duplicate submission,
      // recipient activation, mint existence, token balance), so its message is shown rather
      // than re-derived here.
      if (error.code === 'RECIPIENT_NOT_ACTIVATED') {
        banner.set(error.message, 'warning');
      } else if (error.code === 'DUPLICATE_SUBMISSION') {
        banner.set(error.message, 'warning');
      } else if (error.code === 'SEND_CONTEXT_CHANGED') {
        await load({ notice: error.message });
      } else if (sendStarted && (error.retryable
        || ['SERVICE_TIMEOUT', 'PORT_ERROR', 'NO_RESPONSE'].includes(error.code))) {
        // A bridge timeout is NOT proof that signing failed. The worker may still be
        // broadcasting after this page gave up waiting; inviting an immediate retry can
        // send twice. In-flight dedupe is a backstop, not a substitute for honest status.
        banner.set('Could not confirm whether this transfer was submitted. Check Activity '
          + 'and the explorer before trying again.', 'warning');
      } else {
        banner.set(error.message || 'The transfer failed.');
      }
    }
  }

  function renderSuccess(to, result, reviewed) {
    clearBody();
    header.setTitle('Sent');

    const sentText = reviewed.asset.isNative
      ? `${formatThru(reviewed.amountUnits)} THRU sent`
      : `${formatTokenAmount(reviewed.amountUnits, reviewed.decimals)} ${reviewed.asset.symbol || 'TOKEN'} sent`;

    body.appendChild(h('div', { class: 'notice' }, [
      h('div', { class: 'row-flex' }, [
        icon('check', 16),
        h('strong', { text: sentText }),
      ]),
      h('p', { class: 'hint', text: `to ${truncateAddress(to)}` }),
    ]));

    if (result?.recipientTokenAccountCreated) {
      body.appendChild(h('p', { class: 'hint', text:
        `A ${reviewed.asset.symbol || 'token'} account was created for the recipient as part of this send.` }));
    }

    if (result?.signature) {
      body.appendChild(h('div', { class: 'detail-table' }, [
        h('div', { class: 'detail-row' }, [
          h('span', { class: 'eyebrow', text: 'Signature' }),
          h('div', {
            class: 'detail-val mono',
            style: { wordBreak: 'break-all' },
            text: result.signature,
          }),
        ]),
      ]));

      // explorerUrl is '' on networks without an explorer, and h() drops an unsafe href, so a
      // missing or bad URL renders nothing rather than a dead link.
      const explorer = reviewed.network.explorerUrl
        ? `${reviewed.network.explorerUrl}/tx/${result.signature}` : '';
      if (explorer) {
        body.appendChild(h('a', {
          class: 'btn secondary',
          href: explorer,
          target: '_blank',
          rel: 'noopener noreferrer',
        }, [icon('external', 14), h('span', { text: 'View on explorer' })]));
      }
    } else {
      body.appendChild(h('p', { class: 'hint', text:
        'The network accepted the transfer but did not return a signature, so there is no '
        + 'explorer link. Check Activity for confirmation.' }));
    }

    body.appendChild(h('p', { class: 'hint', text:
      `Submitted on ${reviewed.network.label || reviewed.network.id}. Waiting for on-chain `
      + 'confirmation; acceptance by the network is not confirmation.' }));

    body.appendChild(h('div', { class: 'screen-actions' }, [
      track(Button({
        label: 'Done',
        variant: 'primary',
        onClick: () => navigate('/dashboard', { replace: true }),
      })).el,
      track(Button({
        label: 'Send again',
        variant: 'text',
        onClick: () => {
          formState = { to: safeAddressParam(params.to) || '', amount: '' };
          load();
        },
      })).el,
    ]));
  }

  // ---- Load --------------------------------------------------------------
  const isCurrent = (seq, address = account?.address) => !destroyed
    && seq === loadSeq && account?.address === address;

  function refreshPickerIfOpen() {
    if (subView === 'asset') renderAssetPicker();
    if (subView === 'from') renderFromPicker();
    if (subView === 'recipient') renderPicker(null);
  }

  function refreshNativeBalance(seq, address) {
    const request = ++balanceRequestSeq;
    balanceUnits = null;
    balanceStatus = 'checking';
    updateFormBalances();
    bridge.send('tx.getAccountInfo', { address }).then((info) => {
      if (!isCurrent(seq, address) || request !== balanceRequestSeq) return;
      // Missing or malformed data is UNKNOWN, not a balance of zero.
      if (!/^(0|[1-9]\d*)$/.test(String(info?.balance ?? ''))) {
        throw new Error('The network did not return a valid balance.');
      }
      balanceUnits = BigInt(info.balance);
      balanceStatus = 'ready';
      updateFormBalances();
      if (subView === 'asset') renderAssetPicker();
    }).catch(() => {
      if (!isCurrent(seq, address) || request !== balanceRequestSeq) return;
      balanceUnits = null;
      balanceStatus = 'error';
      updateFormBalances();
      if (subView === 'asset') renderAssetPicker();
    });
  }

  function refreshFee(seq) {
    const request = ++feeRequestSeq;
    feeInfo = null;
    feeStatus = 'checking';
    updateFormBalances();
    bridge.send('tx.estimateFee', {}).then((fee) => {
      if (!isCurrent(seq) || request !== feeRequestSeq) return;
      if (fee?.networkId !== network?.id) throw new Error('Fee quote was for another network.');
      if (fee.supported && (!/^(0|[1-9]\d*)$/.test(String(fee.reserveUnits ?? ''))
        || !/^(0|[1-9]\d*)$/.test(String(fee.feeUnits ?? ''))
        || BigInt(fee.reserveUnits) < BigInt(fee.feeUnits))) {
        throw new Error('The network did not return a usable fee reserve.');
      }
      feeInfo = fee;
      feeStatus = 'ready';
      updateFormBalances();
    }).catch(() => {
      if (!isCurrent(seq) || request !== feeRequestSeq) return;
      feeInfo = null;
      feeStatus = 'error';
      updateFormBalances();
    });
  }

  function refreshTokenBalances(seq, address) {
    const request = ++tokenRequestSeq;
    tokenBalanceState = new Map();
    tokenBalanceStatus = 'checking';
    updateFormBalances();
    if (subView === 'asset') renderAssetPicker();
    bridge.send('token.getBalances', { address }).then((result) => {
      if (!isCurrent(seq, address) || request !== tokenRequestSeq) return;
      if (result?.networkId !== network?.id || !Array.isArray(result?.balances)) {
        throw new Error('Token balances were for another network or were unavailable.');
      }
      tokenBalanceState = new Map(result.balances.map((entry) => [entry.mintAddress, entry]));
      tokenBalanceStatus = 'ready';
      updateFormBalances();
      if (subView === 'asset') renderAssetPicker();
    }).catch(() => {
      if (!isCurrent(seq, address) || request !== tokenRequestSeq) return;
      tokenBalanceState = new Map();
      tokenBalanceStatus = 'error';
      updateFormBalances();
      if (subView === 'asset') renderAssetPicker();
    });
  }

  function refreshTokenList(seq) {
    tokensStatus = 'checking';
    bridge.send('token.list').then((list) => {
      if (!isCurrent(seq)) return;
      tokens = Array.isArray(list) ? list : [];
      tokensStatus = 'ready';
      if (subView === 'asset') renderAssetPicker();
    }).catch(() => {
      if (!isCurrent(seq)) return;
      tokens = [];
      tokensStatus = 'error';
      if (subView === 'asset') renderAssetPicker();
    });
  }

  async function load({ notice = null } = {}) {
    const seq = ++loadSeq;
    balanceUnits = null;
    cachedBalanceUnits = null;
    balanceStatus = 'checking';
    tokenBalanceState = new Map();
    tokenBalanceStatus = 'checking';
    tokensStatus = 'checking';
    feeInfo = null;
    feeStatus = 'checking';
    accounts = [];
    keyrings = [];
    contacts = [];
    tokens = [];
    accountsStatus = 'checking';
    keyringsStatus = 'checking';
    account = null;
    network = null;
    asset = { isNative: true, symbol: 'THRU', mintAddress: null };
    recipientState = null;
    amountUnits = 0n;
    formState.amount = '';
    banner.clear();
    clearBody(); // Interrupt a review if the source account or network changes underneath it.
    header.setTitle('Send');
    body.appendChild(Spinner({ label: 'Loading account…' }).el);

    try {
      // Only the sending identity and active network are needed to paint a SAFE form. Cached
      // picker metadata, fee and live RPC reads must never hold the entire screen hostage.
      const [active, net] = await Promise.all([
        bridge.send('account.getActive'),
        bridge.send('network.getActive'),
      ]);
      if (destroyed || seq !== loadSeq) return;
      if (!active?.address || !net?.id) throw new Error('Could not find an active account or network.');
      account = active;
      network = net;
      renderForm(formState);
      if (notice) banner.set(notice, 'warning');

      // These reads are independent. A slow token RPC, a missing balance, or an unavailable
      // picker never prevents the user from editing the recipient and amount. Only a fresh
      // native balance and a known fee reserve can unlock the native Review/Max controls.
      refreshNativeBalance(seq, active.address);
      refreshTokenBalances(seq, active.address);
      refreshFee(seq);
      refreshTokenList(seq);
      bridge.send('account.list', { withBalances: true }).then((list) => {
        if (!isCurrent(seq, active.address)) return;
        accounts = Array.isArray(list) ? list : [];
        accountsStatus = 'ready';
        const cached = accounts.find((row) => row.address === active.address)?.balance;
        if (cached != null && /^(0|[1-9]\d*)$/.test(String(cached))) {
          cachedBalanceUnits = BigInt(cached);
          updateFormBalances();
        }
        if (subView === 'from' || subView === 'recipient') refreshPickerIfOpen();
        // A user can type an unregistered own address before account.list returns. When the
        // list arrives, recognize and activate it without requiring another keystroke.
        if (asset.isNative && recipientState?.exists === false
          && accounts.some((a) => a.address === formState.to.trim()) && liveForm?.recipientStatus) {
          validateRecipient(formState.to, liveForm.recipientStatus);
        }
      }).catch(() => {
        if (!isCurrent(seq, active.address)) return;
        accountsStatus = 'error';
        if (subView === 'from' || subView === 'recipient') refreshPickerIfOpen();
      });
      bridge.send('keyring.list').then((list) => {
        if (!isCurrent(seq, active.address)) return;
        keyrings = Array.isArray(list) ? list : [];
        keyringsStatus = 'ready';
        if (subView === 'from' || subView === 'recipient') refreshPickerIfOpen();
      }).catch(() => {
        if (!isCurrent(seq, active.address)) return;
        keyringsStatus = 'error';
        if (subView === 'from' || subView === 'recipient') refreshPickerIfOpen();
      });
      bridge.send('contacts.list').then((list) => {
        if (!isCurrent(seq, active.address)) return;
        contacts = Array.isArray(list) ? list : [];
        if (subView === 'recipient') refreshPickerIfOpen();
      }).catch(() => {});
    } catch (error) {
      if (destroyed || seq !== loadSeq) return;
      clearBody();
      banner.set(error.message || 'Could not prepare the send screen.');
      body.appendChild(track(Button({
        label: 'Retry loading account', variant: 'secondary', onClick: () => load(),
      })).el);
    }
  }

  d.add(bridge.onEvents({
    accountsChanged: ({ active } = {}) => {
      // account.switch in THIS view already starts its own load. Events from other open
      // extension pages must not leave a reviewed transfer signed by a different account.
      if (!switchingAccount && (!active?.address || active.address !== account?.address)) load();
    },
    networkChanged: ({ id } = {}) => {
      if (!id || id !== network?.id) load();
    },
  }));
  load();

  return {
    el,
    destroy() {
      destroyed = true;
      loadSeq += 1;
      clearBody();
      header.destroy();
      banner.destroy();
      d.dispose();
    },
  };
}
