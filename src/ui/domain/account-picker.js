// Grouped account picker — reusable wherever an account has to be chosen.
//
// Accounts are grouped by the KEYRING they came from, because "which seed is this from" is the
// question you actually need answered when picking one. A flat list of six addresses tells you
// nothing about which recovery phrase controls them, and that matters: an account from
// "Seed wallet 2" is backed up by a different phrase than one from "Seed wallet 1", and an
// imported private key is backed up by neither.
//
// Used by the send screen for both From and To. The legacy recipient picker was flat, and its
// refsEqual compared the OLD ref shape (kind/index/keyIndex) rather than keyringId, so it could
// mis-identify the current account.

import { h, disposer } from '../kit/dom.js';
import { icon } from '../kit/icon.js';
import { AccountAvatar, AddressText } from './account-avatar.js';
import { keyringTypeLabel } from './account-row.js';
import { formatThru } from '../../shared/format.js';
import { refsEqual } from '../../shared/refs.js';

/**
 * @param {Object} props
 *   accounts      public accounts from account.list
 *   keyrings      summaries from keyring.list
 *   activeRef     ref of the currently selected account, if any
 *   excludeRef    ref to omit entirely (e.g. cannot send to yourself)
 *   contacts      optional [{ address, label }] shown in their own group
 *   emptyText     shown when nothing is selectable
 *   onPick        (pick) => void, where pick is { address, label, ref?, source }
 */
export function AccountPicker({
  accounts = [],
  keyrings = [],
  activeRef = null,
  excludeRef = null,
  contacts = [],
  emptyText = 'No accounts available.',
  onPick,
} = {}) {
  const d = disposer();
  const el = h('div', { class: 'stack stack-4' });

  function row({ label, address, balance, ref, source, active, badge }) {
    const btn = h('button', {
      type: 'button',
      class: ['row', 'clickable', active ? 'active' : null].filter(Boolean),
      'aria-current': active ? 'true' : null,
    }, [
      AccountAvatar({ address, imported: source === 'privateKey' }),
      h('span', { class: 'row-body' }, [
        h('span', { class: 'row-flex', style: { gap: '6px' } }, [
          h('span', { class: 'row-title', text: label || 'Account' }),
          badge ? h('span', { class: 'badge', text: badge }) : null,
        ]),
        AddressText({ address, chars: 6 }),
      ]),
      balance != null
        ? h('span', { class: 'row-value', text: `${formatThru(BigInt(balance))} THRU` })
        : null,
      active ? h('span', { class: 'row-value' }, icon('check', 14)) : null,
    ]);

    if (typeof onPick === 'function') {
      d.on(btn, 'click', () => onPick({ address, label, ref, source }));
    }
    return btn;
  }

  const selectable = accounts.filter((acc) => !(excludeRef && refsEqual(acc.ref, excludeRef)));
  let rendered = 0;

  // One group per keyring, in the order keyring.list returned them.
  for (const keyring of keyrings) {
    const mine = selectable.filter((acc) => acc.keyring?.id === keyring.id);
    if (!mine.length) continue;
    rendered += mine.length;

    const headerBits = [
      h('span', { class: 'truncate', text: keyring.label || keyringTypeLabel(keyring) }),
      // Says WHAT kind of source this is, not just its nickname — a nickname can be anything.
      h('span', { class: 'list-group-count', text: keyringTypeLabel(keyring) }),
    ];
    if (keyring.type === 'seed' && keyring.origin === 'generated' && !keyring.backedUpAt) {
      headerBits.push(h('span', { class: 'tag-warning', text: 'not backed up' }));
    }

    el.appendChild(h('section', { class: 'list-group' }, [
      h('header', { class: 'list-group-header' }, headerBits),
      h('div', { class: 'list' }, mine.map((acc) => row({
        label: acc.label,
        address: acc.address,
        balance: acc.balance,
        ref: acc.ref,
        source: acc.keyring?.type,
        active: activeRef ? refsEqual(acc.ref, activeRef) : false,
      }))),
    ]));
  }

  // Accounts whose keyring is missing from keyring.list would otherwise vanish from the picker
  // while still existing in the vault. A silent disappearance is worse than an ugly group.
  const orphans = selectable.filter(
    (acc) => !keyrings.some((k) => k.id === acc.keyring?.id),
  );
  if (orphans.length) {
    rendered += orphans.length;
    el.appendChild(h('section', { class: 'list-group' }, [
      h('header', { class: 'list-group-header' }, h('span', { text: 'Other accounts' })),
      h('div', { class: 'list' }, orphans.map((acc) => row({
        label: acc.label,
        address: acc.address,
        balance: acc.balance,
        ref: acc.ref,
        source: acc.keyring?.type,
        active: activeRef ? refsEqual(acc.ref, activeRef) : false,
      }))),
    ]));
  }

  if (contacts.length) {
    rendered += contacts.length;
    el.appendChild(h('section', { class: 'list-group' }, [
      h('header', { class: 'list-group-header' }, [
        h('span', { text: 'Address book' }),
        h('span', { class: 'list-group-count', text: 'saved contacts' }),
      ]),
      h('div', { class: 'list' }, contacts.map((c) => row({
        label: c.label,
        address: c.address,
        balance: null,
        source: 'contact',
        badge: 'contact',
      }))),
    ]));
  }

  if (!rendered) {
    el.appendChild(h('p', { class: 'hint', text: emptyText }));
  }

  return {
    el,
    destroy() {
      d.dispose();
      el.remove();
    },
  };
}
