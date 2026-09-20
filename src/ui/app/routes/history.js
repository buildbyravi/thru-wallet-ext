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
import { formatThru } from '../../../shared/format.js';
import { TxCard, dayKey, dayLabel } from '../../domain/tx-card.js';

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
  let knownAccounts = new Map();
  let entries = [];
  let pending = [];
  let feedSynced = true;
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
    // Token sends/receives group under the same chips as native ones — from the user's
    // perspective "Sent" means value left this account, whatever it was denominated in.
    if (activeFilter === 'sent') return entry.kind === 'sent' || entry.kind === 'token-sent';
    if (activeFilter === 'received') return entry.kind === 'received' || entry.kind === 'token-received';
    return entry.kind === activeFilter;
  }

  // ---- Day-grouped cards (P1) ---------------------------------------------
  // Row-era rendering (describe/glyphFor/entryRow) is gone: tx-card.js owns the card.
  function paintPending() {
    while (pendingHost.firstChild) pendingHost.removeChild(pendingHost.firstChild);
    // Belt-and-braces with the reconcile-on-view above: a signature the history list already
    // displays as confirmed is never ALSO a Waiting... row, whatever the timing window.
    const displayed = new Set((entries || [])
      .map((e) => String(e?.signature || ''))
      .filter(Boolean));
    const active = pending.filter((p) => p.status === 'submitted'
      && !displayed.has(String(p.signature)));
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
            ? (p.displayAmount
                ? `${p.kind === 'faucet' ? 'Claiming' : 'Sending'} ${p.displayAmount}`
                : `${p.kind === 'faucet' ? 'Claiming' : 'Sending'} ${formatThru(BigInt(p.amountUnits))} THRU`)
            : 'Transaction in flight' }),
          h('span', { class: 'row-sub', text: 'Waiting for confirmation' }),
        ]),
      ]));
    }
  }

  const cards = [];
  function paintList() {
    // Cards own kit components (signature CopyButton), so they must be destroyed with the
    // same rigor as every other owned component — per repaint, not only at teardown.
    for (const c of cards) c.destroy?.();
    cards.length = 0;
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

    // Entries are newest-first, so day boundaries appear in order: compare against the
    // previous entry's local-calendar day and open a section whenever it changes.
    let lastKey = null;
    let currentHeader = null;
    let sectionCount = 0;
    for (const entry of shown) {
      const key = dayKey(entry.timestamp);
      if (key !== lastKey) {
        // Positional access (listHost.lastChild) was the shipped bug: at a day boundary
        // that node is the previous section's LAST CARD, so its count badge ended up
        // inside a transaction card. Identity reference always: the header, by name.
        if (currentHeader) {
          currentHeader.appendChild(h('span', { class: 'list-group-count', text: String(sectionCount) }));
        }
        currentHeader = h('header', { class: 'list-group-header' }, [
          h('span', { text: dayLabel(entry.timestamp) }),
        ]);
        listHost.appendChild(currentHeader);
        lastKey = key;
        sectionCount = 0;
      }
      const card = TxCard({ entry, network, knownAccounts });
      cards.push(card);
      listHost.appendChild(card.el);
      sectionCount += 1;
    }
    if (currentHeader) {
      currentHeader.appendChild(h('span', { class: 'list-group-count', text: String(sectionCount) }));
    }
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
        const [activeAcc, activeNet, accountList] = await Promise.all([
          bridge.send('account.getActive'),
          bridge.send('network.getActive'),
          bridge.send('account.list').catch(() => []),
        ]);
        account = activeAcc;
        network = activeNet;
        // Cards resolve a counterparty that is another account in THIS wallet by name
        // ("to Alice") instead of a truncated address — sends between own accounts read right.
        knownAccounts = new Map(
          (Array.isArray(accountList) ? accountList : [])
            .filter((a) => a?.address)
            .map((a) => [a.address, a.label || a.keyring?.label || 'Account']),
        );
      }

      let page = null;
      if (!append) {
        // P0 (history-service): the feed is the per-network cache merged with a fresh page,
        // so the first paint is instant and offline-honest (synced flag). Fall back to a
        // plain RPC page when the background predates the method.
        const feed = await bridge.send('tx.getHistoryFeed', { address: account.address })
          .catch(() => null);
        if (feed && Array.isArray(feed.entries)) {
          page = { entries: feed.entries, nextCursor: feed.nextCursor ?? null };
          // The feed's offline honesty is the whole point of P0: a cache page served
          // because the RPC was unreachable must say so, not masquerade as fresh.
          feedSynced = feed.synced !== false;
        }
      }
      if (!page) {
        // Options form returns { entries, nextCursor, hasMore }; the positional form returns a
        // bare array. Using the cursor form means "load more" pages instead of refetching.
        page = await bridge.send('tx.listHistory', {
          address: account.address,
          limit: 15,
          cursor: append ? cursor ?? 0 : 0,
        });
      }

      const batch = Array.isArray(page) ? page : (page?.entries || []);
      cursor = Array.isArray(page) ? null : (page?.nextCursor ?? null);
      if (append) {
        // The merged feed paints more than the RPC cursor's first page (fresh + cached),
        // so a load-more page can re-yield signatures already on screen. A signature must
        // never render twice. (Found in the P0 local-agent audit.)
        const seen = new Set(entries.map((e) => e?.signature).filter(Boolean));
        entries = [...entries, ...batch.filter((e) => !e?.signature || !seen.has(e.signature))];
      } else {
        entries = batch;
      }

      if (!append && !feedSynced) {
        banner.set('Showing cached activity — offline. Reconnect to sync.', 'warning');
      } else if (!append) {
        // A synced page supersedes any prior offline/cached or error label.
        banner.clear();
      }

      pending = await bridge.send('tx.getPending').catch(() => []);

      // A send that confirmed while the popup was closed still reads 'submitted'. Views must
      // not render that as Pending next to its confirmed list entry — settle first, refetch,
      // then paint. (The stuck-pending defect from the manual smoke run.)
      if ((pending || []).some((p) => p?.status === 'submitted')) {
        await bridge.send('tx.reconcilePending').catch(() => null);
        pending = await bridge.send('tx.getPending').catch(() => pending);
      }

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
    bridge.onEvent('accountsChanged', () => { account = null; knownAccounts = new Map(); cursor = null; load(); }),
    bridge.onEvent('networkChanged', () => { account = null; knownAccounts = new Map(); cursor = null; load(); }),
  );

  return {
    el,
    destroy() {
      for (const c of cards) c.destroy?.();
      cards.length = 0;
      for (const c of owned) c.destroy?.();
      owned.length = 0;
      header.destroy();
      banner.destroy();
      d.dispose();
    },
  };
}
