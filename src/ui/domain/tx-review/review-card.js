// The ONE transaction review surface.
//
// Every feature renders its confirmation through this component. It knows nothing about
// sends, domains, swaps or faucets — it renders the canonical review envelope from
// `tx.prepareReview` (src/shared/tx-review/model.js) and the operation's decoder decides what
// appears. That is the structural reason a new operation type cannot ship its own screen,
// its own fee formatter, or its own risk vocabulary.
//
// Layout follows the proven Rabby hierarchy (origin/protocol identity, what-you-are-doing,
// balance change, details behind a disclosure, warnings last), rendered with Thru's own
// design tokens — no Rabby assets, marks or styling are reused.
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
//   - `decode === 'unknown'` renders as an explicit unrecognized transaction with raw data.

import { h, clear, disposer } from '../../kit/dom.js';
import { icon } from '../../kit/icon.js';
import { formatThru, formatTokenAmount } from '../../../shared/format.js';

function amountText(amountUnits, decimals, symbol) {
  if (amountUnits == null) return 'unknown';
  try {
    const units = BigInt(amountUnits);
    const text = Number(decimals) === 9 && symbol === 'THRU'
      ? formatThru(units)
      : formatTokenAmount(units, Number(decimals));
    return `${text} ${symbol}`;
  } catch {
    return `${amountUnits} ${symbol}`;
  }
}

function badge(text, extra = []) {
  return h('span', { class: ['badge', ...extra], text });
}

function section(title, children) {
  return h('div', { class: 'tx-review-section' }, [
    h('span', { class: 'tx-review-section-title', text: title }),
    ...children,
  ]);
}

function summaryTable(rows) {
  return h('div', { class: 'detail-table' }, rows.map((row) => h('div', { class: 'detail-row' }, [
    h('span', { class: 'eyebrow', text: row.label }),
    h('div', { class: ['detail-val', row.mono ? 'mono' : null, row.tone === 'negative' ? 'negative' : null].filter(Boolean) }, [
      ...(row.above ? [h('div', { class: 'hint', text: row.above })] : []),
      h('div', { class: row.mono ? 'detail-address' : null, text: row.value }),
    ]),
  ])));
}

