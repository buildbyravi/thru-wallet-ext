// The ONE transaction review surface.
//
// Every feature renders its confirmation through this component. It knows nothing about
// sends, domains, swaps or faucets — it renders the canonical review envelope from
// `tx.prepareReview` (src/shared/tx-review/model.js) and the operation's decoder decides what
// appears. That is the structural reason a new operation type cannot ship its own screen,
// its own fee formatter, or its own risk vocabulary.
//
// Layout follows the proven Rabby before-sign order, rendered with Thru's own design tokens —
// no Rabby assets, marks or styling are reused:
//
//   header (operation + network)  ->  program identity line  ->  value in/out  ->  ONE
//   label/value table (facts, estimated fee, total)  ->  warnings  ->  one collapsed
//   "Advanced details" disclosure (program address, instructions, account roles, fee
//   provenance, raw instruction data)  ->  acknowledgements.
//
// The owner's 2026-10-28 review: the first version stacked eleven sections, so a simple
// transfer read like a DeFi position and the Domain preview needed a scroll to answer
// "what am I signing?". Everything that is not part of that answer now lives one tap away,
// and nothing was moved OUT of the card — only behind the disclosure.
//
// Interaction contract:
//   const card = TxReviewCard({ review, onChange });
//   onChange({ canConfirm, acknowledgements }) fires whenever confirmability changes, so the
//   route's confirm button never re-derives validation itself.
//
// Rendering rules enforced here (not by each caller):
//   - `state === 'blocked'` disables confirmation; the wallet has PROVEN the operation fails.
//   - required acknowledgements must be ticked, and are passed to confirm.
//   - a missing fee / missing balance-after is printed as unavailable, never as 0.
//   - an estimate is labelled as an estimate; the charged amount is never predicted.
//   - `decode === 'unknown'` renders as an explicit unrecognized transaction, with the
//     advanced details OPEN, because the raw facts are then the only information there is.

import { h, clear, disposer } from '../../kit/dom.js';
import { icon } from '../../kit/icon.js';
import { formatAssetAmount } from '../../../shared/format.js';

// The decoder's displayAmount and this card render the same fee/amount numbers through the same
// shared formatter. "Unavailable" is a word, never a zero.
function amountText(amountUnits, decimals, symbol) {
  if (amountUnits == null) return 'unknown';
  try {
    return formatAssetAmount(amountUnits, decimals, symbol);
  } catch {
    return `${amountUnits} ${symbol}`;
  }
}

function badge(text, extra = []) {
  return h('span', { class: ['badge', ...extra], text });
}

// Rabby shows the value moving in and out as the number the user actually recognises. The sign
// is part of that: an outgoing amount must never be readable as a gain.
function movementAmount(asset, direction) {
  const amount = amountText(asset.amountUnits, asset.decimals, asset.symbol);
  if (amount === 'unknown') return amount;
  return `${direction === 'out' ? '\u2212' : '+'}${amount}`;
}

function movementBox(asset, direction) {
  const negative = direction === 'out';
  return h('div', { class: ['balance-change-box', negative ? 'negative' : 'positive'] }, [
    h('div', { class: 'stack stack-1' }, [
      h('span', { class: 'eyebrow', text: negative ? 'You pay' : 'You receive' }),
      h('div', { class: 'change-amount', text: movementAmount(asset, direction) }),
      ...(asset.name ? [h('div', { class: 'hint', text: asset.name })] : []),
      ...(asset.note ? [h('div', { class: 'hint', text: asset.note })] : []),
    ]),
  ]);
}

// The one label/value table on the card. Same component the old Send review used, so the
// screen the owner asked to get back is literally the same table, now decoder-driven.
function detailTable(rows) {
  return h('div', { class: 'detail-table' }, rows.map((row) => h('div', { class: 'detail-row' }, [
    h('span', { class: 'eyebrow', text: row.label }),
    h('div', { class: ['detail-val', row.mono ? 'mono' : null, row.tone === 'negative' ? 'negative' : null].filter(Boolean) }, [
      ...(row.above ? [h('div', { class: 'hint', text: row.above })] : []),
      h('div', { class: row.mono ? 'mono tx-review-address' : null, text: row.value }),
    ]),
  ])));
}

