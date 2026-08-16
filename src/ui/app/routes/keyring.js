// Keyring management route.
//
// Reached from the gear button on a keyring group header in #/accounts. That button
// previously navigated to '/keyring', which was NOT in the route table — so it fell through
// to legacyFallback('keyring'), and since no legacy screen has that id the user got an error
// and a blank panel. Adding the button before the route was a mistake on my part.
//
// Scope is deliberately the KEYRING, not an account: rename the phrase, back it up, remove
// it. Per-account actions live in #/account. Conflating the two is how someone deletes a
// recovery phrase while trying to tidy up a single address.

import { h, disposer } from '../../kit/dom.js';
import { Button } from '../../kit/button.js';
import { Field } from '../../kit/field.js';
import { PageHeader, Banner, Spinner } from '../../kit/feedback.js';
import { keyringTypeLabel } from '../../domain/account-row.js';
import { requirePassword } from '../../domain/password-prompt.js';
import * as bridge from '../bridge.js';
import { encodeRef } from '../../../shared/refs.js';

export function KeyringRoute({ params, navigate, back }) {
  const d = disposer();
  const owned = [];
  const keyringId = String(params.id || '');

  const banner = Banner({ tone: 'error' });
  const body = h('div', { class: 'stack stack-4' }, Spinner({ label: 'Loading' }).el);
  const header = PageHeader({ title: 'Manage source', onBack: () => back() });
  const el = h('section', { class: 'screen' }, [header.el, banner.el, body]);

  function track(c) { owned.push(c); return c; }
  function clearBody() {
    for (const c of owned) c.destroy?.();
    owned.length = 0;
    while (body.firstChild) body.removeChild(body.firstChild);
  }

  if (!/^[a-z]+_[A-Za-z0-9_-]{4,64}$/.test(keyringId)) {
    clearBody();
    banner.set('That link is not valid.');
    return { el, destroy() { header.destroy(); banner.destroy(); d.dispose(); } };
  }

  async function load() {
    banner.clear();
    try {
      const [keyrings, accounts] = await Promise.all([
        bridge.send('keyring.list'),
        bridge.send('account.list', { includeHidden: true }),
      ]);
      const keyring = (keyrings || []).find((k) => k.id === keyringId);
      if (!keyring) {
        clearBody();
        banner.set('That source is no longer in this wallet.');
        return;
      }
      const mine = (accounts || []).filter((a) => a.keyring?.id === keyringId);
      render(keyring, mine, (keyrings || []).length);
    } catch (error) {
      clearBody();
      banner.set(error.message || 'Could not load this source.');
    }
  }

  function render(keyring, accounts, totalKeyrings) {
    clearBody();
    header.setTitle(keyring.label || 'Manage source');

    const isSeed = keyring.type === 'seed';

    body.appendChild(h('div', { class: 'detail-table' }, [
      h('div', { class: 'detail-row' }, [
        h('span', { class: 'eyebrow', text: 'Type' }),
        h('div', { class: 'detail-val', text: keyringTypeLabel(keyring) }),
      ]),
      h('div', { class: 'detail-row' }, [
        h('span', { class: 'eyebrow', text: 'Accounts' }),
        h('div', { class: 'detail-val', text: String(keyring.accountCount ?? accounts.length) }),
      ]),
      h('div', { class: 'detail-row' }, [
        h('span', { class: 'eyebrow', text: 'Backed up' }),
        h('div', {
          class: 'detail-val',
          text: !isSeed
            ? 'Not applicable'
            : keyring.backedUpAt
              ? new Date(keyring.backedUpAt).toLocaleDateString()
              : 'Not confirmed',
        }),
      ]),
    ]));

    // ---- Rename the source -------------------------------------------------
    const nameField = track(Field({
      label: 'Source name',
      value: keyring.label || '',
      maxLength: 32,
    }));
    body.appendChild(nameField.el);

    const actions = [];

    actions.push(track(Button({
      label: 'Save name',
      variant: 'secondary',
      onClick: async () => {
        const next = nameField.value.trim();
        if (!next) {
          nameField.setError('A name is required.');
          return;
        }
        const done = await requirePassword({
          title: 'Confirm your password',
          body: 'Renaming a key source re-checks your password.',
          confirmLabel: 'Save name',
          verify: (password) => bridge.send('keyring.rename', {
            keyringId,
            label: next,
            password,
          }),
        });
        if (done) load();
      },
    })).el);

    if (isSeed && accounts.length) {
      const firstRef = accounts[0].ref;
      actions.push(track(Button({
        label: keyring.backedUpAt ? 'View recovery phrase' : 'Back up recovery phrase',
        variant: keyring.backedUpAt ? 'secondary' : 'accent',
        iconName: 'shield',
        onClick: () => navigate(
          `/export?ref=${encodeRef(firstRef)}${keyring.backedUpAt ? '' : '&mode=backup'}`,
        ),
      })).el);

      actions.push(track(Button({
        label: 'Add another account from this phrase',
        variant: 'secondary',
        iconName: 'plus',
        onClick: () => navigate('/add-account'),
      })).el);
    }

    // Removing the only source would leave a wallet with no keys, which is a reset, not a
    // removal. The backend refuses it too; saying so here avoids an error dialog.
    if (totalKeyrings > 1) {
      actions.push(track(Button({
        label: isSeed ? 'Remove this recovery phrase' : 'Remove this private key',
        variant: 'danger',
        iconName: 'trash',
        onClick: async () => {
          const removed = await requirePassword({
            title: isSeed ? 'Remove this recovery phrase?' : 'Remove this private key?',
            body: isSeed
              ? `This removes the phrase and all ${keyring.accountCount ?? accounts.length} `
                + 'account(s) derived from it. Without your written backup those funds are '
                + 'UNRECOVERABLE.'
              : 'This removes the key and its account. Without a backup those funds are '
                + 'UNRECOVERABLE.',
            confirmLabel: 'Remove permanently',
            danger: true,
            verify: (password) => bridge.send('keyring.remove', { keyringId, password }),
          });
          if (removed) navigate('/accounts', { replace: true });
        },
      })).el);
    } else {
      body.appendChild(h('p', { class: 'hint', text:
        'This is the only key source in this wallet, so it cannot be removed. Reset the wallet '
        + 'from Settings instead.' }));
    }

    body.appendChild(h('div', { class: 'stack stack-2' }, actions));
  }

  load();
  d.add(bridge.onEvent('accountsChanged', () => load()));

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
