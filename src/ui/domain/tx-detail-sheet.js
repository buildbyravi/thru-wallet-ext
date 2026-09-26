// Transaction detail sheet — P2 of docs/HISTORY_REDESIGN_PLAN.md.
//
// Tapping a card in Activity opens this: the full signature with a copy action, an explorer
// link, and a label/value table of everything we can HONESTLY state about the transaction.
//
// THE HONESTY RULE, restated because it is the whole point of this component:
//
//   Every row is either a fact the chain gave us, or the literal words "Not available".
//   There is no third state. Nothing is interpolated from a neighbouring entry, nothing is
//   defaulted to a plausible number, and nothing borrows the local clock. A wallet that
//   guesses a fee is a wallet whose users act on a number that is not true.
//
// Two rows carry provenance in the row itself rather than relying on the reader to know:
//
//   Fee   — Thru's TransactionExecutionResult has NO charged-fee field (verified against the
//           generated protobuf; see docs/archive/TX_DETAIL_SPIKE.md §3.3). The only fee obtainable is
//           the one DECLARED IN THE HEADER by the sender. That is a different claim from
//           "what this cost you", so the row says which one it is. Absent => "Not available".
//   Time  — transactions carry no time; the containing BLOCK does, optionally. When the node
//           supplies it the row says "Block time"; when it does not, "Not available".
//
// Structure: overlay + .modal-card, the same primitives password-prompt.js uses, with the
// same focus-trap + disposer discipline — Tab wraps inside the dialog, Escape closes, focus
// returns to the card that opened it. Zero new DOM sinks; every node comes from h().
//
// The sheet paints SYNCHRONOUSLY from the entry the user tapped (so it never shows an empty
// box), then fills the lazy rows when tx.getDetail answers. A failed or unsupported fetch
// leaves those rows at "Not available" — it never blanks the facts already on screen.

import { h, disposer } from '../kit/dom.js';
import { icon } from '../kit/icon.js';
import { Button, CopyButton } from '../kit/button.js';
import { focusTrap } from '../kit/focus-trap.js';
import { formatThru, formatTokenAmount, truncateAddress } from '../../shared/format.js';

