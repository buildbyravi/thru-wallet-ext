// History route — transaction list with filters.
//
// Replaces screens/history.js. Kept its filter chips, which the monolith lacked, and fixed:
//   - amounts and counterparties were interpolated into innerHTML
//   - pending transactions were invisible here. The backend tracks them, and a submitted
//     transfer that has not yet confirmed is exactly what a user opens History to look for.
//   - a failed entry rendered like any other. success:false is now stated.
//   - explorerTxUrl returns '' on a network with no explorer, so the link is omitted.
//   - uses the cursor form of tx.listHistory for "load more" rather than refetching a bigger page.

import { h, disposer } from '../../kit/dom.js';
import { icon } from '../../kit/icon.js';
import { Button } from '../../kit/button.js';
import { PageHeader, Banner, Spinner, Empty } from '../../kit/feedback.js';
import * as bridge from '../bridge.js';
import { formatThru, truncateAddress } from '../../../shared/format.js';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'sent', label: 'Sent' },
  { id: 'received', label: 'Received' },
  { id: 'faucet', label: 'Faucet' },
  { id: 'failed', label: 'Failed' },
];

export function HistoryRoute({ back }) {
  const d = disposer();
  const owned = [];
  let account = null;
  let network = null;
  let entries = [];
  let pending = [];
  let cursor = null;
  let activeFilter = 'all';

  function track(c) { owned.push(c); return c; }

  const banner = Banner({ tone: 'error' });
  const listHost = h('div', { class: 'list' });
  const pendingHost = h('div', { class: ['stack', 'stack-2', 'hidden'] });
  const filterRow = h('div', { class: 'row-flex wrap' });
  const moreHost = h('div', {});
  const header = PageHeader({ title: 'Activity', onBack: () => back() });

  const el = h('section', { class: 'screen' }, [
    header.el,
    banner.el,
    filterRow,
    pendingHost,
    listHost,
    moreHost,
  ]);

  // ---- Filters ------------------------------------------------------------
  for (const f of FILTERS) {
    const chip = h('button', {
      type: 'button',
      class: ['chip-option', f.id === activeFilter ? 'selected' : null].filter(Boolean),
      text: f.label,
    });
    d.on(chip, 'click', () => {
      activeFilter = f.id;
      for (const other of filterRow.children) other.classList.remove('selected');
      chip.classList.add('selected');
      paintList();
    });
    filterRow.appendChild(chip);
  }

  function matches(entry) {
    if (activeFilter === 'all') return true;
    if (activeFilter === 'failed') return entry.success === false;
    return entry.kind === activeFilter;
  }

  // ---- Rows ---------------------------------------------------------------
  function glyphFor(entry) {
    if (entry.success === false) return { name: 'x', cls: 'failed' };
    if (entry.kind === 'sent') return { name: 'send', cls: 'sent' };
    if (entry.kind === 'received') return { name: 'receive', cls: 'received' };
    if (entry.kind === 'faucet') return { name: 'faucet', cls: 'faucet' };
    return { name: 'info', cls: '' };
  }

  function describe(entry) {
    const amount = entry.amount != null ? formatThru(BigInt(entry.amount)) : null;
    const other = entry.counterparty ? truncateAddress(entry.counterparty) : null;
    if (entry.kind === 'sent') return amount ? `Sent ${amount} THRU${other ? ` to ${other}` : ''}` : 'Sent';
    if (entry.kind === 'received') return amount ? `Received ${amount} THRU${other ? ` from ${other}` : ''}` : 'Received';
    if (entry.kind === 'faucet') return amount ? `Claimed ${amount} THRU from the faucet` : 'Faucet claim';
    // Inventing a meaning for an unrecognised program would be worse than admitting it.
    return 'Unknown transaction';
  }

  function entryRow(entry) {
    const glyph = glyphFor(entry);
    const explorer = network?.explorerUrl && entry.signature
      ? `${network.explorerUrl}/tx/${entry.signature}`
      : '';

    const children = [
      h('span', { class: ['row-glyph', glyph.cls].filter(Boolean) }, icon(glyph.name, 14)),
      h('span', { class: 'row-body' }, [
        h('span', { class: 'row-title', text: describe(entry) }),
        h('span', { class: 'row-sub', text: entry.success === false
          ? 'Failed on-chain'
          : entry.signature ? truncateAddress(entry.signature) : '' }),
      ]),
    ];
    if (explorer) {
      children.push(h('a', {
        class: 'icon-btn icon-btn-ghost sm',
        href: explorer,
        target: '_blank',
        rel: 'noopener noreferrer',
        title: 'View on explorer',
        'aria-label': 'View on explorer',
      }, icon('external', 13)));
    }
    return h('div', { class: 'row' }, children);
  }

  function paintPending() {
    while (pendingHost.firstChild) pendingHost.removeChild(pendingHost.firstChild);
    const active = pending.filter((p) => p.status === 'submitted');
    pendingHost.classList.toggle('hidden', active.length === 0);
    if (!active.length) return;

    pendingHost.appendChild(h('header', { class: 'list-group-header' }, [
      h('span', { text: 'Pending' }),
      h('span', { class: 'list-group-count', text: String(active.length) }),
    ]));
    for (const p of active) {
      pendingHost.appendChild(h('div', { class: 'row' }, [
        h('span', { class: 'row-glyph pending' }, icon('spinner', 13, { className: 'spinning' })),
        h('span', { class: 'row-body' }, [
          h('span', { class: 'row-title', text: p.amountUnits
            ? `${p.kind === 'faucet' ? 'Claiming' : 'Sending'} ${formatThru(BigInt(p.amountUnits))} THRU`
            : 'Transaction in flight' }),
          h('span', { class: 'row-sub', text: 'Waiting for confirmation' }),
        ]),
      ]));
    }
  }

  function paintList() {
    while (listHost.firstChild) listHost.removeChild(listHost.firstChild);
    const shown = entries.filter(matches);

    if (!shown.length) {
      listHost.appendChild(Empty({
        iconName: 'history',
        title: activeFilter === 'all' ? 'No transactions yet' : 'Nothing matches this filter',
        body: activeFilter === 'all'
          ? 'Claim from the faucet or receive THRU to get started.'
          : 'Try a different filter.',
      }).el);
      return;
    }
    for (const entry of shown) listHost.appendChild(entryRow(entry));
  }

  function paintMore() {
    while (moreHost.firstChild) moreHost.removeChild(moreHost.firstChild);
    if (cursor == null) return;
    const moreBtn = track(Button({
      label: 'Load more',
      variant: 'text',
      onClick: () => load({ append: true }),
    }));
    moreHost.appendChild(moreBtn.el);
  }

  async function load({ append = false } = {}) {
    banner.clear();
    if (!append) {
      while (listHost.firstChild) listHost.removeChild(listHost.firstChild);
      listHost.appendChild(Spinner({ label: 'Loading activity' }).el);
    }
    try {
      if (!account) {
        [account, network] = await Promise.all([
          bridge.send('account.getActive'),
          bridge.send('network.getActive'),
        ]);
      }

      // Options form returns { entries, nextCursor, hasMore }; the positional form returns a
      // bare array. Using the cursor form means "load more" pages instead of refetching.
      const page = await bridge.send('tx.listHistory', {
        address: account.address,
        limit: 15,
        cursor: append ? cursor ?? 0 : 0,
      });

      const batch = Array.isArray(page) ? page : (page?.entries || []);
      cursor = Array.isArray(page) ? null : (page?.nextCursor ?? null);
      entries = append ? [...entries, ...batch] : batch;

      pending = await bridge.send('tx.getPending').catch(() => []);

      paintPending();
      paintList();
      paintMore();
    } catch (error) {
      while (listHost.firstChild) listHost.removeChild(listHost.firstChild);
      banner.set(error.message || 'Could not load activity.');
    }
  }

  load();

  d.add(
    bridge.onEvent('pendingTxChanged', ({ pending: next } = {}) => {
      pending = next || [];
      paintPending();
      // A settled transaction should appear in the list, not just vanish from Pending.
      load();
    }),
    bridge.onEvent('accountsChanged', () => { account = null; cursor = null; load(); }),
    bridge.onEvent('networkChanged', () => { account = null; cursor = null; load(); }),
  );

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
