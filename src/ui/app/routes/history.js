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
import { TxCard, dayKey, dayLabelForKey } from '../../domain/tx-card.js';
import { TxDetailSheet } from '../../domain/tx-detail-sheet.js';

// Wire entries carry no wall-clock time (slots only — see thru-client decodeHistoryEntry), so a
// bare dayKey() returned 'recent' for them. One timestampless wire entry interleaved between
// same-day local sends then splintered a single day into Today (1) -> Activity (1) -> Today (1).
// Resolve a display day per entry instead: a timestampless entry inherits the day of its newest
// dated neighbour (slot order bounds the truth — it cannot be later than that neighbour's day),
// a leading timestampless cluster carries from its older neighbour, and only a list with no dated
// entry anywhere stays under the honest "Activity" group. entry.timestamp is NEVER mutated here;
// the card head still shows Block <slot>, and this inference scopes to sectioning only.
function displayDayKeys(entries) {
  const keys = new Array(entries.length).fill(null);
  let carry = null;
  for (let i = 0; i < entries.length; i += 1) { // newest-first: fill from the newer side
    const real = dayKey(entries[i].timestamp);
    if (real !== 'recent') { keys[i] = real; carry = real; continue; }
    keys[i] = carry;
  }
  carry = null;
  for (let i = entries.length - 1; i >= 0; i -= 1) { // oldest-first: catch leading clusters
    if (keys[i] && dayKey(entries[i].timestamp) !== 'recent') carry = keys[i];
    else if (keys[i] === null) keys[i] = carry;
  }
  return keys.map((key) => key || 'recent');
}

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'sent', label: 'Sent' },
  { id: 'received', label: 'Received' },
  { id: 'faucet', label: 'Faucet' },
  { id: 'failed', label: 'Failed' },
];

