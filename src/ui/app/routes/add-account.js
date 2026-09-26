// Add account route — Rabby's add-address.
//
// Four ways to add key material, each with a distinct security meaning that the UI must not
// blur together:
//
//   1. Derive the next account from an existing recovery phrase (no new secret; nothing to
//      back up).
//   2. Create a brand-new recovery phrase (new secret; MUST be backed up).
//   3. Import an existing recovery phrase (new secret; already backed up elsewhere).
//   4. Import a single private key (new secret; one address only, no derivation).
//
// Options 2-4 all reach vault primitives that api-router.js did not expose until contract
// v3, so none of this was previously reachable at all.

import { h, disposer } from '../../kit/dom.js';
import { icon } from '../../kit/icon.js';
import { Button } from '../../kit/button.js';
import { Field } from '../../kit/field.js';
import { PageHeader, Banner } from '../../kit/feedback.js';
import { requirePassword } from '../../domain/password-prompt.js';
import { AddressText } from '../../domain/account-avatar.js';
import * as bridge from '../bridge.js';
import { encodeRef } from '../../../shared/refs.js';
import { formatThru } from '../../../shared/format.js';

/** A large tappable option card. */
function OptionCard({ iconName, title, body, tone = '', onClick }) {
  const d = disposer();
  const el = h('button', {
    type: 'button',
    class: ['option-card', tone].filter(Boolean),
  }, [
    h('span', { class: 'option-card-icon' }, icon(iconName, 18)),
    h('span', { class: 'option-card-body' }, [
      h('span', { class: 'option-card-title', text: title }),
      h('span', { class: 'option-card-sub', text: body }),
    ]),
    icon('chevronRight', 14),
  ]);
  d.on(el, 'click', onClick);
  return { el, destroy() { d.dispose(); el.remove(); } };
}