function detailRow(label, value, { mono = false } = {}) {
  return h('div', { class: 'tx-review-row' }, [
    h('span', { class: 'tx-review-label', text: label }),
    h('span', { class: ['tx-review-val', mono ? 'mono' : null].filter(Boolean), text: value }),
  ]);
}

// "Network fee" on its own line, Rabby-style: the number the wallet was quoted, marked as an
// estimate, or the word that says there is no quote.
function feeRow(fee) {
  // "Supported" without a number is still no quote: the label may never imply an amount the
  // wallet does not have.
  const quoted = fee.supported && fee.amountUnits != null;
  return {
    label: 'Network fee',
    value: quoted ? `${amountText(fee.amountUnits, fee.decimals, fee.symbol)} (estimated)` : 'Not quoted',
    mono: quoted,
  };
}

// Total is only arithmetic the wallet can actually do: one outgoing asset, an asset-denominated
// quote. Anything else keeps the amount and the fee visibly separate.
function totalRow(assets) {
  const [out] = assets.outgoing;
  if (assets.outgoing.length !== 1) return null;
  const fee = assets.fee;
  if (fee.supported && fee.amountUnits != null && fee.symbol === out.symbol) {
    try {
      const units = (BigInt(out.amountUnits) + BigInt(fee.amountUnits)).toString();
      return { label: 'Total', value: amountText(units, out.decimals, out.symbol), mono: true };
    } catch {
      return null;
    }
  }
  if (fee.supported && fee.amountUnits != null) {
    return {
      label: 'Total',
      value: `${amountText(out.amountUnits, out.decimals, out.symbol)} + ${amountText(fee.amountUnits, fee.decimals, fee.symbol)} fee`,
      mono: true,
    };
  }
  return {
    label: 'Total',
    value: `${amountText(out.amountUnits, out.decimals, out.symbol)} + fee (not quoted)`,
    mono: true,
  };
}

// The acknowledgement checkbox pairs a label with an input by id. Ids must be unique per
// document, and two preview panes (or a future multi-review surface) can mount two cards at
// once, so the id is namespaced per instance instead of per acknowledgement.
let instanceSeq = 0;

function warningBlock(warning) {
  const tone = warning.severity === 'info' ? 'notice' : `notice ${warning.severity === 'danger' ? 'danger' : 'warning'}`;
  return h('div', { class: tone }, [
    h('div', { class: 'row-flex top stack-2' }, [
      h('span', { class: 'risk-icon' }, icon(warning.severity === 'danger' ? 'warning' : 'info', 16)),
      h('div', { class: 'risk-copy' }, [
        h('strong', { text: warning.title }),
        ...(warning.detail ? [h('span', { class: 'hint', text: warning.detail })] : []),
      ]),
    ]),
  ]);
}

/**
 * @param {{ review: object, onChange?: Function }} props
 */
