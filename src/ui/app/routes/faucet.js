// Faucet route — claim test THRU.
//
// Replaces screens/faucet.js. Behavioural differences, all of them from things now verified
// against a live network:
//
//   - The amount field is BASE UNITS, and says so. That is now CONFIRMED rather than assumed:
//     claiming 10000 credited exactly 10000 base units on alphanet. The legacy label said "raw
//     units" without explaining what that meant next to a Send screen that takes whole THRU.
//   - The cap comes from the ACTIVE NETWORK's faucetMaxPerClaim, not a hardcoded 10_000n copied
//     into three files.
//   - Networks with no faucet are handled. testnet and mainnet declare none, so the screen says
//     so instead of offering a button that cannot work.
//   - The claim shows the resulting balance change, because "it said success" and "the money
//     arrived" are different claims and only one of them is checkable.
//   - Validation is integer-only via BigInt. The legacy screen used parseInt and Number()
//     comparisons against a BigInt cap.

import { h, disposer } from '../../kit/dom.js';
import { icon } from '../../kit/icon.js';
import { Button } from '../../kit/button.js';
import { Field } from '../../kit/field.js';
import { PageHeader, Banner, Spinner } from '../../kit/feedback.js';
import * as bridge from '../bridge.js';
import { formatThru } from '../../../shared/format.js';

