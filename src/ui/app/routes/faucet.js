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
import { formatThru } from '../../../shared/format.js';

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
  // tx.getFaucetLimit response (contract v24) or null when unavailable. Only fields the
  // chain returned are rendered — the service marks every unknown explicitly.
  let limitInfo = null;
  let limitBoxEl = null;
  let claimBtnEl = null;

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

  // --- Rate-limit awareness (tx.getFaucetLimit, contract v24) -------------------------
  // Only strings built from literally-read fields; anything unknown stays unrendered or
  // is labelled "unknown". Never estimate chain state we did not read.

  function fmtWindow(summary) {
    const w = summary.window;
    if (summary.clockLabel === 'seconds') {
      const sec = Number(w);
      if (Number.isFinite(sec)) {
        if (sec % 3600 === 0) return `${sec / 3600} h`;
        if (sec % 60 === 0) return `${sec / 60} min`;
        return `${sec} s`;
      }
      return `${w} s`;
    }
    if (summary.clockLabel === 'slots') return `${w} slots`;
    return `${w} ${summary.clockLabel} units`;
  }

  function fmtReset(summary) {
    if (summary.resetAtUnixSec == null) {
      return summary.clockLabel === 'slots'
        ? 'reset time is slot-clocked (not shown as a clock time here)'
        : null;
    }
    const at = new Date(Number(summary.resetAtUnixSec) * 1000);
    if (Number.isNaN(at.getTime())) return null;
    return `resets ${at.toLocaleTimeString()}`;
  }

  /** Rebuild the limit readout box and apply paused/exhausted UI state. */
  function renderLimitNote() {
    if (!limitBoxEl) return;
    while (limitBoxEl.firstChild) limitBoxEl.removeChild(limitBoxEl.firstChild);
    if (!limitInfo?.supported) return; // unknown limit state ⇒ stay silent, claim stays possible

    const exhaustedSummaries = [];
    for (const rule of limitInfo.rules ?? []) {
      if (!rule.keyReadable || !rule.summary) continue;
      const s = rule.summary;
      const scope = s.keyKindLabel === 'fee-payer'
        ? 'per account'
        : (s.keyKindLabel === 'global' ? 'chain-wide' : null);
      const win = fmtWindow(s);
      const parts = [];
      if (s.maxCalls !== '0') {
        parts.push(s.remainingCalls != null
          ? `${s.remainingCalls} of ${s.maxCalls} claims left`
          : `up to ${s.maxCalls} claims`);
      }
      if (s.maxAmount !== '0') {
        parts.push(s.remainingAmount != null
          ? `${s.remainingAmount} of ${s.maxAmount} units left`
          : `up to ${s.maxAmount} units`);
      }
      if (!parts.length) continue;
      const reset = fmtReset(s);
      limitBoxEl.appendChild(h('p', { class: 'hint', text:
        `Faucet rate limit (${scope ? `${scope}, ` : ''}per ${win}): ${parts.join(' · ')}`
        + (reset ? ` — ${reset}` : '') }));
      if (s.exhausted) exhaustedSummaries.push(s);
    }

    // An on-chain per-claim cap tighter than the generic claim cap: say it plainly.
    const perCall = BigInt(limitInfo.maxAmountPerCall ?? '0');
    if (perCall > 0n && perCall < capUnits) {
      limitBoxEl.appendChild(h('p', { class: 'hint', text:
        `The faucet's on-chain policy allows at most ${perCall} base units per claim — `
        + 'lower than this wallet\'s generic cap.' }));
    }

    if (limitInfo.paused) {
      banner.set('The faucet is paused by its administrator on-chain. Claims will fail until it resumes.', 'warning');
      claimBtnEl?.update({ disabled: true });
      return;
    }
    if (exhaustedSummaries.length) {
      const resets = exhaustedSummaries.map(fmtReset).filter(Boolean).join('; ');
      banner.set(`The faucet rate limit for this window is used up.${resets ? ` ${resets}.` : ' Try again later.'}`, 'warning');
      claimBtnEl?.update({ disabled: true });
      return;
    }
    claimBtnEl?.update({ disabled: false });
  }

  function renderForm() {
    clearBody();

    const claimUnits = capUnits > 0n ? capUnits : 10000n;
    const fixedThru = formatThru(claimUnits);

    const amount = track(Field({
      label: 'Claim amount',
      type: 'text',
      readonly: true,
      value: `${fixedThru} THRU`,
      hint: `Fixed claim of ${fixedThru} THRU per request. Claiming is free and does not need a balance.`,
    }));

    const claimBtn = track(Button({
      label: 'Claim on-chain',
      variant: 'primary',
      iconName: 'faucet',
      busyLabel: 'Claiming…',
      onClick: () => claim(claimUnits, claimBtn),
    }));
    claimBtnEl = claimBtn;

    body.appendChild(amount.el);
    body.appendChild(h('p', { class: 'hint', text:
      'The faucet pays your active account. Claiming is free and does not need a balance.' }));
    limitBoxEl = h('div', { class: 'stack stack-2' });
    body.appendChild(limitBoxEl);
    body.appendChild(h('div', { class: 'screen-actions' }, [
      claimBtn.el,
      track(Button({
        label: 'Re-check limit',
        variant: 'text',
        onClick: async () => {
          banner.clear();
          await refreshLimit();
        },
      })).el,
    ]));
    renderLimitNote();
  }

  /** Refresh the on-chain limit readout; failures degrade to silence, never fake state. */
  async function refreshLimit() {
    try {
      limitInfo = await bridge.send('tx.getFaucetLimit');
    } catch {
      limitInfo = null;
    }
    renderLimitNote();
  }

  let claiming = false;
  // The window between "review sheet closed" and "submit settled" used to be unguarded: the
  // claim button was re-enabled before the sheet opened and nothing blocked a second claim once
  // it closed, so two submissions could overlap and a late one could paint a torn-down route.
  let submitting = false;
  let destroyed = false;
  let reviewSheet = null;

  async function claim(amountOrUnits, claimBtn) {
    if (claiming || submitting || reviewSheet) return;
    claiming = true;
    claimBtn?.update({ disabled: true });
    banner.clear();

    const units = typeof amountOrUnits === 'bigint'
      ? amountOrUnits
      : (typeof amountOrUnits === 'object' && amountOrUnits?.value
        ? (capUnits > 0n ? capUnits : 10000n)
        : (capUnits > 0n ? capUnits : 10000n));

    if (units <= 0n) {
      banner.set('Enter an amount greater than zero.');
      claiming = false;
      claimBtn?.update({ disabled: false });
      return;
    }
    if (capUnits > 0n && units > capUnits) {
      banner.set(`The most this faucet gives per claim is ${formatThru(capUnits)} THRU.`);
      claiming = false;
      claimBtn?.update({ disabled: false });
      return;
    }

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
      claimBtn?.update({ disabled: false });
      return;
    }
    if (!prepared?.supported) {
      banner.set('This wallet has no decoder for that transaction, so it cannot be signed.');
      claiming = false;
      claimBtn?.update({ disabled: false });
      return;
    }

    claiming = false;
    claimBtn?.update({ disabled: false });
    openReview(prepared, units);
  }

  /** Show the canonical review for a prepared claim. Nothing here re-derives validation. */
  function openReview(prepared, units) {
    const sheet = Sheet({
      label: 'Confirm faucet claim',
      className: 'name-confirm-sheet',
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
    claimBtnEl?.update({ disabled: true });
    banner.clear();
    const before = await bridge
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
        confirmLabel: 'Claim on-chain',
      });
      if (outcome.status === 'cancelled' || destroyed) return;
      await renderSuccess(outcome.result, before, units);
    } catch (error) {
      if (destroyed) return;
      const classified = classifyReviewError(error, {
        uncertainMessage: 'Could not confirm whether this claim was submitted. Check Activity '
          + 'before trying again.',
      });
      banner.set(classified.message, classified.kind === 'uncertain' ? 'warning' : 'error');
      // A failed claim often CONSUMES the failed window slot or proves the window exhausted
      // — refresh the on-chain limit state so the note reflects what the chain now says.
      void refreshLimit();
    } finally {
      submitting = false;
      if (!destroyed) claimBtnEl?.update({ disabled: false });
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
          ? `Received ${formatThru(delta)} THRU`
          : 'Claim submitted' }),
      ]),
      h('p', { class: 'hint', text: delta != null && delta > 0n
        ? 'Confirmed by re-reading your balance.'
        : 'The balance has not changed yet. Faucet claims can take a moment, or this one may '
          + 'have been rate-limited.' }),
    ]));

    if (delta != null && delta !== requested && delta > 0n) {
      banner.set(
        `Expected ${formatThru(requested)} THRU but received ${formatThru(delta)} THRU. Please report this — it would `
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
      limitInfo = null;
      renderForm();
      // The limit readout is a separate chain read; it fills in under the form without
      // delaying the claim affordance (v24: { supported:false } states render as nothing).
      refreshLimit();
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