export function TxReviewCard({ review, onChange = null } = {}) {
  const d = disposer();
  const el = h('div', { class: 'tx-review-card' });
  const instanceId = ++instanceSeq;
  let state = review;
  const accepted = new Set();
  const ackInputs = [];

  function canConfirm() {
    if (!state || state.state === 'blocked') return false;
    const required = (state.acknowledgements ?? []).map((ack) => ack.id);
    return required.every((id) => accepted.has(id));
  }

  function notify() {
    onChange?.({ canConfirm: canConfirm(), acknowledgements: [...accepted] });
  }

  function paint() {
    clear(el);
    ackInputs.length = 0;
    const r = state;
    const simulation = r.simulation ?? { status: 'unavailable', reason: '', provenance: '' };
    const known = r.operation.decode === 'decoded';
    const fee = r.assets.fee;

    // ---- header: what this is, on which chain ---------------------------------------
    el.appendChild(h('div', { class: 'tx-review-head' }, [
      h('div', { class: 'stack stack-1' }, [
        h('span', { class: 'tx-review-eyebrow', text: known ? 'Transaction' : 'Unrecognized transaction' }),
        h('h2', { class: 'tx-review-title', text: r.operation.name }),
      ]),
      h('div', { class: 'tx-review-badges' }, [
        badge(r.network.label),
        ...(r.network.isTestnet ? [badge('Testnet')] : []),
        badge(known ? 'Decoded' : 'Not decoded'),
      ]),
    ]));

    // ---- program identity, one line --------------------------------------------------
    // Rabby's header tells you which site you are talking to. The Thru equivalent is the
    // program the transaction calls, with the wallet's own verdict on whether that address is
    // one it can vouch for. The address itself moved into the advanced details.
    if (r.protocol) {
      el.appendChild(h('div', { class: 'tx-review-origin' }, [
        h('span', { class: 'tx-review-origin-icon' }, icon(r.protocol.verified ? 'shield' : 'warning', 16)),
        h('div', { class: 'tx-review-origin-copy' }, [
          h('span', { class: 'tx-review-origin-name', text: r.protocol.name }),
          // The signing account by LABEL, not by address: the address is already a fact row on
          // every send (From) and on every other operation it is in the advanced details. Printing
          // it twice was the kind of duplication the owner's "too long" review was about.
          h('span', { class: 'hint', text: `Signing with ${r.account.label || 'the active account'}` }),
        ]),
        badge(r.protocol.verified ? 'Verified program' : 'Unverified program'),
      ]));
    }

    // ---- an undecoded transaction says so, in words, before anything else ------------
    if (!known && r.operation.summary) {
      el.appendChild(h('p', { class: 'tx-review-sub muted', text: r.operation.summary }));
    }

    // ---- value in / value out --------------------------------------------------------
    if (r.assets.outgoing.length || r.assets.incoming.length) {
      el.appendChild(h('div', { class: 'stack stack-2' }, [
        ...r.assets.outgoing.map((asset) => movementBox(asset, 'out')),
        ...r.assets.incoming.map((asset) => movementBox(asset, 'in')),
      ]));
      // Post-transaction balances stay unknown: Thru has no verified dry-run, and printing a
      // number here would be the same fabrication as inventing a simulated success.
      el.appendChild(h('div', { class: 'hint', text: r.assets.balanceAfterNote }));
    }

    // ---- the facts, in one table -----------------------------------------------------
    const rows = [...r.summary];
    rows.push(feeRow(fee));
    const total = totalRow(r.assets);
    if (total) rows.push(total);
    el.appendChild(detailTable(rows));

    // ---- warnings --------------------------------------------------------------------
    if (r.warnings.length) {
      el.appendChild(h('div', { class: 'stack stack-2' }, r.warnings.map(warningBlock)));
    }

    // ---- one disclosure for everything technical --------------------------------------
    // Nothing is hidden from the user, only folded: program address + provenance,
    // instructions, account roles, fee provenance, raw bytes, and why no balance is predicted.
    const details = [];
    if (r.execution.program) {
      details.push(detailRow('Program', r.execution.program.name));
      if (r.execution.program.address) {
        details.push(h('div', { class: 'mono tx-review-address', text: r.execution.program.address }));
      }
      if (r.execution.program.source) {
        details.push(h('div', { class: 'hint', text: r.execution.program.source }));
      }
    }
    if (r.protocol?.source && r.protocol.source !== r.execution.program?.source) {
      details.push(detailRow('Program provenance', r.protocol.source));
    }
    for (const instruction of r.execution.instructions) {
      details.push(detailRow(instruction.decoded ? 'Instruction' : 'Instruction (undecoded)', instruction.name));
      if (instruction.note) details.push(h('div', { class: 'hint', text: instruction.note }));
    }
    for (const account of r.execution.accounts) {
      details.push(detailRow(account.role, account.address, { mono: true }));
    }
    if (fee.source) details.push(detailRow('Fee provenance', fee.source));
    if (fee.supported && fee.reserveUnits) {
      details.push(detailRow('Reserve kept back',
        amountText(fee.reserveUnits, fee.decimals, fee.symbol), { mono: true }));
    }
    if (fee.note) details.push(h('div', { class: 'hint', text: fee.note }));
    details.push(h('div', { class: 'hint', text: 'The amount actually charged is reported in Activity only after the chain answers.' }));
    // Four distinct states, four distinct words. "Failed" must never read as "unavailable":
    // it is a blocking fact (the service adds the blocking warning; the card shows the same
    // verdict here so the two surfaces cannot disagree).
    const simulationLabel = {
      supported: 'Succeeded',
      failed: 'Failed — this transaction was rejected in simulation',
      pending: 'Still running',
      unavailable: 'Not available',
    }[simulation.status] || 'Not available';
    details.push(detailRow('Simulation', simulationLabel));
    details.push(h('div', { class: 'hint', text: simulation.reason
      || (simulation.status === 'supported'
        ? `Reported by ${simulation.provenance || 'the node'}.`
        : 'This wallet cannot dry-run the transaction, so it shows only what it can prove.') }));

    if (r.execution.raw) {
      const raw = h('div', { class: 'tx-review-raw monospace-block hidden', id: `tx-review-raw-${instanceId}` }, [
        h('div', { text: r.execution.raw.data }),
        ...(r.execution.raw.note ? [h('div', { class: 'hint', text: r.execution.raw.note })] : []),
      ]);
      const rawToggle = h('button', {
        type: 'button',
        class: 'tx-review-disclosure-toggle',
        'aria-expanded': 'false',
        'aria-controls': `tx-review-raw-${instanceId}`,
      }, 'Show raw data');
      d.on(rawToggle, 'click', () => {
        const open = raw.classList.contains('hidden');
        raw.classList.toggle('hidden', !open);
        rawToggle.setAttribute('aria-expanded', String(open));
        rawToggle.textContent = open ? 'Hide raw data' : 'Show raw data';
      });
      details.push(detailRow('Raw instruction data', r.execution.raw.format.toUpperCase()));
      details.push(rawToggle, raw);
    }

    if (details.length) {
      const panel = h('div', { class: ['stack', 'stack-2', 'tx-review-details', known ? 'hidden' : null].filter(Boolean), id: `tx-review-advanced-${instanceId}` }, details);
      const toggle = h('button', {
        type: 'button',
        class: 'tx-review-disclosure-toggle',
        'aria-expanded': String(!known),
        'aria-controls': `tx-review-advanced-${instanceId}`,
      }, known ? 'Advanced details' : 'Hide advanced details');
      d.on(toggle, 'click', () => {
        const open = panel.classList.contains('hidden');
        panel.classList.toggle('hidden', !open);
        toggle.setAttribute('aria-expanded', String(open));
        toggle.textContent = open ? 'Hide advanced details' : 'Advanced details';
      });
      el.appendChild(h('div', { class: 'stack stack-2' }, [toggle, panel]));
    }

    // ---- acknowledgements -------------------------------------------------------------
    for (const ack of r.acknowledgements) {
      const ackId = `tx-review-ack-${instanceId}-${ack.id}`;
      const input = h('input', { type: 'checkbox', id: ackId });
      ackInputs.push({ ack, input });
      d.on(input, 'change', () => {
        if (input.checked) accepted.add(ack.id);
        else accepted.delete(ack.id);
        notify();
      });
      el.appendChild(h('label', { class: 'checkbox-field tx-review-ack', for: ackId }, [
        input,
        h('span', { class: 'tx-review-ack-label', text: ack.label }),
      ]));
    }

    // ---- blocked -----------------------------------------------------------------------
    if (r.state === 'blocked') {
      el.appendChild(h('div', { class: 'notice danger' }, [
        h('div', { class: 'row-flex top stack-2' }, [
          h('span', { class: 'risk-icon' }, icon('warning', 16)),
          h('div', { class: 'risk-copy' }, [
            h('strong', { text: 'Signing is disabled' }),
            h('span', { class: 'hint', text: 'The wallet has established that this transaction cannot succeed. '
              + 'Resolve the warnings above and review it again.' }),
          ]),
        ]),
      ]));
    }
  }

  paint();
  notify();

  return {
    el,
    /** Replace the rendered review (e.g. after a re-prepare). */
    update(next) {
      state = next;
      // Acknowledgements are per-review facts: a tick for "send this duplicate anyway" must
      // never survive onto a different review.
      accepted.clear();
      paint();
      notify();
    },
    get review() {
      return state;
    },
    get acknowledgements() {
      return [...accepted];
    },
    canConfirm,
    destroy() {
      d.dispose();
      clear(el);
    },
  };
}
