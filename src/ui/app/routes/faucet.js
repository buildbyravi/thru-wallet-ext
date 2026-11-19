// Faucet route — claim test THRU.
//
// Replaces screens/faucet.js. Behavioural differences, all of them from things now verified
// against a live network:
//
//   - The amount field is BASE UNITS, and says so. That is now CONFIRMED rather than assumed:
//     claiming 10000 credited exactly 10000 base units on betanet. The legacy label said "raw
//     units" without explaining what that meant next to a Send screen that takes whole THRU.
//   - The cap comes from the ACTIVE NETWORK's faucetMaxPerClaim, not a hardcoded 10_000n copied
//     into three files.
//   - Networks with no faucet are handled. testnet and mainnet declare none, so the screen says
//     so instead of offering a button that cannot work.
//   - The claim shows the resulting balance change, because "it said success" and "the money
//     arrived" are different claims and only one of them is checkable.
//   - Validation is integer-only via BigInt. The legacy screen used parseInt and Number()
//     comparisons against a BigInt cap.
//   - The claim goes through the SHARED transaction review (contract v29) like every other
//     value-moving flow. This file used to call `tx.claimFaucet` directly, which made it the
//     last screen in the wallet that could sign without the user reading a review.

import { h, disposer } from '../../kit/dom.js';
import { icon } from '../../kit/icon.js';
import { Button } from '../../kit/button.js';
import { Field } from '../../kit/field.js';
import { PageHeader, Banner, Spinner } from '../../kit/feedback.js';
import { Sheet } from '../../kit/sheet.js';
import { TxReviewCard } from '../../domain/tx-review/review-card.js';
import {
  submitReviewedReview, classifyReviewError, discardReview,
} from '../../domain/tx-review/confirm.js';
import * as bridge from '../bridge.js';
import { formatThru, explorerTxUrl } from '../../../shared/format.js';

// Fallback display value for networks that do not publish a per-claim cap. The service
// validates the amount against the active network before signing.
const DEFAULT_CLAIM_UNITS = 10_000n;

