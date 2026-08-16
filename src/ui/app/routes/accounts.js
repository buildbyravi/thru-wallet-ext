// Accounts route — Rabby's switch-address, with multi-seed made visible.
//
// This is the screen the whole keyring backend existed for. src/lib/vault.js has supported
// multiple recovery phrases since V2, but api-router.js exposed no keyring namespace at all,
// so there was no way to see or manage them. Now every keyring is a labelled group.
//
// Replaces src/ui/components/account-switcher.js (a drawer whose detail and rename buttons
// navigated to containers that do not exist, so they silently did nothing) and
// popup.js renderAccountsList (unreachable — every path into #screen-accounts required
// already being inside it).

import { h, disposer } from '../../kit/dom.js';
import { icon } from '../../kit/icon.js';
import { Button } from '../../kit/button.js';
import { PageHeader, Banner, Spinner, Empty } from '../../kit/feedback.js';
import { AccountRow, KeyringGroup } from '../../domain/account-row.js';
import * as bridge from '../bridge.js';
import { encodeRef, refsEqual } from '../../../shared/refs.js';

export function AccountsRoute({ navigate, back }) {
  const d = disposer();
  let groups = [];
  let searchTerm = '';
  let data = { accounts: [], keyrings: [], activeRef: null };

  const banner = Banner({ tone: 'error' });
  const listHost = h('div', { class: 'stack stack-4' }, Spinner({ label: 'Loading accounts' }).el);

  const search = h('input', {
    type: 'search',
    placeholder: 'Search name or address',
    'aria-label': 'Search accounts',
    autocomplete: 'off',
  });
  const searchBox = h('div', { class: 'search-box' }, [
    h('span', { class: 'search-icon' }, icon('search', 14)),
    search,
  ]);

  d.on(search, 'input', () => {
    searchTerm = search.value.trim().toLowerCase();
    paint();
  });

  const addBtn = Button({
    label: 'Add account',
    variant: 'secondary',
    iconName: 'plus',
    onClick: () => navigate('/add-account'),
  });

  function disposeGroups() {
    for (const group of groups) group.destroy();
    groups = [];
  }

  function paint() {
    disposeGroups();
    while (listHost.firstChild) listHost.removeChild(listHost.firstChild);

    const matches = (account) => {
      if (!searchTerm) return true;
      return (account.label || '').toLowerCase().includes(searchTerm)
        || (account.address || '').toLowerCase().includes(searchTerm);
    };

    // Group by keyring so provenance is visible. An account from a second recovery phrase
    // must not look identical to one from the first.
    let shown = 0;
    for (const keyring of data.keyrings) {
      const inGroup = data.accounts.filter(
        (account) => account.keyring?.id === keyring.id && matches(account),
      );
      if (!inGroup.length) continue;

      const rows = inGroup.map((account) => AccountRow({
        account,
        active: refsEqual(account.ref, data.activeRef),
        balance: account.balance ?? null,
        stale: account.balanceStale ?? true,
        onSelect: (picked) => switchTo(picked),
        onDetail: (picked) => navigate(`/account?ref=${encodeRef(picked.ref)}`),
      }));
      shown += rows.length;

      const group = KeyringGroup({
        keyring,
        rows,
        onManage: () => navigate(`/keyring?id=${encodeURIComponent(keyring.id)}`),
      });
      groups.push(group);
      listHost.appendChild(group.el);
    }

    // Accounts whose keyring is missing from keyring.list would otherwise vanish from the
    // UI while still existing in the vault — a silent disappearance is worse than an
    // ugly group.
    const orphans = data.accounts.filter(
      (account) => matches(account) && !data.keyrings.some((k) => k.id === account.keyring?.id),
    );
    if (orphans.length) {
      const rows = orphans.map((account) => AccountRow({
        account,
        active: refsEqual(account.ref, data.activeRef),
        balance: account.balance ?? null,
        stale: account.balanceStale ?? true,
        onSelect: (picked) => switchTo(picked),
        onDetail: (picked) => navigate(`/account?ref=${encodeRef(picked.ref)}`),
      }));
      shown += rows.length;
      const group = KeyringGroup({
        keyring: { id: '__orphan', label: 'Other', accountCount: rows.length, type: 'unknown' },
        rows,
      });
      groups.push(group);
      listHost.appendChild(group.el);
    }

    if (!shown) {
      listHost.appendChild(Empty({
        iconName: 'search',
        title: searchTerm ? 'No matching accounts' : 'No accounts yet',
        body: searchTerm ? 'Try a different name or address.' : 'Add an account to get started.',
      }).el);
    }
  }

  async function switchTo(account) {
    banner.clear();
    try {
      await bridge.send('account.switch', { ref: account.ref });
      data.activeRef = account.ref;
      // Return to the dashboard so switching has a visible effect, matching Rabby.
      navigate('/dashboard');
    } catch (error) {
      banner.set(error.message || 'Could not switch account.');
    }
  }

  async function load() {
    banner.clear();
    try {
      const [accounts, keyrings, activeRef] = await Promise.all([
        bridge.send('account.list', { withBalances: true }),
        bridge.send('keyring.list'),
        bridge.send('account.getActiveRef'),
      ]);
      data = { accounts: accounts || [], keyrings: keyrings || [], activeRef };
      paint();

      // Refresh balances in the background; the list already rendered from cache.
      bridge.send('tx.getBalances', { addresses: data.accounts.map((a) => a.address) })
        .then((fresh) => {
          for (const group of groups) {
            for (const row of group.rows) {
              const entry = fresh?.[row.account.address];
              if (entry) row.setBalance(entry.balance, entry.stale);
            }
          }
        })
        .catch(() => {});
    } catch (error) {
      while (listHost.firstChild) listHost.removeChild(listHost.firstChild);
      banner.set(error.message || 'Could not load accounts.');
    }
  }

  const header = PageHeader({ title: 'Accounts', onBack: () => back() });

  const el = h('section', { class: 'screen' }, [
    header.el,
    searchBox,
    banner.el,
    listHost,
    h('div', { class: 'screen-actions' }, addBtn.el),
  ]);

  load();

  // Re-load when the background reports a change, instead of going stale until the user
  // navigates away and back.
  d.add(bridge.onEvent('accountsChanged', () => load()));

  return {
    el,
    destroy() {
      disposeGroups();
      header.destroy();
      addBtn.destroy();
      banner.destroy();
      d.dispose();
    },
  };
}
