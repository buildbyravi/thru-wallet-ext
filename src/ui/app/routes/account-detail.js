// Account detail route — Rabby's settings/address-detail.
//
// The old screens/account-detail.js was dead: account-switcher.js called
// router.navigate('account-detail'), but popup.html had no #screen-account-detail container
// and no #app-root, so router.js's `if (container)` check failed silently and mount() never
// ran. That is also why secret export became unreachable — this screen was its only
// modular entry point.
//
// Rabby's URL carries `type=HD%20Key%20Tree` / `Simple%20Key%20Pair` and `byImport`.
// Those map onto our keyring.type ('seed' | 'privateKey') and keyring.origin
// ('generated' | 'imported'), which the vault now records.

import { h, disposer } from '../../kit/dom.js';
import { icon } from '../../kit/icon.js';
import { Button, CopyButton } from '../../kit/button.js';
import { Field } from '../../kit/field.js';
import { PageHeader, Banner, Spinner } from '../../kit/feedback.js';
import { AccountAvatar } from '../../domain/account-avatar.js';
import { keyringTypeLabel } from '../../domain/account-row.js';
import { requirePassword } from '../../domain/password-prompt.js';
import * as bridge from '../bridge.js';
import { decodeRef, encodeRef, refsEqual } from '../../../shared/refs.js';
import { explorerAddressUrl } from '../../../lib/networks.js';

/** One label/value row in the detail table. */
function DetailRow(label, valueNode) {
  return h('div', { class: 'detail-row' }, [
    h('span', { class: 'eyebrow', text: label }),
    h('div', { class: 'detail-val' }, valueNode),
  ]);
}