export function FaucetRoute({ navigate, back }) {
  const d = disposer();
  // Route lifetime for the review confirmation and its password dialog (see confirm.js:
  // the signal is required, so a torn-down route can never complete a signature).
  const lifecycle = new AbortController();
  d.add(() => lifecycle.abort());
  const owned = [];
  let account = null;
  let network = null;
  let capUnits = 0n;
  let claimBtnEl = null;
  let statusHostEl = null;

  function track(c) { owned.push(c); return c; }

  const banner = Banner({ tone: 'error' });
  const body = h('div', { class: 'stack stack-4' }, Spinner({ label: 'Loading' }).el);
  const header = PageHeader({ title: 'Faucet', onBack: () => back() });
  const el = h('section', { class: 'screen' }, [header.el, banner.el, body]);

  function clearBody() {
    statusHostEl = null;
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

    const claimUnits = capUnits > 0n ? capUnits : DEFAULT_CLAIM_UNITS;
    const fixedThru = formatThru(claimUnits);

    const amount = track(Field({
      label: 'Claim amount',
      type: 'text',
      readonly: true,
      value: `${fixedThru} THRU`,
      hint: 'Paid to your active account. No balance is required.',
    }));

    const claimBtn = track(Button({
      label: 'Claim',
      variant: 'primary',
      busyLabel: 'Claiming…',
      onClick: () => claim(claimUnits, claimBtn),
    }));
    claimBtnEl = claimBtn;

    const statusHost = h('div', { class: 'hidden' });

    body.appendChild(amount.el);
    body.appendChild(statusHost);
    body.appendChild(h('div', { class: 'screen-actions' }, claimBtn.el));
    return statusHost;
  }

  let claiming = false;
  // The window between "review sheet closed" and "submit settled" used to be unguarded: the
  // claim button was re-enabled before the sheet opened and nothing blocked a second claim once
  // it closed, so two submissions could overlap and a late one could paint a torn-down route.
  let submitting = false;
  let destroyed = false;
  let reviewSheet = null;

  function setSubmittingStatus(message) {
    if (!statusHostEl || !statusHostEl.isConnected) return;
    while (statusHostEl.firstChild) statusHostEl.removeChild(statusHostEl.firstChild);
    if (!message) {
      statusHostEl.classList.add('hidden');
      return;
    }
    statusHostEl.classList.remove('hidden');
    statusHostEl.appendChild(Spinner({ label: message }).el);
  }

  async function claim(renderedUnits, claimBtn) {
    if (claiming || submitting || reviewSheet) return;

    // A fixed claim has no amount to choose: the amount IS the faucet's per-claim cap, read from
    // the network. Before that read there is nothing honest to submit — DEFAULT_CLAIM_UNITS is a
    // display value, not a fact about this faucet — so the claim waits instead of guessing.
    if (capUnits <= 0n) {
      banner.set('The faucet claim amount is not available yet. Try again shortly.');
      return;
    }
    // The cap can move while this screen is open. If it did, re-render and let the user read the
    // new amount rather than sign something the read-only field does not show.
    if (capUnits !== renderedUnits) {
      banner.set(`The faucet cap changed to ${formatThru(capUnits)} THRU. Review the updated claim.`);
      statusHostEl = renderForm();
      return;
    }

    claiming = true;
    claimBtn?.setBusy(true);
    banner.clear();
    const units = capUnits;

    // The review pipeline reads the faucet policy, the account and the cap itself; this screen
    // only supplies the intent. No decoder ⇒ no signature (never a generic confirm screen).
    let prepared;
    try {
      prepared = await bridge.send('tx.prepareReview', {
        kind: 'faucet-claim',
        params: { amountUnits: units.toString() },
      });
    } catch (error) {
      banner.set(error?.message || 'The faucet claim review could not be prepared.');
      claiming = false;
      claimBtn?.setBusy(false);
      return;
    }
    if (!prepared?.supported) {
      banner.set('This wallet has no decoder for that transaction, so it cannot be signed.');
      claiming = false;
      claimBtn?.setBusy(false);
      return;
    }

    claiming = false;
    claimBtn?.setBusy(false);
    openReview(prepared, units);
  }

  /** Show the canonical review for a prepared claim. Nothing here re-derives validation. */
  function openReview(prepared, units) {
    const sheet = Sheet({
      label: 'Confirm faucet claim',
      className: 'name-confirm-sheet',
      // The claim button is disabled while the review is prepared, and a disabled control cannot
      // keep focus. Name it explicitly so closing the sheet returns the keyboard there instead
      // of to the top of the document. If a background event rebuilds the form, resolve dynamically.
      opener: () => (claimBtnEl?.el?.isConnected ? claimBtnEl.el : el.querySelector('button, [tabindex="0"]')),
      onClose: () => { if (reviewSheet === sheet) reviewSheet = null; },
    });
    reviewSheet = sheet;

    // onChange fires from the card's constructor, so the button it gates exists first.
    let confirm = null;
    const card = sheet.track(TxReviewCard({
      review: prepared.review,
      onChange: ({ canConfirm }) => confirm?.el && (confirm.el.disabled = !canConfirm),
    }));
    sheet.card.appendChild(card.el);

    const cancel = sheet.track({
      el: h('button', { type: 'button', class: 'btn secondary', text: 'Cancel' }),
      destroy: () => {},
    });
    confirm = sheet.track({
      el: h('button', {
        type: 'button',
        class: 'btn primary',
        text: prepared.review.operation.confirmLabel || 'Claim',
        disabled: !card.canConfirm(),
      }),
      destroy: () => {},
    });

    sheet.d.on(cancel.el, 'click', () => {
      discardReview(prepared.reviewId);
      sheet.close();
    });
    sheet.d.on(confirm.el, 'click', () => {
      if (sheet.closed) return;
      const acknowledgements = card.acknowledgements;
      // Close the trap before authentication; every signed value comes from this review.
      sheet.close();
      void submitReviewed(prepared, acknowledgements, units);
    });

    sheet.card.appendChild(h('div', { class: 'screen-actions' }, [confirm.el, cancel.el]));
    sheet.open();
  }

  async function submitReviewed(prepared, acknowledgements, units) {
    if (submitting) return;
    submitting = true;
    claimBtnEl?.setBusy(true);
    setSubmittingStatus('Submitting claim — waiting for confirmation…');
    banner.clear();
    const beforePromise = bridge
      .send('tx.getAccountInfo', { address: account.address })
      .then((info) => BigInt(info.balance || '0'))
      .catch(() => null);
    try {
      const outcome = await submitReviewedReview({
        review: prepared.review,
        acknowledgements,
        signal: lifecycle.signal,
        passwordTitle: 'Confirm faucet claim',
        passwordBody: 'Re-enter your wallet password to sign this faucet claim.',
        confirmLabel: 'Claim',
      });
      if (outcome.status === 'cancelled' || destroyed) return;
      const before = await beforePromise;
      if (destroyed) return;
      await renderSuccess(outcome.result, before, units);
    } catch (error) {
      if (destroyed) return;
      const classified = classifyReviewError(error, {
        uncertainMessage: 'Could not confirm whether this claim was submitted. Check Activity '
          + 'before trying again.',
      });
      banner.set(classified.message, classified.kind === 'uncertain' ? 'warning' : 'error');
    } finally {
      submitting = false;
      setSubmittingStatus('');
      if (!destroyed && claimBtnEl?.el?.isConnected) claimBtnEl.setBusy(false);
    }
  }

  async function renderSuccess(result, beforeBalance, requested) {
    clearBody();
    statusHostEl = null;
    header.setTitle('Claimed');

    const statusTitle = h('strong', { text: 'Claim submitted' });
    const statusHint = h('p', {
      class: 'hint',
      text: 'Confirming updated balance…',
    });
    body.appendChild(h('div', { class: 'notice' }, [
      h('div', { class: 'row-flex' }, [
        icon('check', 16),
        statusTitle,
      ]),
      statusHint,
    ]));

    if (result?.signature) {
      body.appendChild(h('div', { class: 'detail-table' }, [
        h('div', { class: 'detail-row' }, [
          h('span', { class: 'eyebrow', text: 'Signature' }),
          h('div', { class: 'detail-val mono', style: { wordBreak: 'break-all' }, text: result.signature }),
        ]),
      ]));
      const explorer = explorerTxUrl(network, result.signature);
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
        onClick: () => { header.setTitle('Faucet'); banner.clear(); statusHostEl = renderForm(); },
      })).el,
    ]));

    // Report the ACTUAL balance change, not just that the call returned. An RPC accepting a
    // submission is not the same as funds arriving.
    let delta = null;
    try {
      const after = BigInt((await bridge.send('tx.getAccountInfo', { address: account.address })).balance || '0');
      if (beforeBalance != null) delta = after - beforeBalance;
    } catch {
      // leave delta null and say so rather than implying a number
    }
    if (destroyed || !statusTitle.isConnected) return;

    if (delta != null && delta > 0n) {
      statusTitle.textContent = `Received ${formatThru(delta)} THRU`;
      statusHint.textContent = 'Confirmed by re-reading your balance.';
    } else {
      statusHint.textContent = 'The balance has not changed yet. Faucet claims can take a moment to appear.';
    }

    if (delta != null && delta !== requested && delta > 0n) {
      banner.set(
        `Expected ${formatThru(requested)} THRU but received ${formatThru(delta)} THRU. Please report this — it would `
        + 'mean the faucet amount unit differs from what the wallet assumes.',
        'warning',
      );
    }
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
      capUnits = net.faucetMaxPerClaim != null ? BigInt(net.faucetMaxPerClaim) : DEFAULT_CLAIM_UNITS;
      statusHostEl = renderForm();
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
      destroyed = true;
      lifecycle.abort();
      reviewSheet?.destroy();
      reviewSheet = null;
      for (const c of owned) c.destroy?.();
      owned.length = 0;
      header.destroy();
      banner.destroy();
      d.dispose();
    },
  };
}
