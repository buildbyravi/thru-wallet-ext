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
import { formatAssetAmount, shortenMiddle } from '../../../shared/format.js';

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

// A 46-character address in a table row pushes everything else out of the eye's path. The card
// shows first-six/last-four and keeps the whole address in Details (and behind the counterparty's
// tap-to-expand), which is enough to recognise an address without turning the card into a wall.
// The shortening itself is the shared one (src/shared/format.js) — only the widths are the card's.
function shortAddress(address) {
  return shortenMiddle(address, { head: 6, tail: 4 });
}

// "Network fee" on its own line: the quoted number with the honest hedging word in front of it
// ("about"), or the words that say there is no quote. The old copy appended an "estimated"
// suffix, which reads as a caveat on a number the wallet is quietly unsure about; "about" says
// the same thing in the place a person actually reads.
function feeRow(fee, assets) {
  const quoted = fee.supported && fee.amountUnits != null;
  if (!quoted) {
    // A token transfer pays the network fee in THRU even though the asset is the token, so
    // saying only "not confirmed" hides which currency is missing.
    const paidInOther = assets.outgoing[0] && assets.outgoing[0].symbol !== fee.symbol;
    return { label: 'Network fee', value: paidInOther ? 'not confirmed (paid in THRU)' : 'not confirmed' };
  }
  // A declared zero is a fact worth stating plainly; "about 0 THRU" reads like a rounding.
  if (String(fee.amountUnits) === '0') return { label: 'Network fee', value: 'none' };
  return {
    label: 'Network fee',
    value: `about ${amountText(fee.amountUnits, fee.decimals, fee.symbol)}`,
    mono: true,
  };
}

/** One row per asset leaving or arriving. The sign is part of the amount, never inferred. */
function movementRows(assets) {
  return [
    ...assets.outgoing.map((asset) => ({
      label: 'You pay', value: movementAmount(asset, 'out'), mono: true, tone: 'negative',
    })),
    ...assets.incoming.map((asset) => ({
      label: 'You receive', value: movementAmount(asset, 'in'), mono: true,
    })),
  ];
}

// The context line replaces six header badges: who is signing, on which network, said once.
function contextLine(review) {
  const account = review.account?.label || 'Active account';
  const network = review.network?.label || 'this network';
  // "From" is spelled out. The old Send review opened with a FROM Account row and the owner
  // missed it: a bare account name could be the sender or the recipient, and on the one screen
  // where that matters the wallet should not make the reader work it out.
  return `From ${account} \u00b7 ${network}${review.network?.isTestnet ? ' test network' : ''}`;
}