function assetBox(asset, direction) {
  const negative = direction === 'out';
  return h('div', { class: ['balance-change-box', negative ? 'negative' : 'positive'] }, [
    h('div', { class: 'stack stack-1' }, [
      h('span', { class: 'eyebrow', text: negative ? 'Leaving this account' : 'Arriving in this account' }),
      h('div', { class: 'change-amount', text: amountText(asset.amountUnits, asset.decimals, asset.symbol) }),
      ...(asset.name ? [h('div', { class: 'hint', text: asset.name })] : []),
      ...(asset.note ? [h('div', { class: 'hint', text: asset.note })] : []),
    ]),
    badge(negative ? 'Out' : 'In', asset.verified ? [] : ['change-tag']),
  ]);
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
        h('span', { class: 'hint', text: warning.detail }),
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

    // ---- header: what this is, on which chain, from which account --------------------
    el.appendChild(h('div', { class: 'tx-review-head' }, [
      h('div', { class: 'stack stack-1' }, [
        h('span', { class: 'tx-review-eyebrow', text: known ? 'Transaction' : 'Unrecognized transaction' }),
        h('h2', { class: 'tx-review-title', text: r.operation.name }),
      ]),
      h('div', { class: 'tx-review-badges' }, [
        badge(r.network.label),
        badge(known ? 'Decoded' : 'Not decoded'),
        ...(r.network.isTestnet ? [badge('Testnet')] : []),
      ]),
    ]));

    if (r.operation.summary) {
      el.appendChild(h('p', { class: 'tx-review-sub muted', text: r.operation.summary }));
    }

    // ---- signing account + protocol identity ---------------------------------------
    el.appendChild(h('div', { class: 'tx-review-protocol' }, [
      h('div', { class: 'stack stack-1' }, [
        h('span', { class: 'tx-review-eyebrow', text: 'Signing account' }),
        h('div', { text: r.account.label || 'Active account' }),
        h('div', { class: 'mono detail-address', text: r.account.address }),
      ]),
      ...(r.protocol
        ? [h('div', { class: 'tx-review-protocol-right' }, [
          h('span', { class: 'tx-review-eyebrow', text: 'Interaction' }),
          h('div', { class: 'row-flex stack-2' }, [
            h('span', { text: r.protocol.name }),
            badge(r.protocol.verified ? 'Verified program' : 'Unverified program'),
          ]),
          ...(r.protocol.address
            ? [h('div', { class: 'mono detail-address', text: r.protocol.address })]
            : []),
          ...(r.protocol.source ? [h('div', { class: 'hint', text: r.protocol.source })] : []),
        ])]
        : []),
    ]));

    // ---- what you are doing --------------------------------------------------------
    if (r.summary.length) {
      el.appendChild(section('What you are doing', [summaryTable(r.summary)]));
    }

    // ---- assets --------------------------------------------------------------------
    if (r.assets.outgoing.length || r.assets.incoming.length) {
      el.appendChild(section('Balance change', [
        ...r.assets.outgoing.map((asset) => assetBox(asset, 'out')),
        ...r.assets.incoming.map((asset) => assetBox(asset, 'in')),
        h('div', { class: 'tx-review-row' }, [
          h('span', { class: 'tx-review-label', text: 'Balance after' }),
          h('span', { class: 'tx-review-val', text: 'Not available — no verified simulation' }),
        ]),
        h('div', { class: 'hint', text: r.assets.balanceAfterNote }),
      ]));
    }

    // ---- fee: estimate vs charged --------------------------------------------------
    const fee = r.assets.fee;
    el.appendChild(section('Network fee', [
      h('div', { class: 'tx-review-row' }, [
        h('span', { class: 'tx-review-label', text: 'Estimated fee' }),
        h('span', {
          class: 'tx-review-val mono',
          text: fee.supported ? amountText(fee.amountUnits, fee.decimals, fee.symbol) : 'Not quoted',
        }),
      ]),
      ...(fee.supported && fee.reserveUnits
        ? [h('div', { class: 'tx-review-row' }, [
          h('span', { class: 'tx-review-label', text: 'Reserve kept back' }),
          h('span', { class: 'tx-review-val mono', text: amountText(fee.reserveUnits, fee.decimals, fee.symbol) }),
        ])]
        : []),
      ...(fee.source ? [h('div', { class: 'tx-review-row' }, [
        h('span', { class: 'tx-review-label', text: 'Fee provenance' }),
        h('span', { class: 'tx-review-val', text: fee.source }),
      ])] : []),
      h('div', { class: 'tx-review-fee-note hint', text: fee.note }),
      h('div', { class: 'hint', text: 'The amount actually charged is reported in Activity only after the chain answers.' }),
    ]));

    // ---- simulation status ---------------------------------------------------------
    if (simulation.status !== 'supported') {
      el.appendChild(h('div', { class: 'tx-risk-box warning' }, [
        h('span', { class: 'risk-icon' }, icon('info', 16)),
        h('div', { class: 'risk-copy' }, [
          h('strong', { text: 'Simulation unavailable' }),
          h('span', {
            text: simulation.reason
              || 'This wallet cannot dry-run the transaction, so it shows only what it can prove.',
          }),
        ]),
      ]));
    }

    // ---- execution details (program, instructions, accounts, raw) ------------------
    const execution = r.execution;
    const detailChildren = [];
    if (execution.program) {
      detailChildren.push(h('div', { class: 'tx-review-row' }, [
        h('span', { class: 'tx-review-label', text: 'Program' }),
        h('span', { class: 'tx-review-val', text: execution.program.name }),
      ]));
      if (execution.program.address) {
        detailChildren.push(h('div', { class: 'mono detail-address', text: execution.program.address }));
      }
    }
    for (const instruction of execution.instructions) {
      detailChildren.push(h('div', { class: 'tx-review-row' }, [
        h('span', { class: 'tx-review-label', text: instruction.decoded ? 'Instruction' : 'Instruction (undecoded)' }),
        h('span', { class: 'tx-review-val', text: instruction.name }),
      ]));
      if (instruction.note) detailChildren.push(h('div', { class: 'hint', text: instruction.note }));
    }
    for (const account of execution.accounts) {
      detailChildren.push(h('div', { class: 'tx-review-row' }, [
        h('span', { class: 'tx-review-label', text: account.role }),
        h('span', { class: 'tx-review-val mono detail-address', text: account.address }),
      ]));
    }
    if (execution.raw) {
      detailChildren.push(h('div', { class: 'tx-review-row' }, [
        h('span', { class: 'tx-review-label', text: 'Raw instruction data' }),
        h('span', { class: 'tx-review-val', text: execution.raw.format.toUpperCase() }),
      ]));
      const raw = h('div', { class: 'tx-review-raw monospace-block hidden' }, [
        h('div', { text: execution.raw.data }),
        ...(execution.raw.note ? [h('div', { class: 'hint', text: execution.raw.note })] : []),
      ]);
      const toggle = h('button', {
        type: 'button',
        class: 'tx-review-disclosure-toggle',
        'aria-expanded': 'false',
        on: {
          click: () => {
            const open = raw.classList.contains('hidden');
            raw.classList.toggle('hidden', !open);
            toggle.setAttribute('aria-expanded', String(open));
            toggle.textContent = open ? 'Hide raw data' : 'Show raw data';
          },
        },
      }, 'Show raw data');
      detailChildren.push(toggle, raw);
    }
    if (detailChildren.length) el.appendChild(section('Execution details', detailChildren));

    // ---- warnings ------------------------------------------------------------------
    if (r.warnings.length) {
      el.appendChild(section('Warnings', r.warnings.map(warningBlock)));
    }

    // ---- acknowledgements ----------------------------------------------------------
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