export function AccountDetailRoute({ params, navigate, back }) {
  const d = disposer();
  const ref = decodeRef(params.ref);

  const banner = Banner({ tone: 'error' });
  const body = h('div', { class: 'stack stack-4' }, Spinner({ label: 'Loading account' }).el);
  const header = PageHeader({ title: 'Account', onBack: () => back() });

  const el = h('section', { class: 'screen' }, [header.el, banner.el, body]);

  // A hand-edited hash must not reach the vault.
  if (!ref) {
    while (body.firstChild) body.removeChild(body.firstChild);
    banner.set('That account link is not valid.');
    return { el, destroy() { header.destroy(); banner.destroy(); d.dispose(); } };
  }

  const owned = [];
  function track(component) {
    owned.push(component);
    return component;
  }

  async function load() {
    banner.clear();
    try {
      const [accounts, keyrings, activeRef, network] = await Promise.all([
        bridge.send('account.list', { includeHidden: true }),
        bridge.send('keyring.list'),
        bridge.send('account.getActiveRef'),
        bridge.send('network.getActive'),
      ]);

      const account = (accounts || []).find((a) => refsEqual(a.ref, ref));
      if (!account) {
        while (body.firstChild) body.removeChild(body.firstChild);
        banner.set('That account is no longer in this wallet.');
        return;
      }

      const keyring = (keyrings || []).find((k) => k.id === account.keyring?.id) || account.keyring;
      const isSeed = keyring?.type === 'seed';
      const isActive = refsEqual(account.ref, activeRef);
      header.setTitle(account.label || 'Account');

      render({ account, keyring, isSeed, isActive, network, accounts });
    } catch (error) {
      while (body.firstChild) body.removeChild(body.firstChild);
      banner.set(error.message || 'Could not load this account.');
    }
  }

  function render({ account, keyring, isSeed, isActive, network, accounts }) {
    for (const c of owned) c.destroy?.();
    owned.length = 0;
    while (body.firstChild) body.removeChild(body.firstChild);

    // ---- Identity ----
    const copyAddress = track(CopyButton({
      getValue: () => account.address,
      title: 'Copy address',
      onResult: (err) => banner.set(err ? 'Could not copy — clipboard permission denied.' : ''),
    }));

    body.appendChild(h('div', { class: 'detail-hero' }, [
      AccountAvatar({ address: account.address, imported: !isSeed }),
      h('div', { class: 'grow' }, [
        h('div', { class: 'row-title', text: account.label || 'Account' }),
        h('div', { class: 'row-sub', text: account.address }),
      ]),
      copyAddress.el,
    ]));

    // ---- Rename ----
    const nameField = track(Field({
      label: 'Name',
      value: account.label || '',
      maxLength: 32,
      placeholder: 'Account name',
    }));
    const saveName = track(Button({
      label: 'Save name',
      variant: 'secondary',
      size: 'sm',
      onClick: async () => {
        const next = nameField.value.trim();
        if (!next) {
          nameField.setError('A name is required.');
          return;
        }
        try {
          // The label is sanitized and length-capped in the background, so the returned
          // value can differ from what was typed. Reflect what was actually stored rather
          // than what was requested.
          const result = await bridge.send('account.setLabel', {
            address: account.address,
            label: next,
          });
          nameField.value = result?.label ?? next;
          nameField.setError('');
          banner.set('');
          load();
        } catch (error) {
          nameField.setError(error.message || 'Could not rename.');
        }
      },
    }));
    body.appendChild(h('div', { class: 'stack stack-2' }, [nameField.el, saveName.el]));

    // ---- Facts ----
    const facts = h('div', { class: 'detail-table' }, [
      DetailRow('Source', h('span', { text: keyringTypeLabel(keyring) })),
      DetailRow('Source name', h('span', { class: 'truncate', text: keyring?.label || '—' })),
      isSeed
        ? DetailRow('Derivation index', h('span', { class: 'mono', text: String(account.hdIndex ?? 0) }))
        : null,
      DetailRow('Provenance', h('span', {
        text: keyring?.origin === 'imported'
          ? 'Imported into this wallet'
          : keyring?.origin === 'generated'
            ? 'Created in this wallet'
            : 'Unknown (predates provenance tracking)',
      })),
      DetailRow('Status', h('span', { text: isActive ? 'Active account' : 'Not active' })),
    ].filter(Boolean));
    body.appendChild(facts);

    // ---- Actions ----
    const actions = [];

    if (!isActive) {
      actions.push(track(Button({
        label: 'Set as active account',
        variant: 'secondary',
        onClick: async () => {
          try {
            await bridge.send('account.switch', { ref: account.ref });
            navigate('/dashboard');
          } catch (error) {
            banner.set(error.message || 'Could not switch account.');
          }
        },
      })).el);
    }

    const explorer = explorerAddressUrl(network, account.address);
    if (explorer) {
      actions.push(h('a', {
        class: 'btn secondary',
        href: explorer,
        target: '_blank',
        rel: 'noopener noreferrer',
      }, [icon('external', 14), h('span', { text: 'View on explorer' })]));
    }

    // ---- Export: the feature that had no click path ----
    // A seed-derived account gets BOTH options, because they disclose very different
    // amounts. The phrase controls every address it can ever derive; this address's private
    // key controls one. Offering only the phrase would force the greater disclosure on
    // someone who needs the lesser one.
    if (isSeed) {
      actions.push(track(Button({
        label: 'Export this account\u2019s private key',
        variant: 'secondary',
        iconName: 'key',
        onClick: () => navigate(`/export?ref=${encodeRef(account.ref)}&mode=key`),
      })).el);

      actions.push(track(Button({
        label: 'Export recovery phrase (all accounts)',
        variant: 'secondary',
        iconName: 'shield',
        onClick: () => navigate(`/export?ref=${encodeRef(account.ref)}`),
      })).el);
    } else {
      actions.push(track(Button({
        label: 'Export private key',
        variant: 'secondary',
        iconName: 'key',
        onClick: () => navigate(`/export?ref=${encodeRef(account.ref)}`),
      })).el);
    }

    if (isSeed && keyring?.origin === 'generated' && !keyring?.backedUpAt) {
      actions.push(track(Button({
        label: 'Back up recovery phrase',
        variant: 'accent',
        iconName: 'shield',
        onClick: () => navigate(`/export?ref=${encodeRef(account.ref)}&mode=backup`),
      })).el);
    }

    // Removing a derived account is distinct from removing the phrase that derives it.
    // Conflating those is how someone loses a keyring while trying to tidy up one address.
    const siblingCount = (accounts || []).filter((a) => a.keyring?.id === keyring?.id).length;
    if (isSeed && siblingCount > 1) {
      actions.push(track(Button({
        label: 'Remove this account',
        variant: 'danger',
        iconName: 'trash',
        onClick: async () => {
          const confirmed = await requirePassword({
            title: 'Remove this account?',
            body: 'The address is removed from this wallet. It can be derived again from the same '
              + 'recovery phrase, so no funds become unrecoverable.',
            confirmLabel: 'Remove account',
            danger: true,
            // No password is strictly required by the backend for removeHd, but this is a
            // destructive action on a list the user may not be able to reconstruct from
            // memory, so it is gated deliberately.
            verify: async (password) => {
              await bridge.send('wallet.verifyPassword', { password });
              return true;
            },
          });
          if (!confirmed) return;
          try {
            await bridge.send('account.removeHd', { ref: account.ref });
            navigate('/accounts', { replace: true });
          } catch (error) {
            banner.set(error.message || 'Could not remove this account.');
          }
        },
      })).el);
    }

    actions.push(track(Button({
      label: isSeed ? 'Remove recovery phrase' : 'Remove private key',
      variant: 'danger',
      iconName: 'warning',
      onClick: async () => {
        const removed = await requirePassword({
          title: isSeed ? 'Remove this recovery phrase?' : 'Remove this private key?',
          body: isSeed
            ? `This removes the phrase and all ${keyring?.accountCount ?? 1} account(s) derived `
              + 'from it. Without your written backup those funds are UNRECOVERABLE.'
            : 'This removes the key and its account. Without a backup of the key those funds '
              + 'are UNRECOVERABLE.',
          confirmLabel: 'Remove permanently',
          danger: true,
          verify: (password) => bridge.send('keyring.remove', { keyringId: keyring.id, password }),
        });
        if (!removed) return;
        navigate('/accounts', { replace: true });
      },
    })).el);

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