export function FaucetRoute({ navigate, back }) {
  const d = disposer();
  const owned = [];
  let account = null;
  let network = null;
  let capUnits = 0n;

  function track(c) { owned.push(c); return c; }

  const banner = Banner({ tone: 'error' });
  const body = h('div', { class: 'stack stack-4' }, Spinner({ label: 'Loading' }).el);
  const header = PageHeader({ title: 'Faucet', onBack: () => back() });
  const el = h('section', { class: 'screen' }, [header.el, banner.el, body]);

  function clearBody() {
    for (const c of owned) c.destroy?.();
    owned.length = 0;
    while (body.firstChild) body.removeChild(body.firstChild);
  }

  function renderNoFaucet() {
    clearBody();
    body.appendChild(h('div', { class: 'notice' }, [
      h('div', { class: 'row-flex' }, [
        icon('info', 15),
        h('strong', { text: `${network?.label || 'This network'} has no faucet` }),
      ]),
      h('p', { class: 'hint', text:
        'A faucet only exists on test networks. Switch to a test network in Settings, or fund '
        + 'this account from elsewhere.' }),
    ]));
    body.appendChild(h('div', { class: 'screen-actions' },
      track(Button({
        label: 'Open settings',
        variant: 'secondary',
        iconName: 'settings',
        onClick: () => navigate('/settings'),
      })).el));
  }

  function renderForm() {
    clearBody();

    const amount = track(Field({
      label: 'Amount in base units',
      type: 'text',
      inputMode: 'numeric',
      value: capUnits.toString(),
      // Explicit about the unit, because Send takes whole THRU and this takes base units. That
      // difference is the single most confusing thing in the wallet, and it is now verified:
      // claiming 10000 credits exactly 10000 base units.
      hint: `Whole numbers only, up to ${capUnits} base units per claim `
        + `(${formatThru(capUnits)} THRU). This field is NOT in THRU.`,
      onInput: () => amount.setError(''),
    }));

    const claimBtn = track(Button({
      label: 'Claim on-chain',
      variant: 'primary',
      iconName: 'faucet',
      busyLabel: 'Claiming…',
      onClick: () => claim(amount),
    }));

    body.appendChild(amount.el);
    body.appendChild(h('p', { class: 'hint', text:
      'The faucet pays your active account. Claiming is free and does not need a balance.' }));
    body.appendChild(h('div', { class: 'screen-actions' }, claimBtn.el));
  }

  async function claim(amountField) {
    banner.clear();
    const raw = amountField.value.trim();

    // Integer-only, compared as BigInt against a BigInt cap. The legacy screen mixed parseInt
    // with Number(cap) comparisons.
    if (!/^\d+$/.test(raw)) {
      amountField.setError('Enter a whole number of base units.');
      return;
    }
    let units;
    try {
      units = BigInt(raw);
    } catch {
      amountField.setError('Enter a whole number of base units.');
      return;
    }
    if (units <= 0n) {
      amountField.setError('Enter an amount greater than zero.');
      return;
    }
    if (units > capUnits) {
      amountField.setError(`The most this faucet gives per claim is ${capUnits} base units.`);
      return;
    }

    const before = await bridge
      .send('tx.getAccountInfo', { address: account.address })
      .then((i) => BigInt(i.balance || '0'))
      .catch(() => null);

    try {
      const result = await bridge.send('tx.claimFaucet', { amountUnits: units.toString() });
      await renderSuccess(result, before, units);
    } catch (error) {
      banner.set(error.message || 'The faucet claim failed.');
    }
  }

  async function renderSuccess(result, beforeBalance, requested) {
    clearBody();
    header.setTitle('Claimed');

    // Report the ACTUAL balance change, not just that the call returned. An RPC accepting a
    // submission is not the same as funds arriving.
    let delta = null;
    try {
      const after = BigInt((await bridge.send('tx.getAccountInfo', { address: account.address })).balance || '0');
      if (beforeBalance != null) delta = after - beforeBalance;
    } catch {
      // leave delta null and say so rather than implying a number
    }

    body.appendChild(h('div', { class: 'notice' }, [
      h('div', { class: 'row-flex' }, [
        icon('check', 16),
        h('strong', { text: delta != null && delta > 0n
          ? `Received ${delta} base units (${formatThru(delta)} THRU)`
          : 'Claim submitted' }),
      ]),
      h('p', { class: 'hint', text: delta != null && delta > 0n
        ? 'Confirmed by re-reading your balance.'
        : 'The balance has not changed yet. Faucet claims can take a moment, or this one may '
          + 'have been rate-limited.' }),
    ]));

    if (delta != null && delta !== requested && delta > 0n) {
      // Worth surfacing: it would mean the unit interpretation is not what we think.
      banner.set(
        `Asked for ${requested} base units but received ${delta}. Please report this — it would `
        + 'mean the faucet amount unit differs from what the wallet assumes.',
        'warning',
      );
    }

    if (result?.signature) {
      body.appendChild(h('div', { class: 'detail-table' }, [
        h('div', { class: 'detail-row' }, [
          h('span', { class: 'eyebrow', text: 'Signature' }),
          h('div', { class: 'detail-val mono', style: { wordBreak: 'break-all' }, text: result.signature }),
        ]),
      ]));
      const explorer = network?.explorerUrl ? `${network.explorerUrl}/tx/${result.signature}` : '';
      if (explorer) {
        body.appendChild(h('a', {
          class: 'btn secondary',
          href: explorer,
          target: '_blank',
          rel: 'noopener noreferrer',
        }, [icon('external', 14), h('span', { text: 'View on explorer' })]));
      }
    }

    body.appendChild(h('div', { class: 'screen-actions' }, [
      track(Button({
        label: 'Done',
        variant: 'primary',
        onClick: () => navigate('/dashboard', { replace: true }),
      })).el,
      track(Button({
        label: 'Claim again',
        variant: 'text',
        onClick: () => { header.setTitle('Faucet'); banner.clear(); renderForm(); },
      })).el,
    ]));
  }

  async function load() {
    banner.clear();
    try {
      const [active, net] = await Promise.all([
        bridge.send('account.getActive'),
        bridge.send('network.getActive'),
      ]);
      account = active;
      network = net;

      // A faucet needs both a program and a state account; testnet/mainnet declare neither.
      const hasFaucet = Boolean(net?.faucetProgramId && net?.faucetStateAccount);
      if (!hasFaucet) {
        renderNoFaucet();
        return;
      }
      // faucetMaxPerClaim crosses the port as a string, since JSON cannot carry BigInt.
      capUnits = net.faucetMaxPerClaim != null ? BigInt(net.faucetMaxPerClaim) : 10_000n;
      renderForm();
    } catch (error) {
      clearBody();
      banner.set(error.message || 'Could not load the faucet.');
    }
  }

  load();
  d.add(bridge.onEvent('networkChanged', () => load()));

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
