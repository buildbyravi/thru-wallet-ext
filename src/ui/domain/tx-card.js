// Transaction card — the Rabby-inspired P1 render unit for Activity.
//
// One transaction per card: head carries the relative time on the left and the
// network + shortened signature + copy/explorer actions on the right; the body carries
// the method glyph and verb on the left and the signed, right-aligned amount delta on
// the right. Honesty rules carried over from the row era:
//   - a failed entry states it (badge + red glyph), never masquerades as a silent row;
//   - unrecognised programs render "Unknown transaction", never an invented protocol;
//   - token amounts keep their own decimals/symbol — never re-denominated into THRU;
//   - there is no per-transaction fee field on Thru's history wire today, so no fee line
//     is fabricated. The P2 detail sheet fetches what it can lazily and states the rest
//     as "Not available" — see src/ui/domain/tx-detail-sheet.js.
//
// P2: the card is now a real control. `onOpen` makes it an <article> carrying an explicit
// keyboard contract (tabindex + role="button" + Enter/Space), rather than a <div> with a
// click handler that a keyboard user cannot reach. The nested copy/explorer controls keep
// working because the open handler ignores events that originated inside them.

import { h, disposer } from '../kit/dom.js';
import { icon } from '../kit/icon.js';
import { CopyButton } from '../kit/button.js';
import { formatThru, formatTokenAmount, truncateAddress } from '../../shared/format.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Formatted time for the card head: YYYY/MM/DD HH:mm like Rabby, falling back to Block <slot>. */
export function relTime(ts, slot) {
  const t = Number(ts);
  if (Number.isFinite(t) && t > 0 && Number.isFinite(new Date(t).getTime())) {
    const d = new Date(t);
    const YYYY = d.getFullYear();
    const MM = String(d.getMonth() + 1).padStart(2, '0');
    const DD = String(d.getDate()).padStart(2, '0');
    const HH = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${YYYY}/${MM}/${DD} ${HH}:${mm}`;
  }
  return slot != null ? `Block ${slot}` : '';
}

/** Stable day key for sectioning: local-calendar day, not a rolling 24h window. */
export function dayKey(ts) {
  const t = Number(ts);
  if (!Number.isFinite(t) || t <= 0) return 'recent'; // no wall-clock time on the wire
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function dayLabel(ts) {
  return dayLabelForKey(dayKey(ts));
}

/** Human label for an already-resolved day key ('recent' → the honest catch-all). */
export function dayLabelForKey(key) {
  if (key === 'recent') return 'Activity';
  const now = dayKey(Date.now()), y = dayKey(Date.now() - 86400000);
  if (key === now) return 'Today';
  if (key === y) return 'Yesterday';
  const [, mm, dd] = key.split('-').map(Number);
  return `${dd} ${MONTHS[mm]}`;
}

function glyphFor(entry) {
  if (entry.success === false) return { name: 'x', cls: 'failed' };
  if (entry.kind === 'sent' || entry.kind === 'token-sent') return { name: 'send', cls: 'sent' };
  if (entry.kind === 'received' || entry.kind === 'token-received' || entry.kind === 'token-mint') {
    return { name: 'receive', cls: 'received' };
  }
  if (entry.kind === 'token-account-init') return { name: 'coins', cls: 'received' };
  if (entry.kind === 'faucet') return { name: 'faucet', cls: 'faucet' };
  return { name: 'info', cls: '' };
}

/** Token amounts carry their own decimals; throwing them through formatThru would mislabel. */
function tokenAmountText(entry) {
  if (entry.amount == null) return null;
  const decimals = Number.isInteger(entry.tokenDecimals) ? entry.tokenDecimals : 0;
  const formatted = formatTokenAmount(BigInt(entry.amount), decimals);
  return entry.tokenSymbol ? `${formatted} ${entry.tokenSymbol}` : `${formatted} base units`;
}

/** The verb for the card title: what DID this account do. */
function verbFor(entry) {
  switch (entry.kind) {
    case 'sent': return 'Send';
    case 'received': return 'Receive';
    case 'faucet': return 'Claim';
    case 'token-sent': return 'Send';
    case 'token-received': return 'Receive';
    case 'token-mint': return 'Mint';
    case 'token-transfer': return 'Token transfer';
    case 'token-account-init': return 'Create token account';
    default: return 'Unknown transaction'; // honesty, not guesswork
  }
}

/** Context line under the verb: counterparty or the honest origin note. */
function contextFor(entry, knownAccounts) {
  const localName = entry.counterparty && knownAccounts?.get?.(entry.counterparty);
  const other = localName || (entry.counterparty ? truncateAddress(entry.counterparty) : null);
  if (entry.kind === 'sent' || entry.kind === 'token-sent') return other ? `to ${other}` : '';
  if (entry.kind === 'received' || entry.kind === 'token-received') return other ? `from ${other}` : '';
  if (entry.kind === 'faucet') return 'from the faucet';
  return '';
}

/** Signed, right-aligned delta. Sends leave, receipts arrive; null for init/unknown. */
function deltaFor(entry) {
  const isTokenish = String(entry.kind || '').startsWith('token-') && entry.kind !== 'token-account-init';
  const amount = isTokenish ? tokenAmountText(entry) : (entry.amount != null ? `${formatThru(BigInt(entry.amount))} THRU` : null);
  if (entry.kind === 'sent' || entry.kind === 'token-sent') return amount ? { text: `-${amount}`, cls: 'sent' } : null;
  if (entry.kind === 'received' || entry.kind === 'token-received' || entry.kind === 'faucet'
      || entry.kind === 'token-mint' || entry.kind === 'token-transfer') {
    return amount ? { text: `+${amount}`, cls: 'positive' } : null;
  }
  return null;
}

function shortSignature(signature) {
  const s = String(signature || '');
  return s.length > 11 ? `${s.slice(0, 4)}…${s.slice(-4)}` : s;
}

/**
 * @param {object} opts
 * @param {object} opts.entry — decoded history entry (tx-service shape)
 * @param {object|null} opts.network — active network (label + explorerUrl when available)
 * @param {Function} [opts.onOpen] — called with the entry when the card is activated; its
 *   presence is what turns the card into a focusable control. Omit it and the card stays
 *   the inert P1 render unit, so nothing announces an affordance that does not exist.
 * @returns {{ el: HTMLElement, destroy(): void }}
 */
export function TxCard({ entry, network, knownAccounts, onOpen } = {}) {
  const glyph = glyphFor(entry);
  const delta = deltaFor(entry);
  const failed = entry.success === false;
  const owned = [];
  const d = disposer();
  const interactive = typeof onOpen === 'function';

  const head = h('div', { class: 'tx-card-head' }, [
    h('span', { class: 'tx-card-time', text: relTime(entry.timestamp, entry.slot) }),
    h('span', { class: 'tx-card-meta' }, (() => {
      const bits = [];
      if (network?.label) bits.push(h('span', { class: 'tx-card-net', text: network.label }));
      if (entry.signature) {
        bits.push(h('span', { class: 'tx-card-sig', text: shortSignature(entry.signature) }));
        const copy = CopyButton({
          getValue: () => String(entry.signature),
          title: 'Copy transaction signature',
        });
        copy.el.classList.add('sm', 'icon-btn-ghost');
        owned.push(copy);
        bits.push(copy.el);
      }
      const explorer = network?.explorerUrl && entry.signature
        ? `${network.explorerUrl}/tx/${entry.signature}` : '';
      if (explorer) {
        bits.push(h('a', {
          class: 'icon-btn icon-btn-ghost sm',
          href: explorer,
          target: '_blank',
          rel: 'noopener noreferrer',
          title: 'View on explorer',
          'aria-label': 'View on explorer',
        }, icon('external', 12)));
      }
      return bits;
    })()),
  ]);

  const titleRow = h('span', { class: 'tx-card-title' }, verbFor(entry));
  const sub = contextFor(entry, knownAccounts);

  const body = h('div', { class: 'tx-card-body' }, [
    h('span', { class: ['row-glyph', glyph.cls].filter(Boolean) }, icon(glyph.name, 14)),
    h('span', { class: 'tx-card-main' }, (() => {
      const pieces = [titleRow];
      if (failed) pieces.push(h('span', { class: 'tx-card-badge failed', text: 'Failed on-chain' }));
      if (sub) pieces.push(h('span', { class: 'tx-card-sub', text: sub }));
      return pieces;
    })()),
    h('span', { class: 'tx-card-amounts' }, delta
      ? [h('span', { class: ['tx-amount', 't-numeral', delta.cls].join(' '), text: delta.text })]
      : []),
  ]);

  const el = h(interactive ? 'article' : 'div', {
    class: ['tx-card', interactive ? 'tx-card-open' : null].filter(Boolean),
    ...(interactive
      ? {
        role: 'button',
        tabindex: '0',
        'aria-label': `${verbFor(entry)} — transaction details`,
      }
      : {}),
  }, [head, body]);

  if (interactive) {
    // The head holds a copy BUTTON and an explorer ANCHOR. Without this guard, clicking
    // either would also open the sheet — and worse, the explorer link would open a tab
    // behind a modal. Walk up from the event target to the card and bail if a real control
    // is in the way; `closest` is not used because the shim-tested kit stays on plain nodes.
    const cameFromControl = (target) => {
      for (let n = target; n && n !== el; n = n.parentNode) {
        const tag = String(n.localName || n.tagName || '').toLowerCase();
        if (tag === 'button' || tag === 'a') return true;
      }
      return false;
    };

    const open = () => { onOpen(entry); };

    d.on(el, 'click', (event) => {
      if (cameFromControl(event.target)) return;
      open();
    });

    // role="button" is a promise that Enter and Space activate it. This is what keeps that
    // promise; a div with only a click handler is invisible to a keyboard user.
    d.on(el, 'keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return;
      if (cameFromControl(event.target)) return;
      // Space scrolls the list otherwise, which is not what activating a control means.
      event.preventDefault?.();
      open();
    });
  }

  return {
    el,
    destroy() {
      for (const c of owned) c.destroy?.();
      owned.length = 0;
      d.dispose();
    },
  };
}