export function AddAccountRoute({ navigate, back }) {
  const d = disposer();
  const owned = [];
  let seedKeyrings = [];

  const banner = Banner({ tone: 'error' });
  const body = h('div', { class: 'stack stack-3' });
  const header = PageHeader({ title: 'Add account', onBack: () => back() });
  const el = h('section', { class: 'screen' }, [header.el, banner.el, body]);

  function track(c) { owned.push(c); return c; }
  function clearBody() {
    for (const c of owned) c.destroy?.();
    owned.length = 0;
    while (body.firstChild) body.removeChild(body.firstChild);
  }

  // ---- Menu ----------------------------------------------------------------
  function renderMenu() {
    clearBody();
    banner.clear();

    if (seedKeyrings.length) {
      body.appendChild(track(OptionCard({
        iconName: 'plus',
        title: 'Add from existing phrase',
        body: seedKeyrings.length > 1
          ? `Derive the next address from one of your ${seedKeyrings.length} phrases.`
          : 'Derive the next address. Nothing new to back up.',
        // With more than one phrase the user must choose which; jumping straight to the
        // first one made every phrase after the first undeliverable.
        onClick: () => (seedKeyrings.length > 1 ? renderSeedPicker() : renderDerive(seedKeyrings[0])),
      })).el);
    }

    body.appendChild(track(OptionCard({
      iconName: 'wallet',
      title: 'Create a new recovery phrase',
      body: 'A separate 12-word phrase, kept in the same wallet.',
      onClick: () => renderCreateSeed(),
    })).el);

    body.appendChild(track(OptionCard({
      iconName: 'shield',
      title: 'Import a recovery phrase',
      body: 'Bring in a phrase from another wallet.',
      onClick: () => renderImportSeed(),
    })).el);

    body.appendChild(track(OptionCard({
      iconName: 'key',
      title: 'Import a private key',
      body: 'A single address. Cannot derive more.',
      onClick: () => renderImportKey(),
    })).el);
  }

  // ---- Derive from an existing phrase (with preview) -----------------------
  // Rabby shows candidate addresses and lets the user choose. account.previewHd derives
  // without persisting, so nothing is written until a selection is confirmed.
  //
  // Takes the keyring as an argument rather than assuming seedKeyrings[0]. The first version
  // hardcoded index 0, so once a second phrase existed it was impossible to derive from it —
  // which defeats the point of multi-seed.
  function renderDerive(ring) {
    clearBody();
    banner.clear();

    const chosen = new Set();
    const listHost = h('div', { class: 'list' });
    let start = 0;

    const addBtn = track(Button({
      label: 'Add selected',
      variant: 'primary',
      disabled: true,
      onClick: async () => {
        try {
          await bridge.send('account.addHdBatch', {
            keyringId: ring.id,
            indices: [...chosen],
          });
          navigate('/accounts', { replace: true });
        } catch (error) {
          banner.set(error.message || 'Could not add accounts.');
        }
      },
    }));

    async function loadPage() {
      while (listHost.firstChild) listHost.removeChild(listHost.firstChild);
      listHost.appendChild(h('p', { class: 'hint', text: 'Deriving addresses…' }));
      try {
        const preview = await bridge.send('account.previewHd', {
          keyringId: ring.id,
          start,
          count: 5,
          withBalances: true,
        });
        while (listHost.firstChild) listHost.removeChild(listHost.firstChild);

        for (const entry of preview) {
          const checkbox = h('input', { type: 'checkbox' });
          checkbox.checked = chosen.has(entry.index);
          checkbox.disabled = entry.added;

          d.on(checkbox, 'change', () => {
            if (checkbox.checked) chosen.add(entry.index);
            else chosen.delete(entry.index);
            addBtn.update({ disabled: chosen.size === 0 });
          });

          listHost.appendChild(h('label', { class: 'row clickable' }, [
            checkbox,
            h('span', { class: 'row-body' }, [
              h('span', { class: 'row-title', text: `Account ${entry.index + 1}` }),
              AddressText({ address: entry.address }),
            ]),
            h('span', { class: 'row-value', text: entry.added
              ? 'Already added'
              : entry.balance != null ? `${formatThru(BigInt(entry.balance))} THRU` : '—' }),
          ]));
        }
      } catch (error) {
        while (listHost.firstChild) listHost.removeChild(listHost.firstChild);
        banner.set(error.message || 'Could not derive addresses.');
      }
    }

    const moreBtn = track(Button({
      label: 'Show next 5',
      variant: 'text',
      onClick: () => { start += 5; return loadPage(); },
    }));

    body.appendChild(h('p', { class: 'hint', text:
      `Choose which addresses to add from "${ring.label}". Nothing is saved until you confirm.` }));
    body.appendChild(listHost);
    body.appendChild(moreBtn.el);
    body.appendChild(h('div', { class: 'screen-actions' }, [
      addBtn.el,
      track(Button({
        label: 'Back',
        variant: 'text',
        onClick: () => (seedKeyrings.length > 1 ? renderSeedPicker() : renderMenu()),
      })).el,
    ]));

    loadPage();
  }

  // ---- Choose WHICH phrase to derive from ---------------------------------
  function renderSeedPicker() {
    clearBody();
    banner.clear();

    body.appendChild(h('p', { class: 'hint', text: 'Which recovery phrase should the new address come from?' }));

    for (const ring of seedKeyrings) {
      body.appendChild(track(OptionCard({
        iconName: 'wallet',
        title: ring.label || 'Recovery phrase',
        body: `${ring.accountCount} account${ring.accountCount === 1 ? '' : 's'} · `
          + (ring.origin === 'imported' ? 'imported phrase' : 'created here'),
        onClick: () => renderDerive(ring),
      })).el);
    }

    body.appendChild(h('div', { class: 'screen-actions' },
      track(Button({ label: 'Back', variant: 'text', onClick: () => renderMenu() })).el));
  }

  // ---- Create a new phrase ------------------------------------------------
  function renderCreateSeed() {
    clearBody();
    banner.clear();

    const nameField = track(Field({
      label: 'Name this phrase',
      value: `Seed wallet ${seedKeyrings.length + 1}`,
      maxLength: 32,
    }));

    body.appendChild(h('div', { class: 'notice warning' }, [
      h('strong', { text: 'You must write the new phrase down' }),
      h('p', { class: 'hint', text:
        'A new phrase is a new set of funds to lose. You will be shown it once and asked to '
        + 'confirm it before it is used.' }),
    ]));
    body.appendChild(nameField.el);
    body.appendChild(h('div', { class: 'screen-actions' }, [
      track(Button({
        label: 'Create phrase',
        variant: 'primary',
        onClick: async () => {
          // The phrase is generated INSIDE the background and persisted before this
          // returns. The UI never holds fresh entropy; the words are shown afterwards via
          // the backup flow, which re-verifies the password.
          const created = await requirePassword({
            title: 'Confirm your password',
            body: 'Adding key material re-checks your password against the encrypted vault.',
            confirmLabel: 'Create phrase',
            verify: (password) => bridge.send('keyring.createSeed', {
              password,
              label: nameField.value.trim(),
            }),
          });
          if (!created) return;
          // Straight into the backup flow: an unbacked-up generated phrase is the single
          // most dangerous state this wallet can be in.
          const activeRef = await bridge.send('account.getActiveRef');
          navigate(`/export?ref=${encodeRef(activeRef)}&mode=backup`, { replace: true });
        },
      })).el,
      track(Button({ label: 'Back', variant: 'text', onClick: () => renderMenu() })).el,
    ]));
  }

  // ---- Import an existing phrase -----------------------------------------
  function renderImportSeed() {
    clearBody();
    banner.clear();

    const phraseField = track(Field({
      label: 'Recovery phrase',
      multiline: true,
      rows: 3,
      secret: true,
      placeholder: 'twelve words separated by spaces',
      hint: 'Spell check and autofill are disabled for this field.',
    }));
    const nameField = track(Field({
      label: 'Name (optional)',
      maxLength: 32,
      placeholder: `Seed wallet ${seedKeyrings.length + 1}`,
    }));

    body.appendChild(phraseField.el);
    body.appendChild(nameField.el);
    body.appendChild(h('div', { class: 'screen-actions' }, [
      track(Button({
        label: 'Import phrase',
        variant: 'primary',
        onClick: async () => {
          const phrase = phraseField.value.trim().replace(/\s+/g, ' ');
          if (!phrase) {
            phraseField.setError('Enter your recovery phrase.');
            return;
          }
          const wordCount = phrase.split(' ').length;
          if (wordCount !== 12 && wordCount !== 24) {
            phraseField.setError(`Expected 12 or 24 words, got ${wordCount}.`);
            return;
          }
          const added = await requirePassword({
            title: 'Confirm your password',
            body: 'Adding key material re-checks your password against the encrypted vault.',
            confirmLabel: 'Import phrase',
            verify: (password) => bridge.send('keyring.addSeed', {
              mnemonic: phrase,
              password,
              label: nameField.value.trim(),
            }),
          });
          // Clear the phrase from the field regardless of outcome.
          phraseField.clearSecret();
          if (!added) return;
          navigate('/accounts', { replace: true });
        },
      })).el,
      track(Button({ label: 'Back', variant: 'text', onClick: () => renderMenu() })).el,
    ]));
  }

  // ---- Import a private key ----------------------------------------------
  function renderImportKey() {
    clearBody();
    banner.clear();

    const keyField = track(Field({
      label: 'Private key',
      multiline: true,
      rows: 2,
      secret: true,
      placeholder: '64 hex characters',
      hint: 'Spell check and autofill are disabled for this field.',
    }));
    const nameField = track(Field({
      label: 'Name (optional)',
      maxLength: 32,
      placeholder: 'Imported key',
    }));

    body.appendChild(keyField.el);
    body.appendChild(nameField.el);
    body.appendChild(h('div', { class: 'screen-actions' }, [
      track(Button({
        label: 'Import key',
        variant: 'primary',
        onClick: async () => {
          const hex = keyField.value.trim().replace(/^0x/i, '');
          if (!hex) {
            keyField.setError('Enter a private key.');
            return;
          }
          if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
            keyField.setError('A private key is exactly 64 hex characters.');
            return;
          }
          const added = await requirePassword({
            title: 'Confirm your password',
            body: 'Adding key material re-checks your password against the encrypted vault.',
            confirmLabel: 'Import key',
            verify: (password) => bridge.send('keyring.addPrivateKey', {
              privateKeyHex: hex,
              password,
              label: nameField.value.trim(),
            }),
          });
          keyField.clearSecret();
          if (!added) return;
          navigate('/accounts', { replace: true });
        },
      })).el,
      track(Button({ label: 'Back', variant: 'text', onClick: () => renderMenu() })).el,
    ]));
  }

  (async () => {
    try {
      const keyrings = await bridge.send('keyring.list');
      seedKeyrings = (keyrings || []).filter((k) => k.type === 'seed');
    } catch {
      seedKeyrings = [];
    }
    renderMenu();
  })();

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
