// Account list row, and the keyring group that contains it.
//
// This is the core of Rabby's switch-address screen: addresses are never a flat list, they
// are grouped by the key material they came from. That grouping is the whole point of
// multi-seed — an address from "Seed wallet 2" behaves differently on backup and removal
// than one from "Seed wallet 1", and a flat list hides that.

import { h, disposer } from '../kit/dom.js';
import { icon } from '../kit/icon.js';
import { AccountAvatar, AddressText } from './account-avatar.js';
import { formatThru } from '../../shared/format.js';

/**
 * One selectable account.
 *
 * @param {Object} props
 *   account   public account object from account.list
 *   active    boolean — currently selected
 *   balance   base-unit string, or null when unknown
 *   stale     boolean — balance is cached and possibly out of date
 *   onSelect  (account) => void
 *   onDetail  (account) => void   opens the detail route
 */
export function AccountRow({ account, active = false, balance = null, stale = false, onSelect, onDetail } = {}) {
  const d = disposer();
  const imported = account?.keyring?.type === 'privateKey';

  const balanceEl = h('span', {
    class: ['row-value', stale ? 'stale' : null].filter(Boolean),
    // A dash for "not fetched yet" rather than 0. Showing 0 for an unknown balance is a
    // lie a user can act on.
    text: balance == null ? '—' : `${formatThru(BigInt(balance))} THRU`,
    title: stale ? 'Last known balance — refreshing' : undefined,
  });

  const selectBtn = h('button', {
    type: 'button',
    class: 'row-content-btn',
    'aria-current': active ? 'true' : null,
  }, [
    AccountAvatar({ address: account.address, imported }),
    h('span', { class: 'row-body' }, [
      h('span', { class: 'row-title', text: account.label || 'Account' }),
      AddressText({ address: account.address }),
    ]),
    balanceEl,
  ]);

  if (typeof onSelect === 'function') {
    d.on(selectBtn, 'click', () => onSelect(account));
  }

  const children = [selectBtn];

  if (typeof onDetail === 'function') {
    const detailBtn = h('button', {
      type: 'button',
      class: 'icon-btn icon-btn-ghost sm',
      // Rabby uses a bare chevron here. An icon-only control needs a real accessible name
      // that says WHICH account it opens, or a screen reader hears "button" N times.
      title: `Details for ${account.label || account.address}`,
      'aria-label': `Details for ${account.label || account.address}`,
    }, icon('chevronRight', 14));
    d.on(detailBtn, 'click', (event) => {
      event.stopPropagation();
      onDetail(account);
    });
    children.push(detailBtn);
  }

  const el = h('div', { class: ['row', active ? 'active' : null].filter(Boolean) }, children);

  return {
    el,
    account,
    setBalance(next, isStale) {
      balanceEl.textContent = next == null ? '—' : `${formatThru(BigInt(next))} THRU`;
      balanceEl.classList.toggle('stale', Boolean(isStale));
    },
    destroy() {
      d.dispose();
      el.remove();
    },
  };
}

/** Human label for a keyring type. */
export function keyringTypeLabel(keyring) {
  if (!keyring) return 'Unknown source';
  if (keyring.type === 'privateKey') return 'Private key';
  return keyring.origin === 'imported' ? 'Imported phrase' : 'Recovery phrase';
}

/**
 * A titled group of accounts belonging to one keyring.
 *
 * @param {Object} props
 *   keyring   keyring summary from keyring.list
 *   rows      AccountRow instances
 *   onManage  (keyring) => void
 */
export function KeyringGroup({ keyring, rows = [], onManage } = {}) {
  const d = disposer();

  const headerChildren = [
    h('span', { class: 'truncate', text: keyring.label || keyringTypeLabel(keyring) }),
    h('span', { class: 'list-group-count', text: String(keyring.accountCount ?? rows.length) }),
  ];

  // Only a generated phrase that has never been acknowledged needs a backup nudge. An
  // imported phrase is already written down somewhere, and a private key has no phrase at
  // all — flagging those would train users to ignore the warning.
  const needsBackup = keyring.type === 'seed'
    && keyring.origin === 'generated'
    && !keyring.backedUpAt;

  if (needsBackup) {
    headerChildren.push(h('span', {
      class: 'tag-warning',
      text: 'Not backed up',
      title: 'You have not confirmed writing this recovery phrase down.',
    }));
  }

  if (typeof onManage === 'function') {
    const manageBtn = h('button', {
      type: 'button',
      class: 'icon-btn icon-btn-ghost sm',
      title: `Manage ${keyring.label || 'this source'}`,
      'aria-label': `Manage ${keyring.label || 'this source'}`,
    }, icon('settings', 13));
    d.on(manageBtn, 'click', () => onManage(keyring));
    headerChildren.push(manageBtn);
  }

  const el = h('section', { class: 'list-group' }, [
    h('header', { class: 'list-group-header' }, headerChildren),
    h('div', { class: 'list' }, rows.map((r) => r.el)),
  ]);

  return {
    el,
    keyring,
    rows,
    destroy() {
      for (const row of rows) row.destroy();
      d.dispose();
      el.remove();
    },
  };
}
