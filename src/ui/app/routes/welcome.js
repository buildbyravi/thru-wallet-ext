// Welcome / onboarding route — the only path that creates a wallet.
//
// Replaces screens/welcome.js plus the create-password, backup and import screens, all four of
// which were unreachable in the legacy stack (no router.navigate ever targeted them; the
// monolith's show() calls won instead).
//
// The important sequencing decision: a newly generated phrase goes STRAIGHT into the backup
// flow, because an unbacked-up generated phrase is the single most dangerous state this wallet
// can be in. wallet.create returns the mnemonic once, and rather than hold it here, this route
// discards it and sends the user to /export?mode=backup, which re-reads it through the
// password-gated export path. That way the phrase is never held in UI state across a navigation.

import { h, disposer } from '../../kit/dom.js';
import { icon } from '../../kit/icon.js';
import { Button } from '../../kit/button.js';
import { Field } from '../../kit/field.js';
import { PageHeader, Banner } from '../../kit/feedback.js';
import * as bridge from '../bridge.js';
import { invalidate } from '../guards.js';
import { encodeRef } from '../../../shared/refs.js';

const MIN_PASSWORD = 8;

/** A large tappable option card, same shape as the add-account menu. */
function OptionCard({ iconName, title, body, onClick }) {
  const d = disposer();
  const el = h('button', { type: 'button', class: 'option-card' }, [
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

export function WelcomeRoute({ navigate }) {
  const d = disposer();
  const owned = [];
  let step = 'menu';

  function track(c) { owned.push(c); return c; }

  const banner = Banner({ tone: 'error' });
  const body = h('div', { class: 'stack stack-3' });
  const header = PageHeader({ title: 'Set up your wallet' });
  const el = h('section', { class: 'screen' }, [header.el, banner.el, body]);

  function clearBody() {
    for (const c of owned) c.destroy?.();
    owned.length = 0;
    while (body.firstChild) body.removeChild(body.firstChild);
  }

  function goMenu() {
    step = 'menu';
    header.setTitle('Set up your wallet');
    renderMenu();
  }

  // ---- Menu ---------------------------------------------------------------
  function renderMenu() {
    clearBody();
    banner.clear();

    body.appendChild(h('div', { class: 'notice warning' }, [
      h('div', { class: 'row-flex' }, [
        icon('warning', 15),
        h('strong', { text: 'Experimental wallet' }),
      ]),
      h('p', { class: 'hint', text:
        'Community-built and not audited. Use test-network funds only, and never a phrase that '
        + 'holds anything you care about.' }),
    ]));

    body.appendChild(track(OptionCard({
      iconName: 'plus',
      title: 'Create a new wallet',
      body: 'Generates a new recovery phrase. You will be asked to write it down.',
      onClick: () => renderCreate(),
    })).el);

    body.appendChild(track(OptionCard({
      iconName: 'shield',
      title: 'I already have a recovery phrase',
      body: 'Restore a wallet from 12 or 24 words.',
      onClick: () => renderImportPhrase(),
    })).el);

    body.appendChild(track(OptionCard({
      iconName: 'key',
      title: 'Import a private key',
      body: 'A single address. Cannot derive more accounts.',
      onClick: () => renderImportKey(),
    })).el);
  }

  /** Shared password pair, used by all three creation paths. */
  function passwordFields() {
    const pw = track(Field({
      label: 'Password',
      type: 'password',
      autocomplete: 'new-password',
      hint: `At least ${MIN_PASSWORD} characters. This encrypts your keys on this device and `
        + 'cannot be recovered if you forget it.',
      onInput: () => pw.setError(''),
    }));
    const confirm = track(Field({
      label: 'Confirm password',
      type: 'password',
      autocomplete: 'new-password',
      onInput: () => confirm.setError(''),
    }));
    return { pw, confirm };
  }

  /** Returns the password, or null after setting an inline error. */
  function readPassword(pw, confirm) {
    const value = pw.value;
    if (value.length < MIN_PASSWORD) {
      pw.setError(`Use at least ${MIN_PASSWORD} characters.`);
      return null;
    }
    if (value !== confirm.value) {
      confirm.setError('The two passwords do not match.');
      return null;
    }
    return value;
  }

  // ---- Create -------------------------------------------------------------
  function renderCreate() {
    step = 'create';
    clearBody();
    header.setTitle('Create a wallet');

    const { pw, confirm } = passwordFields();
    body.appendChild(pw.el);
    body.appendChild(confirm.el);

    body.appendChild(h('div', { class: 'screen-actions' }, [
      track(Button({
        label: 'Create wallet',
        variant: 'primary',
        busyLabel: 'Creating…',
        onClick: async () => {
          const password = readPassword(pw, confirm);
          if (!password) return;
          try {
            // wallet.create returns the mnemonic. It is deliberately NOT kept: the backup step
            // re-reads it through the password-gated export path, so no secret is held in UI
            // state across a navigation.
            await bridge.send('wallet.create', { password });
            pw.clearSecret();
            confirm.clearSecret();
            invalidate();

            const ref = await bridge.send('account.getActiveRef');
            // Straight into backup. An unbacked-up generated phrase is the most dangerous state
            // this wallet can be in, so it is not an optional follow-up step.
            navigate(`/export?ref=${encodeRef(ref)}&mode=backup`, { replace: true });
          } catch (error) {
            banner.set(error.message || 'Could not create the wallet.');
          }
        },
      })).el,
      track(Button({ label: 'Back', variant: 'text', onClick: () => goMenu() })).el,
    ]));
  }

  // ---- Import a phrase ----------------------------------------------------
  function renderImportPhrase() {
    step = 'import-phrase';
    clearBody();
    header.setTitle('Import a phrase');

    const phrase = track(Field({
      label: 'Recovery phrase',
      multiline: true,
      rows: 3,
      secret: true,
      placeholder: 'twelve words separated by spaces',
      hint: 'Spell check and autofill are disabled for this field.',
      onInput: () => phrase.setError(''),
    }));
    const { pw, confirm } = passwordFields();

    body.appendChild(phrase.el);
    body.appendChild(pw.el);
    body.appendChild(confirm.el);

    body.appendChild(h('div', { class: 'screen-actions' }, [
      track(Button({
        label: 'Import wallet',
        variant: 'primary',
        busyLabel: 'Importing…',
        onClick: async () => {
          const words = phrase.value.trim().replace(/\s+/g, ' ');
          if (!words) {
            phrase.setError('Enter your recovery phrase.');
            return;
          }
          const count = words.split(' ').length;
          if (count !== 12 && count !== 24) {
            phrase.setError(`Expected 12 or 24 words, got ${count}.`);
            return;
          }
          const password = readPassword(pw, confirm);
          if (!password) return;
          try {
            await bridge.send('wallet.importMnemonic', { mnemonic: words, password });
            phrase.clearSecret();
            pw.clearSecret();
            confirm.clearSecret();
            invalidate();
            // No backup step: an imported phrase is already written down somewhere.
            navigate('/dashboard', { replace: true });
          } catch (error) {
            phrase.clearSecret();
            banner.set(error.message || 'Could not import that phrase.');
          }
        },
      })).el,
      track(Button({ label: 'Back', variant: 'text', onClick: () => goMenu() })).el,
    ]));
  }

  // ---- Import a private key ----------------------------------------------
  function renderImportKey() {
    step = 'import-key';
    clearBody();
    header.setTitle('Import a private key');

    const key = track(Field({
      label: 'Private key',
      multiline: true,
      rows: 2,
      secret: true,
      placeholder: '64 hex characters',
      hint: 'Spell check and autofill are disabled for this field.',
      onInput: () => key.setError(''),
    }));
    const { pw, confirm } = passwordFields();

    body.appendChild(key.el);
    body.appendChild(pw.el);
    body.appendChild(confirm.el);

    body.appendChild(h('div', { class: 'screen-actions' }, [
      track(Button({
        label: 'Import key',
        variant: 'primary',
        busyLabel: 'Importing…',
        onClick: async () => {
          const hex = key.value.trim().replace(/^0x/i, '');
          if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
            key.setError('A private key is exactly 64 hex characters.');
            return;
          }
          const password = readPassword(pw, confirm);
          if (!password) return;
          try {
            await bridge.send('wallet.importPrivateKey', { privateKeyHex: hex, password });
            key.clearSecret();
            pw.clearSecret();
            confirm.clearSecret();
            invalidate();
            navigate('/dashboard', { replace: true });
          } catch (error) {
            key.clearSecret();
            banner.set(error.message || 'Could not import that key.');
          }
        },
      })).el,
      track(Button({ label: 'Back', variant: 'text', onClick: () => goMenu() })).el,
    ]));
  }

  renderMenu();

  return {
    el,
    destroy() {
      // Every Field's destroy() overwrites and clears its value, so passwords and phrases do not
      // survive in a detached subtree.
      for (const c of owned) c.destroy?.();
      owned.length = 0;
      header.destroy();
      banner.destroy();
      d.dispose();
    },
  };
}