export function HistoryRoute({ back }) {
  const d = disposer();
  let account = null;
  let network = null;
  let knownAccounts = new Map();
  let entries = [];
  let pending = [];
  let feedSynced = true;
  let feedLoading = false;
  let paging = false;
  let cursor = null;
  let activeFilter = 'all';
  let loadSeq = 0;
  let destroyed = false;
  let moreButton = null;

  const banner = Banner({ tone: 'error' });
  const listHost = h('div', { class: 'list' });
  const pendingHost = h('div', { class: ['stack', 'stack-2', 'hidden'] });
  const filterRow = h('div', { class: 'row-flex wrap' });
  const moreHost = h('div', {});
  // "History", matching the dashboard tile that leads here. (The "Activity" day-group label
  // in tx-card.js is a different thing — the honest catch-all for timestampless wire entries.)
  const header = PageHeader({ title: 'History', onBack: () => back() });

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

  // ---- Detail sheet (P2) ---------------------------------------------------
  // One sheet at a time, owned by the route so a navigation away tears it down with
  // everything else. It is NOT parented to the card: a repaint (filter change, pending
  // event, load-more) removes cards from the document, and a sheet living inside one would
  // vanish mid-read. The sheet appends itself to document.body and is destroyed by identity.
  let sheet = null;

  function closeSheet() {
    if (!sheet) return;
    const current = sheet;
    sheet = null;
    current.destroy();
  }

  function openDetail(entry) {
    if (!entry?.signature) return; // nothing to show, and nothing to fetch
    closeSheet();
    sheet = TxDetailSheet({
      entry,
      network,
      knownAccounts,
      // The sheet never calls the bridge itself — domain components stay bridge-free
      // (scripts/check-layering.mjs enforces it for kit; the same discipline applies here).
      // The route owns the one call, and a backend that predates tx.getDetail simply leaves
      // the lazy rows saying "Not available".
      loadDetail: (signature) => bridge
        .send('tx.getDetail', { signature, address: account?.address })
        .catch(() => null),
      onClose: () => { sheet = null; },
    });
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
        title: activeFilter !== 'all' ? 'Nothing matches this filter'
          : feedSynced ? 'No transactions yet' : 'Activity unavailable',
        body: activeFilter !== 'all' ? 'Try a different filter.'
          : feedSynced ? 'Claim from the faucet or receive THRU to get started.'
            : 'No cached activity on this network. Reconnect to sync.',
      }).el);
      return;
    }

    // Entries are newest-first, so day boundaries appear in order: compare against the
    // previous entry's RESOLVED display day and open a section whenever it changes.
    // displayDayKeys() coalesces timestampless wire entries into their dated neighbours'
    // day instead of splintering the section — see the helper above.
    let lastKey = null;
    let currentHeader = null;
    let sectionCount = 0;
    const keys = displayDayKeys(shown);
    for (let i = 0; i < shown.length; i += 1) {
      const entry = shown[i];
      const key = keys[i];
      if (key !== lastKey) {
        // Positional access (listHost.lastChild) was the shipped bug: at a day boundary
        // that node is the previous section's LAST CARD, so its count badge ended up
        // inside a transaction card. Identity reference always: the header, by name.
        if (currentHeader) {
          currentHeader.appendChild(h('span', { class: 'list-group-count', text: String(sectionCount) }));
        }
        currentHeader = h('header', { class: 'list-group-header' }, [
          h('span', { text: dayLabelForKey(key) }),
        ]);
        listHost.appendChild(currentHeader);
        lastKey = key;
        sectionCount = 0;
      }
      // `entry` is captured by identity, not by index: the sheet must open against the
      // transaction the user actually tapped even after a filter change reorders the list.
      const card = TxCard({ entry, network, knownAccounts, onOpen: openDetail });
      cards.push(card);
      listHost.appendChild(card.el);
      sectionCount += 1;
    }
    if (currentHeader) {
      currentHeader.appendChild(h('span', { class: 'list-group-count', text: String(sectionCount) }));
    }
  }

  function paintMore() {
    moreButton?.destroy();
    moreButton = null;
    while (moreHost.firstChild) moreHost.removeChild(moreHost.firstChild);
    // The cached cursor can point into a page that a fresh feed will replace. Never page
    // against it until revalidation has finished, or run two load-more requests at once.
    if (cursor == null || feedLoading || paging) return;
    moreButton = Button({
      label: 'Load more',
      variant: 'text',
      onClick: () => load({ append: true }),
    });
    moreHost.appendChild(moreButton.el);
  }

  const isCurrent = (seq, viewed = null) => !destroyed && seq === loadSeq
    && (!viewed || (account?.address === viewed.address && network?.id === viewed.networkId));

  async function refreshPending(seq, viewed) {
    let next = await bridge.send('tx.getPending').catch(() => []);
    if (!isCurrent(seq, viewed)) return;
    pending = Array.isArray(next) ? next : [];
    paintPending(); // do not hold cache OR fresh cards behind reconciliation RPCs

    // A send confirmed while the popup was closed can still read 'submitted'. Reconcile and
    // re-read, but only render the result if this is still the same account/network/view.
    if (!pending.some((p) => p?.status === 'submitted')) return;
    await bridge.send('tx.reconcilePending').catch(() => null);
    if (!isCurrent(seq, viewed)) return;
    next = await bridge.send('tx.getPending').catch(() => pending);
    if (!isCurrent(seq, viewed)) return;
    pending = Array.isArray(next) ? next : pending;
    paintPending();
  }

  async function load({ append = false, pendingHint = null } = {}) {
    if (append) {
      if (!account || !network || feedLoading || paging || cursor == null) return;
      const seq = loadSeq;
      const viewed = { address: account.address, networkId: network.id };
      paging = true;
      paintMore();
      try {
        const page = await bridge.send('tx.listHistory', {
          address: viewed.address, limit: 15, cursor,
        });
        if (!isCurrent(seq, viewed)) return;
        const batch = Array.isArray(page) ? page : (page?.entries || []);
        cursor = Array.isArray(page) ? null : (page?.nextCursor ?? null);
        // The feed's first page contains fresh rows PLUS older cache rows. A later RPC page
        // may re-yield those signatures; an append must never draw the same card twice.
        const seen = new Set(entries.map((e) => e?.signature).filter(Boolean));
        entries = [...entries, ...batch.filter((e) => !e?.signature || !seen.has(e.signature))];
        paintPending();
        paintList();
      } catch (error) {
        if (isCurrent(seq, viewed)) banner.set(error.message || 'Could not load more activity.');
      } finally {
        if (isCurrent(seq, viewed)) {
          paging = false;
          paintMore();
        }
      }
      return;
    }

    const seq = ++loadSeq;
    feedLoading = true;
    paging = false;
    feedSynced = true;
    cursor = null;
    entries = [];
    // A push event already knows about a new submitted send. Keep it visible while the
    // independent cache/feed and pending reconciliation reads run, rather than hiding it.
    pending = Array.isArray(pendingHint)
      ? pendingHint.filter((p) => !network?.id || !p.networkId || p.networkId === network.id)
      : [];
    banner.clear();
    paintPending();
    paintMore();
    for (const c of cards) c.destroy?.();
    cards.length = 0;
    while (listHost.firstChild) listHost.removeChild(listHost.firstChild);
    listHost.appendChild(Spinner({ label: 'Loading activity' }).el);

    try {
      // First paint depends on the active identity, not a wallet-wide account-list fetch.
      if (!account || !network) {
        const [activeAcc, activeNet] = await Promise.all([
          bridge.send('account.getActive'),
          bridge.send('network.getActive'),
        ]);
        if (!isCurrent(seq)) return;
        if (!activeAcc?.address || !activeNet?.id) throw new Error('Could not load the active account or network.');
        account = activeAcc;
        network = activeNet;
      }
      const viewed = { address: account.address, networkId: network.id };

      // This is STORAGE ONLY. Its response is scoped by both address and network; discard a
      // stale worker reply for a different chain instead of showing another chain's history.
      const cached = await bridge.send('tx.getCachedHistory', { address: viewed.address })
        .catch(() => null); // older background versions simply skip the early paint
      if (!isCurrent(seq, viewed)) return;
      if (cached?.networkId === viewed.networkId && cached?.address === viewed.address
        && Array.isArray(cached.entries) && cached.entries.length) {
        entries = cached.entries;
        cursor = cached.nextCursor ?? null;
        feedSynced = false;
        banner.set('Showing cached activity — checking network…', 'warning');
        paintList();
        paintPending();
      }

      // Neither labels nor pending reconciliation may delay cached/fresh entry rendering.
      void refreshPending(seq, viewed);
      void bridge.send('account.list').then((list) => {
        if (!isCurrent(seq, viewed)) return;
        knownAccounts = new Map((Array.isArray(list) ? list : [])
          .filter((a) => a?.address)
          .map((a) => [a.address, a.label || a.keyring?.label || 'Account']));
        if (entries.length) paintList();
      }).catch(() => {});

      let feed;
      try {
        feed = await bridge.send('tx.getHistoryFeed', { address: viewed.address });
      } catch (error) {
        // Only an older worker without the feed needs the legacy raw-page fallback. An
        // unreachable node must not trigger a SECOND network request before showing cache.
        if (error?.code !== 'UNKNOWN_METHOD') throw error;
        const page = await bridge.send('tx.listHistory', {
          address: viewed.address, limit: 15, cursor: 0,
        });
        feed = Array.isArray(page)
          ? { entries: page, nextCursor: null, synced: true }
          : { entries: page?.entries || [], nextCursor: page?.nextCursor ?? null, synced: true };
      }
      if (!isCurrent(seq, viewed)) return;
      if (!Array.isArray(feed?.entries)) throw new Error('History feed was not available.');
      entries = feed.entries;
      cursor = feed.nextCursor ?? null;
      feedSynced = feed.synced !== false;
      if (feedSynced) banner.clear();
      else banner.set('Showing cached activity — offline or network unavailable. Reconnect to sync.', 'warning');
      paintPending();
      paintList();
    } catch (error) {
      if (!isCurrent(seq)) return;
      feedSynced = false;
      banner.set(entries.length
        ? 'Showing cached activity — could not sync with the network. Reconnect to refresh.'
        : error.message || 'Could not load activity.', entries.length ? 'warning' : 'error');
      paintPending();
      paintList();
    } finally {
      if (isCurrent(seq)) {
        feedLoading = false;
        paintMore();
      }
    }
  }

  function resetContext() {
    // Invalidate all outstanding cached, live, pending and load-more replies immediately.
    // Empty the previous account's list before starting the next identity's reads.
    loadSeq += 1;
    closeSheet();
    account = null;
    network = null;
    knownAccounts = new Map();
    entries = [];
    pending = [];
    cursor = null;
    paintPending();
    load();
  }

  load();

  d.add(
    bridge.onEvent('pendingTxChanged', ({ pending: next } = {}) => {
      // A settled transaction should appear in the list, not just vanish from Pending.
      load({ pendingHint: next });
    }),
    bridge.onEvent('accountsChanged', resetContext),
    bridge.onEvent('networkChanged', resetContext),
  );

  return {
    el,
    destroy() {
      destroyed = true;
      loadSeq += 1; // discard every late bridge reply after navigation
      // The sheet lives on document.body, so route teardown must close it explicitly or it
      // outlives the screen that owns it.
      closeSheet();
      for (const c of cards) c.destroy?.();
      cards.length = 0;
      moreButton?.destroy();
      moreButton = null;
      header.destroy();
      banner.destroy();
      d.dispose();
    },
  };
}