// Total is only arithmetic the wallet can actually do: one outgoing asset, an asset-denominated
// quote in the same currency. Otherwise there is no total — "25 LAB + fee (not quoted)" is a sum
// the wallet cannot perform dressed up as one.
function totalRow(assets) {
  const [out] = assets.outgoing;
  if (assets.outgoing.length !== 1) return null;
  const fee = assets.fee;
  if (!fee.supported || fee.amountUnits == null || fee.symbol !== out.symbol) return null;
  try {
    const units = (BigInt(out.amountUnits) + BigInt(fee.amountUnits)).toString();
    return { label: 'Total', value: amountText(units, out.decimals, out.symbol), mono: true };
  } catch {
    return null;
  }
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

    // ---- title, context, counterparty -----------------------------------------------
    // What am I doing (the title carries the verb AND the amount), on whose account and which
    // network (one line, not six badges), and to whom. Nothing technical above the fold.
    el.appendChild(h('div', { class: 'tx-review-head' }, [
      h('h2', { class: 'tx-review-title', text: r.operation.name }),
      h('div', { class: 'tx-review-context', text: contextLine(r) }),
    ]));

    // One sentence of plain language. For a decoded operation it explains the decision
    // ("No registration fee on the test registrar…"); for an undecoded one it is the warning
    // that the wallet cannot tell what the transaction does.
    if (r.operation.summary) {
      el.appendChild(h('p', { class: 'tx-review-sub muted', text: r.operation.summary }));
    }

    // ---- who it goes to ----------------------------------------------------------------
    // The WHOLE address, on the card, always. An earlier pass put it behind a tap; a nickname
    // (or a shortened address) alone cannot authorise an irreversible send, because it cannot
    // be compared against the address in the other wallet. The name is the headline, the
    // address is the evidence, and both are visible without opening anything.
    if (r.counterparty?.address) {
      const isSelf = r.counterparty.address === r.account?.address;
      // A faucet claim pays the account that is signing, so "To your account" is the one case
      // where the counterparty IS the user; saying "To Active account" would read as a transfer.
      const name = isSelf ? 'your account' : r.counterparty.label;
      el.appendChild(h('div', { class: 'tx-review-counterparty' }, [
        h('div', { class: 'tx-review-counterparty-label', text: name ? `To ${name}` : 'To' }),
        h('div', { class: 'tx-review-address mono', text: r.counterparty.address }),
      ]));
    }

    // ---- the money, and nothing else --------------------------------------------------
    // At most three rows: what leaves (or arrives), what the network charges for it, and the
    // total only when the wallet can actually add them up. Everything else — including a
    // registrar price that is not provably collected — stays out of this table.
    const movement = movementRows(r.assets);
    const moneyRows = [...movement, feeRow(fee, r.assets)];
    const total = totalRow(r.assets);
    if (total && total.value !== moneyRows[0]?.value) moneyRows.push(total);
    // An undecodable transaction has no amount and no provable fee: a table of two "unknown"
    // rows teaches the user nothing, so there is no money table at all.
    const moneyKnown = movement.length > 0 || (fee.supported && fee.amountUnits != null);
    if (moneyKnown && moneyRows.length) el.appendChild(detailTable(moneyRows));

    // Facts that are not money and not the title: current/new expiry, previous owner, and the
    // operation's own remainder. Deliberately a second, short table rather than mixed into the
    // money rows, so "what leaves my account" is never bracketed by dates.
    if (r.summary.length) el.appendChild(detailTable(r.summary));

    // ---- warnings: only what changes the decision ---------------------------------------
    // Short: a bold line and one sentence each. Two rules, and the first outranks the second:
    //   * a BLOCKING warning is never folded. It is the reason Confirm is unavailable, so it has
    //     to be readable without opening anything. A row budget must not outrank a safety fact.
    //   * advisory warnings are capped at two and folded into Details, because they change
    //     emphasis, not permission.
    const blocking = r.warnings.filter((w) => w.blocking || w.severity === 'danger');
    const advisory = r.warnings.filter((w) => !(w.blocking || w.severity === 'danger'));
    const onCard = [...blocking, ...advisory.filter((w) => w.severity === 'warning').slice(0, 2)];
    const folded = r.warnings.filter((w) => !onCard.includes(w));
    if (onCard.length) el.appendChild(h('div', { class: 'stack stack-2' }, onCard.map(warningBlock)));

    // A program the wallet has no record of is the one trust message that belongs above the fold:
    // it is the difference between a known operation and an arbitrary one. An UNDECODED
    // transaction already says so in its own blocking warning, so this does not repeat it.
    //
    // Identity, not audit. `verified` is a claim about a pinned address; it says nothing about
    // whether anyone audited the program. "Unrecognised" must therefore not be softened into
    // "trusted" (because a team runs it) nor hardened into "unaudited" — the two facts are
    // separate, and `protocol.trustNote` in Details is where the wallet states provenance it
    // actually knows.
    if (r.protocol && r.protocol.verified === false && r.operation.decode === 'decoded') {
      el.appendChild(warningBlock({
        severity: 'warning',
        title: 'Unrecognised program',
        detail: 'This wallet has no record of this program address. Continue only if you '
          + 'expected this operation.',
      }));
    }

    // ---- one disclosure for everything technical --------------------------------------
    // Still complete, still honest, and out of the way: program, instruction, accounts, fee
    // basis, simulation, and every caveat that was not decision-relevant. No repository paths
    // and no decision-record ids — a user cannot act on either.
    const details = [];
    // Who is signing, in full — name AND address. The context line names the account; a name
    // cannot stand in for the address the signature comes from, so both live here.
    if (r.account?.address) {
      details.push(detailRow(
        r.account.label ? `From · ${r.account.label}` : 'From',
        r.account.address,
        { mono: true },
      ));
    }
    if (r.execution.program) {
      details.push(detailRow('Program', r.execution.program.name));
      if (r.execution.program.address) {
        details.push(h('div', { class: 'mono tx-review-address', text: r.execution.program.address }));
      }
    }
    if (r.protocol?.trustNote) details.push(h('div', { class: 'hint', text: r.protocol.trustNote }));
    for (const instruction of r.execution.instructions) {
      details.push(detailRow('Instruction', instruction.name));
    }
    // The instruction's account list repeats addresses already stated on this card — source is
    // the signer, destination is the counterparty. Printing them again (Source, Destination) is
    // what made this panel read as a wall of 46-character strings; only NEW addresses survive.
    const stated = new Set([r.account?.address, r.counterparty?.address].filter(Boolean));
    for (const account of r.execution.accounts) {
      if (stated.has(account.address)) continue;
      details.push(detailRow(account.role, account.address, { mono: true }));
    }
    // Four distinct states, four distinct words. "Failed" must never read as "unavailable":
    // it is a blocking fact (the service adds the blocking warning; the card shows the same
    // verdict here so the two surfaces cannot disagree).
    const simulationLabel = {
      supported: 'Succeeded',
      failed: 'Failed — the network rejected this transaction in a preview',
      pending: 'Still running',
      unavailable: 'Not available',
    }[simulation.status] || 'Not available';
    details.push(detailRow('Simulation', simulationLabel));
    if (folded.length) {
      details.push(detailRow('Also noted', `${folded.length} more ${folded.length === 1 ? 'note' : 'notes'}`));
      for (const warning of folded) {
        details.push(h('div', { class: 'hint', text: `${warning.title} — ${warning.detail}` }));
      }
    }

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
      details.push(rawToggle, raw);
    }

    if (details.length) {
      // Known operations fold their details (they have a decision to make above them). An
      // UNDECODED transaction opens them: there the details ARE the review, and hiding the only
      // facts that exist behind a tap would be the opposite of honest.
      const openByDefault = !known;
      const panel = h('div', {
        class: ['stack', 'stack-2', 'tx-review-details', openByDefault ? null : 'hidden'].filter(Boolean),
        id: `tx-review-advanced-${instanceId}`,
      }, details);
      const toggle = h('button', {
        type: 'button',
        class: 'tx-review-disclosure-toggle',
        'aria-expanded': String(openByDefault),
        'aria-controls': `tx-review-advanced-${instanceId}`,
      }, openByDefault ? 'Hide details' : 'Details');
      d.on(toggle, 'click', () => {
        const open = panel.classList.contains('hidden');
        panel.classList.toggle('hidden', !open);
        toggle.setAttribute('aria-expanded', String(open));
        toggle.textContent = open ? 'Hide details' : 'Details';
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
