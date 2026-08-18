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
import { AccountAvatar, AddressText } from '../../domain/account-avatar.js';
import * as bridge from '../bridge.js';
import { formatThru, parseThruAmount, truncateAddress } from '../../../shared/format.js';
import { safeAddressParam } from '../../../shared/refs.js';

export function SendRoute({ params, navigate, back }) {
  const d = disposer();
  const owned = [];

  let account = null;
  let balanceUnits = 0n;
  let network = null;
  let feeInfo = null;          // from tx.estimateFee
  let recipientState = null;   // { valid, isSelf, exists, reason }
  let amountUnits = 0n;

  function track(c) { owned.push(c); return c; }

  const banner = Banner({ tone: 'error' });
  const body = h('div', { class: 'stack stack-4' }, Spinner({ label: 'Loading' }).el);
  const header = PageHeader({ title: 'Send', onBack: () => back() });
  const el = h('section', { class: 'screen' }, [header.el, banner.el, body]);

  function clearBody() {
    for (const c of owned) c.destroy?.();
    owned.length = 0;
    while (body.firstChild) body.removeChild(body.firstChild);
  }

  /** Base units the user may actually send: balance minus whatever the network reserves. */
  function spendableUnits() {
    const reserve = feeInfo?.reserveUnits ? BigInt(feeInfo.reserveUnits) : 0n;
    return balanceUnits > reserve ? balanceUnits - reserve : 0n;
  }

  // ---- Step 1: compose ----------------------------------------------------
  function renderForm(prefill = {}) {
    clearBody();
    banner.clear();
    header.setTitle('Send');

    // -- From --
    body.appendChild(h('div', { class: 'detail-hero' }, [
      AccountAvatar({
        address: account.address,
        imported: account.keyring?.type === 'privateKey',
      }),
      h('div', { class: 'grow' }, [
        h('div', { class: 'row-title', text: account.label || 'Account' }),
        AddressText({ address: account.address }),
      ]),
      h('div', { class: 'row-value', text: `${formatThru(balanceUnits)} THRU` }),
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
        refreshReviewEnabled();
      },
    }));
    // Validation is debounced and asynchronous, so typing does not fire a request per keystroke.
    let checkTimer = null;
    d.on(recipient.control, 'input', () => {
      clearTimeout(checkTimer);
      const value = recipient.value.trim();
      if (!value) return;
      checkTimer = setTimeout(() => validateRecipient(value, recipientStatus), 350);
    });
    d.add(() => clearTimeout(checkTimer));

    const pasteBtn = track(Button({
      label: 'Paste',
      variant: 'secondary',
      size: 'sm',
      iconName: 'copy',
      onClick: async () => {
        try {
          const text = await navigator.clipboard.readText();
          recipient.value = text.trim();
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
      onClick: () => renderPicker(recipient, recipientStatus),
    }));

    body.appendChild(h('div', { class: 'stack stack-2' }, [
      recipient.el,
      recipientStatus,
      h('div', { class: 'row-flex' }, [pasteBtn.el, pickBtn.el]),
    ]));

    // -- Amount --
    const amount = track(Field({
      label: 'Amount (THRU)',
      type: 'text',
      inputMode: 'decimal',
      placeholder: '0.0',
      value: prefill.amount || '',
      hint: `Spendable: ${formatThru(spendableUnits())} THRU`,
      onInput: () => {
        amount.setError('');
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
      onClick: () => {
        const spendable = spendableUnits();
        if (spendable <= 0n) {
          amount.setError('Balance is too low to cover the network fee.');
          return;
        }
        // BigInt formatting only. The legacy MAX did Math.floor(bigint * 10000), which throws.
        amount.value = formatThru(spendable);
        parseAmount(amount);
        refreshReviewEnabled();
      },
    }));

    const feeLine = h('p', { class: 'hint' }, feeText());

    body.appendChild(h('div', { class: 'stack stack-2' }, [
      amount.el,
      h('div', { class: 'row-flex' }, [maxBtn.el]),
      feeLine,
    ]));

    // -- Review --
    const reviewBtn = track(Button({
      label: 'Review',
      variant: 'primary',
      disabled: true,
      onClick: () => {
        if (!validateBeforeReview(recipient, amount)) return;
        renderReview(recipient.value.trim(), amount.value.trim());
      },
    }));
    body.appendChild(h('div', { class: 'screen-actions' }, reviewBtn.el));

    function refreshReviewEnabled() {
      const ready = amountUnits > 0n
        && recipientState?.valid === true
        && recipientState?.isSelf !== true
        && recipientState?.exists !== false;
      reviewBtn.update({ disabled: !ready });
    }

    // Re-validate a prefilled recipient (e.g. arriving from a contact link).
    if (prefill.to) validateRecipient(prefill.to, recipientStatus);
    if (prefill.amount) parseAmount(amount);
    refreshReviewEnabled();
  }

  function feeText() {
    if (!feeInfo) return 'Checking the network fee…';
    if (!feeInfo.supported) {
      // Honest rather than reassuring: quoting a devnet fee on an unmeasured network would be
      // worse than admitting it is unknown.
      return `Network fee is unknown on ${network?.label || 'this network'}. A small amount is `
        + 'held back from Max as a precaution.';
    }
    return `Network fee: ${formatThru(BigInt(feeInfo.feeUnits))} THRU`
      + (feeInfo.source === 'assumed' ? ' (assumed, not measured on this network)' : '');
  }

  /** Parse the amount field into BigInt base units, surfacing its own errors. */
  function parseAmount(amountField) {
    const raw = amountField.value.trim();
    amountUnits = 0n;
    if (!raw) return;
    try {
      amountUnits = parseThruAmount(raw);
    } catch (error) {
      amountField.setError(error.message || 'Enter a valid amount.');
      return;
    }
    if (amountUnits > spendableUnits()) {
      amountField.setError(
        `More than you can send. Spendable: ${formatThru(spendableUnits())} THRU.`,
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
    const addr = String(value || '').trim();
    if (!addr) return;

    let result;
    try {
      result = await bridge.send('tx.validateAddress', { address: addr });
    } catch (error) {
      statusEl.textContent = error.message || 'Could not validate that address.';
      statusEl.classList.remove('hidden');
      return;
    }

    recipientState = { ...result, exists: null };

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

    try {
      const info = await bridge.send('tx.getAccountInfo', { address: addr });
      recipientState.exists = Boolean(info.exists);
      if (!info.exists) {
        statusEl.textContent = 'This address has never been used on this network, so it cannot '
          + 'receive a transfer yet. The owner needs to activate it first.';
      } else {
        statusEl.textContent = `Recipient is active. Balance ${formatThru(BigInt(info.balance))} THRU.`;
      }
    } catch {
      // Unknown is not the same as absent; allow the attempt and let the background decide.
      recipientState.exists = null;
      statusEl.textContent = 'Could not confirm the recipient exists. The transfer may fail.';
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
    if (amountUnits <= 0n) {
      amountField.setError('Enter an amount greater than zero.');
      return false;
    }
    if (amountUnits > spendableUnits()) {
      amountField.setError(`More than you can send. Spendable: ${formatThru(spendableUnits())} THRU.`);
      return false;
    }
    return true;
  }

  // ---- Pick one of my own accounts ---------------------------------------
  async function renderPicker(recipientField, statusEl) {
    clearBody();
    header.setTitle('Choose recipient');

    const listHost = h('div', { class: 'list' }, Spinner({ label: 'Loading accounts' }).el);
    body.appendChild(h('p', { class: 'hint', text:
      'Your own accounts are already active on-chain, so they can always receive a transfer.' }));
    body.appendChild(listHost);
    body.appendChild(h('div', { class: 'screen-actions' },
      track(Button({
        label: 'Back',
        variant: 'text',
        onClick: () => renderForm({ to: recipientField.value, amount: '' }),
      })).el));

    try {
      const [accounts, contacts] = await Promise.all([
        bridge.send('account.list', { withBalances: true }),
        bridge.send('contacts.list'),
      ]);
      while (listHost.firstChild) listHost.removeChild(listHost.firstChild);

      const rows = [];
      for (const acc of accounts || []) {
        if (acc.address === account.address) continue; // cannot send to self
        rows.push({ label: acc.label, address: acc.address, balance: acc.balance, own: true });
      }
      for (const c of contacts || []) {
        rows.push({ label: c.label, address: c.address, balance: null, own: false });
      }

      if (!rows.length) {
        listHost.appendChild(h('p', { class: 'hint', text: 'No other accounts or contacts yet.' }));
        return;
      }

      for (const row of rows) {
        const btn = h('button', { type: 'button', class: 'row clickable' }, [
          AccountAvatar({ address: row.address }),
          h('span', { class: 'row-body' }, [
            h('span', { class: 'row-flex', style: { gap: '6px' } }, [
              h('span', { class: 'row-title', text: row.label || 'Account' }),
              row.own ? null : h('span', { class: 'badge', text: 'contact' }),
            ]),
            h('span', { class: 'row-sub', text: truncateAddress(row.address) }),
          ]),
          row.balance != null
            ? h('span', { class: 'row-value', text: `${formatThru(BigInt(row.balance))} THRU` })
            : null,
        ]);
        d.on(btn, 'click', () => {
          renderForm({ to: row.address, amount: '' });
        });
        listHost.appendChild(btn);
      }
    } catch (error) {
      while (listHost.firstChild) listHost.removeChild(listHost.firstChild);
      listHost.appendChild(h('p', { class: 'error', text: error.message || 'Could not load accounts.' }));
    }
  }

  // ---- Step 2: review ----------------------------------------------------
  function renderReview(to, amountText) {
    clearBody();
    header.setTitle('Confirm send');

    const feeUnits = feeInfo?.supported ? BigInt(feeInfo.feeUnits) : 0n;
    const total = amountUnits + feeUnits;

    body.appendChild(h('div', { class: 'notice warning' }, [
      h('div', { class: 'row-flex' }, [
        icon('warning', 15),
        h('strong', { text: 'Transfers cannot be reversed' }),
      ]),
      h('p', { class: 'hint', text: 'Check the address carefully. There is no way to undo a send.' }),
    ]));

    body.appendChild(h('div', { class: 'detail-table' }, [
      h('div', { class: 'detail-row' }, [
        h('span', { class: 'eyebrow', text: 'From' }),
        h('div', { class: 'detail-val' }, [
          h('div', { text: account.label || 'Account' }),
          h('div', { class: 'mono hint', text: truncateAddress(account.address) }),
        ]),
      ]),
      h('div', { class: 'detail-row' }, [
        h('span', { class: 'eyebrow', text: 'To' }),
        // Full address, not truncated. This is the last chance to notice a wrong one, so
        // hiding the middle here would defeat the point of the step.
        h('div', { class: 'detail-val mono', style: { wordBreak: 'break-all' }, text: to }),
      ]),
      h('div', { class: 'detail-row' }, [
        h('span', { class: 'eyebrow', text: 'Amount' }),
        h('div', { class: 'detail-val mono', text: `${formatThru(amountUnits)} THRU` }),
      ]),
      h('div', { class: 'detail-row' }, [
        h('span', { class: 'eyebrow', text: 'Network fee' }),
        h('div', {
          class: 'detail-val mono',
          text: feeInfo?.supported ? `${formatThru(feeUnits)} THRU` : 'unknown',
        }),
      ]),
      h('div', { class: 'detail-row' }, [
        h('span', { class: 'eyebrow', text: 'Total' }),
        h('div', {
          class: 'detail-val mono strong',
          text: feeInfo?.supported ? `${formatThru(total)} THRU` : `${formatThru(amountUnits)} THRU + fee`,
        }),
      ]),
      h('div', { class: 'detail-row' }, [
        h('span', { class: 'eyebrow', text: 'Network' }),
        h('div', { class: 'detail-val', text: network?.label || '—' }),
      ]),
    ]));

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
    try {
      const result = await bridge.send('tx.send', {
        toAddress: to,
        amountUnits: amountUnits.toString(),
      });
      renderSuccess(to, result);
    } catch (error) {
      // The background owns the authoritative guards (whitelist, duplicate submission,
      // recipient activation), so its message is shown rather than re-derived here.
      if (error.code === 'RECIPIENT_NOT_ACTIVATED') {
        banner.set(error.message, 'warning');
      } else if (error.code === 'DUPLICATE_SUBMISSION') {
        banner.set(error.message, 'warning');
      } else {
        banner.set(error.message || 'The transfer failed.');
      }
    }
  }

  function renderSuccess(to, result) {
    clearBody();
    header.setTitle('Sent');

    body.appendChild(h('div', { class: 'notice' }, [
      h('div', { class: 'row-flex' }, [
        icon('check', 16),
        h('strong', { text: `${formatThru(amountUnits)} THRU sent` }),
      ]),
      h('p', { class: 'hint', text: `to ${truncateAddress(to)}` }),
    ]));

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
      const explorer = network?.explorerUrl ? `${network.explorerUrl}/tx/${result.signature}` : '';
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
      'Waiting for on-chain confirmation. Acceptance by the network is not the same as '
      + 'confirmation.' }));

    body.appendChild(h('div', { class: 'screen-actions' }, [
      track(Button({
        label: 'Done',
        variant: 'primary',
        onClick: () => navigate('/dashboard', { replace: true }),
      })).el,
      track(Button({
        label: 'Send again',
        variant: 'text',
        onClick: () => { amountUnits = 0n; recipientState = null; load(); },
      })).el,
    ]));
  }

  // ---- Load --------------------------------------------------------------
  async function load() {
    banner.clear();
    try {
      const [active, net, fee] = await Promise.all([
        bridge.send('account.getActive'),
        bridge.send('network.getActive'),
        bridge.send('tx.estimateFee', {}).catch(() => null),
      ]);
      account = active;
      network = net;
      feeInfo = fee;

      const info = await bridge.send('tx.getAccountInfo', { address: account.address });
      balanceUnits = info.balance != null ? BigInt(info.balance) : 0n;

      renderForm({ to: safeAddressParam(params.to) || '', amount: '' });
    } catch (error) {
      clearBody();
      banner.set(error.message || 'Could not prepare the send screen.');
    }
  }

  load();

  return {
    el,
    destroy() {
      for (const c of owned) c.destroy?.();
      owned.length = 0;
      header.destroy();
      banner.destroy();
      d.dispose();
    },
  };
}