/** The one and only way this component says "we do not know". */
const UNKNOWN = 'Not available';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Absolute wall-clock rendering. Only ever called with a real timestamp from the chain. */
function absoluteTime(ms) {
  const t = Number(ms);
  if (!Number.isFinite(t) || t <= 0) return null;
  const d = new Date(t);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${hh}:${mm}:${ss}`;
}

/** Token amounts keep their own decimals; native amounts are THRU. Mirrors tx-card.js. */
function amountText(entry) {
  if (entry?.amount == null) return null;
  const kind = String(entry.kind || '');
  const isTokenish = kind.startsWith('token-') && kind !== 'token-account-init';
  if (isTokenish) {
    const decimals = Number.isInteger(entry.tokenDecimals) ? entry.tokenDecimals : 0;
    const formatted = formatTokenAmount(BigInt(entry.amount), decimals);
    return entry.tokenSymbol ? `${formatted} ${entry.tokenSymbol}` : `${formatted} base units`;
  }
  return `${formatThru(BigInt(entry.amount))} THRU`;
}

/** Signed delta text + tone, same semantics as the card so the two cannot disagree. */
function signedAmount(entry) {
  const amount = amountText(entry);
  if (!amount) return null;
  const kind = String(entry.kind || '');
  if (kind === 'sent' || kind === 'token-sent') return { text: `-${amount}`, cls: '' };
  if (kind === 'received' || kind === 'token-received' || kind === 'faucet'
      || kind === 'token-mint' || kind === 'token-transfer') {
    return { text: `+${amount}`, cls: 'positive' };
  }
  return { text: amount, cls: '' };
}

/** Verb for the sheet heading. Unrecognised programs stay unrecognised. */
function verbFor(entry) {
  switch (entry?.kind) {
    case 'sent': return 'Sent';
    case 'received': return 'Received';
    case 'faucet': return 'Faucet claim';
    case 'token-sent': return 'Token sent';
    case 'token-received': return 'Token received';
    case 'token-mint': return 'Token minted';
    case 'token-transfer': return 'Token transfer';
    case 'token-account-init': return 'Token account created';
    default: return 'Unknown transaction';
  }
}

/** "To"/"From" depending on direction; null when the kind has no counterparty semantics. */
function counterpartyLabel(entry) {
  const kind = String(entry?.kind || '');
  if (kind === 'sent' || kind === 'token-sent') return 'To';
  if (kind === 'received' || kind === 'token-received') return 'From';
  return 'Counterparty';
}

/**
 * One label/value row. Returns { el, set(value) } so the lazy fill updates by IDENTITY
 * rather than by index — a positional update is how the P1 day-header badge ended up inside
 * a transaction card, and that lesson applies here too.
 */
function DetailRow(label, initial = UNKNOWN, { mono = false, tone = '' } = {}) {
  const value = h('span', {
    class: ['detail-val', mono ? 'detail-sheet-mono' : null, tone || null].filter(Boolean),
    text: initial == null ? UNKNOWN : String(initial),
  });
  return {
    el: h('div', { class: 'detail-row' }, [
      h('span', { class: 'detail-label', text: label }),
      value,
    ]),
    set(next) {
      value.textContent = next == null || next === '' ? UNKNOWN : String(next);
    },
  };
}

/**
 * Open the detail sheet for one history entry.
 *
 * @param {object} options
 *   entry          the decoded history entry the user tapped (the sheet's source of truth
 *                  for everything the list already knew)
 *   network        active network — supplies the label and the explorer base URL
 *   knownAccounts  Map<address, label> so an own-wallet counterparty reads by name
 *   loadDetail     optional async (signature) => detail; omitted means no lazy fill at all,
 *                  and the lazily-sourced rows simply stay "Not available"
 * @returns {{ el: HTMLElement, update(): void, destroy(): void }}
 */
export function TxDetailSheet({ entry, network, knownAccounts, loadDetail, onClose } = {}) {
  const d = disposer();
  const owned = [];
  let trap = null;
  let closed = false;

  const signature = entry?.signature ? String(entry.signature) : '';

  function track(component) {
    owned.push(component);
    return component;
  }

  function close() {
    if (closed) return;
    closed = true;
    // Release the Tab trap FIRST so focus is restored to the card before the node leaves the
    // document — restoring afterwards lands on <body> and the user loses their place.
    trap?.destroy();
    trap = null;
    for (const c of owned) c.destroy?.();
    owned.length = 0;
    d.dispose();
    overlay.remove();
    onClose?.();
  }

  // ---- Head: verb + status, then the full signature -------------------------
  const failed = entry?.success === false;
  const statusText = entry?.success === true ? 'Succeeded'
    : entry?.success === false ? 'Failed on-chain'
      : UNKNOWN; // null = the node returned no execution result; that is not "succeeded"

  const closeBtn = track(Button({
    label: 'Close',
    variant: 'text',
    onClick: () => close(),
  }));

  const head = h('div', { class: 'modal-head' }, [
    h('span', { class: ['modal-icon', failed ? 'danger' : ''].filter(Boolean) },
      icon(failed ? 'warning' : 'history', 18)),
    h('h2', { text: verbFor(entry) }),
  ]);

  // The full signature is shown in full, not truncated: this sheet is where a user comes to
  // copy or verify it. A signature is public data — it is not a secret and never goes in the
  // URL (see the explorer link below, which is the only place it appears in a href).
  const sigCopy = track(CopyButton({
    getValue: () => signature,
    title: 'Copy transaction signature',
  }));
  sigCopy.el.classList.add('sm', 'icon-btn-ghost');

  const signatureBlock = h('div', { class: 'tx-sheet-sig' }, [
    h('span', { class: 'detail-label', text: 'Signature' }),
    h('div', { class: 'tx-sheet-sig-value' }, [
      h('code', { class: 'detail-sheet-mono', text: signature || UNKNOWN }),
      signature ? sigCopy.el : null,
    ].filter(Boolean)),
  ]);

  // ---- Rows -----------------------------------------------------------------
  const delta = signedAmount(entry);
  const localName = entry?.counterparty && knownAccounts?.get?.(entry.counterparty);
  const counterparty = entry?.counterparty
    ? (localName || truncateAddress(entry.counterparty))
    : null;

  const rows = [];
  const push = (row) => { rows.push(row); return row; };

  const statusRow = push(DetailRow('Status', statusText, { tone: failed ? 'negative' : '' }));
  push(DetailRow('Amount', delta?.text ?? UNKNOWN, { mono: true, tone: delta?.cls || '' }));
  // A faucet claim or a token-account init has no counterparty to speak of. Printing
  // "To: Not available" for those would imply a missing fact rather than an absent concept,
  // so the row is omitted entirely — but only when the decoder genuinely supplied none.
  if (counterparty) {
    push(DetailRow(counterpartyLabel(entry), counterparty, { mono: !localName }));
  }
  push(DetailRow('Network', network?.label || UNKNOWN));
  push(DetailRow('Block', entry?.slot != null ? String(entry.slot) : UNKNOWN, { mono: true }));

  // Lazily filled. They start at "Not available" and only ever move to a real value — so a
  // failed fetch leaves the honest state rather than degrading to one.
  const timeRow = push(DetailRow('Block time', UNKNOWN));
  const feeRow = push(DetailRow('Fee (declared)', UNKNOWN, { mono: true }));
  const programRow = push(DetailRow('Program', entry?.programAddress
    ? truncateAddress(entry.programAddress) : UNKNOWN, { mono: true }));

  const table = h('div', { class: 'detail-table' }, rows.map((r) => r.el));

  // Provenance, stated in the sheet rather than assumed known. This is the sentence that
  // stops "Fee (declared)" from being read as "what you paid".
  const feeNote = h('p', {
    class: 'tx-sheet-note',
    text: 'Fee shown is the amount declared in the transaction header. Thru\'s execution '
      + 'result carries no charged-fee field, so the amount actually debited is not '
      + 'reported by the network.',
  });

  const explorerUrl = network?.explorerUrl && signature
    ? `${network.explorerUrl}/tx/${signature}`
    : '';
  const explorerLink = explorerUrl
    ? h('a', {
      class: 'btn text w-100',
      href: explorerUrl,
      target: '_blank',
      rel: 'noopener noreferrer',
    }, [icon('external', 14), h('span', { text: 'View on explorer' })])
    : null;

  const card = h('div', {
    class: 'modal-card tx-sheet',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': `Transaction detail: ${verbFor(entry)}`,
  }, [
    head,
    signatureBlock,
    table,
    feeNote,
    h('div', { class: 'stack stack-2' }, [explorerLink, closeBtn.el].filter(Boolean)),
  ]);

  const overlay = h('div', { class: 'modal-overlay tx-sheet-overlay' }, card);

  // Backdrop click closes; a click inside must not.
  d.on(overlay, 'mousedown', (event) => {
    if (event.target === overlay) close();
  });

  trap = focusTrap(card, { onEscape: () => close() });

  document.body.appendChild(overlay);
  requestAnimationFrame(() => {
    overlay.classList.add('open');
    trap?.focusFirst();
  });

  // ---- Lazy fill -------------------------------------------------------------
  if (typeof loadDetail === 'function' && signature) {
    Promise.resolve(loadDetail(signature)).then((detail) => {
      // The sheet may already be gone: a late answer must not resurrect a closed dialog.
      if (closed || !detail) return;
      // { supported: false } is a first-class answer, not an error to swallow. The rows it
      // could have filled stay at "Not available", which is already what they say.
      if (detail.supported === false) return;

      if (Number.isFinite(detail.blockTimeMs) && detail.blockTimeMs > 0) {
        timeRow.set(absoluteTime(detail.blockTimeMs));
      }
      if (detail.feeDeclaredUnits != null) {
        feeRow.set(`${formatThru(BigInt(detail.feeDeclaredUnits))} THRU`);
      }
      if (detail.programAddress) programRow.set(truncateAddress(detail.programAddress));
      // The detail fetch is authoritative about status: a list entry decoded before the
      // execution result landed can carry success: null where the detail knows better.
      if (detail.success === true) statusRow.set('Succeeded');
      else if (detail.success === false) statusRow.set('Failed on-chain');
    }).catch(() => {
      // Unreachable node: the rows keep saying "Not available", which remains true.
    });
  }

  return {
    el: overlay,
    /** Present for the kit's { el, update, destroy } contract; the sheet is per-open. */
    update() {},
    destroy() {
      close();
    },
  };
}
