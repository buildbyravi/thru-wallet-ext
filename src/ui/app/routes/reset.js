// Reset route — the irreversible one.
//
// This route was navigated to from the unlock screen before it existed. It fell through to the
// legacy fallback, which mapped '/reset' to a non-existent 'go-reset' action and errored on a
// blank panel. Shipping the control before its destination, for the third time in this
// migration; see docs/DEFECT_LOG.md §4.
//
// Design intent: this must be hard to do by accident and impossible to do by momentum.
//   - the consequence is stated in terms of what is LOST, not what the button does
//   - a typed confirmation, so muscle-memory clicking cannot complete it
//   - the primary action is styled destructive; leaving is the visually easy path
//
// AUTH: deliberately different depending on lock state.
//
//   LOCKED   -> typed confirmation only, NO password. "I forgot my password" is the main
//               reason this screen exists, so demanding the password would make it useless
//               precisely when it is needed. This is not a theft vector: resetting destroys
//               local keys, it does not reveal them, and the funds remain reachable by anyone
//               holding the written recovery phrase.
//   UNLOCKED -> typed confirmation AND the password, because an unlocked session left open on
//               a shared machine should not be enough to wipe a wallet.

import { h, disposer } from '../../kit/dom.js';
import { icon } from '../../kit/icon.js';
import { Button } from '../../kit/button.js';
import { Field } from '../../kit/field.js';
import { PageHeader, Banner } from '../../kit/feedback.js';
import { requirePassword } from '../../domain/password-prompt.js';
import * as bridge from '../bridge.js';
import { invalidate } from '../guards.js';

const CONFIRM_PHRASE = 'RESET';

export function ResetRoute({ navigate, back }) {
  const d = disposer();
  const owned = [];
  const banner = Banner({ tone: 'error' });
  let isUnlocked = false;

  function track(c) { owned.push(c); return c; }

  const confirmField = track(Field({
    label: `Type ${CONFIRM_PHRASE} to confirm`,
    placeholder: CONFIRM_PHRASE,
    autocomplete: 'off',
    onInput: (value) => {
      resetBtn.update({ disabled: value.trim().toUpperCase() !== CONFIRM_PHRASE });
      confirmField.setError('');
    },
  }));

  async function performReset() {
    await bridge.send('wallet.reset');
    invalidate();
    // Replace, so Back cannot return to a reset screen for a wallet that no longer exists.
    navigate('/welcome', { replace: true });
  }

  const resetBtn = track(Button({
    label: 'Erase this wallet',
    variant: 'danger',
    iconName: 'trash',
    disabled: true,
    busyLabel: 'Erasing…',
    onClick: async () => {
      if (confirmField.value.trim().toUpperCase() !== CONFIRM_PHRASE) {
        confirmField.setError(`Type ${CONFIRM_PHRASE} exactly.`);
        return;
      }
      banner.clear();

      if (!isUnlocked) {
        // Locked: the typed confirmation is the whole gate. wallet.verifyPassword is
        // auth:'password' and would be refused with WALLET_LOCKED anyway.
        try {
          await performReset();
        } catch (error) {
          banner.set(error.message || 'Could not reset the wallet.');
        }
        return;
      }

      const done = await requirePassword({
        title: 'Erase this wallet?',
        body: 'This is the last step. Everything below is removed from this device and cannot '
          + 'be recovered without your recovery phrase.',
        confirmLabel: 'Erase permanently',
        danger: true,
        verify: async (password) => {
          // Verify BEFORE destroying. wallet.reset takes no password of its own, so without
          // this an unlocked session alone would be enough to wipe the vault.
          await bridge.send('wallet.verifyPassword', { password });
          await performReset();
          return true;
        },
      });
      if (!done) return;
    },
  }));

  const cancelBtn = track(Button({
    label: 'Keep my wallet',
    variant: 'primary',
    onClick: () => back(),
  }));

  // Shown only when the wallet is locked, so the absence of a password step reads as
  // intentional rather than as a missing safeguard.
  const lockNotice = h('p', { class: ['hint', 'hidden'], text:
    'Your wallet is locked, so no password is required to reset it. That is deliberate: this '
    + 'screen exists for the case where you have forgotten it. Resetting cannot reveal your '
    + 'keys, only remove them from this device.' });

  const el = h('section', { class: 'screen' }, [
    PageHeader({ title: 'Reset wallet', onBack: () => back() }).el,
    banner.el,

    h('div', { class: 'notice danger' }, [
      h('div', { class: 'row-flex' }, [
        icon('warning', 16),
        h('strong', { text: 'This erases your keys from this device' }),
      ]),
      h('ul', { class: 'warn-list' }, [
        h('li', { text: 'Every recovery phrase in this wallet' }),
        h('li', { text: 'Every imported private key' }),
        h('li', { text: 'All account names, contacts and settings' }),
      ]),
    ]),

    h('p', { class: 'muted', text:
      'Your funds stay on the blockchain. They are only reachable again if you have your '
      + 'recovery phrase or private key written down somewhere else. If you do not, resetting '
      + 'loses them permanently.' }),

    h('p', { class: 'hint', text:
      'If you only want to remove one account or one recovery phrase, do that from Accounts '
      + 'instead — this is all-or-nothing.' }),

    lockNotice,
    confirmField.el,

    h('div', { class: 'screen-actions' }, [cancelBtn.el, resetBtn.el]),
  ]);

  // Lock state decides whether the password is also required. Asked at mount so the button
  // does not have to discover it mid-click.
  bridge.send('wallet.isUnlocked')
    .then((unlocked) => {
      isUnlocked = Boolean(unlocked);
      lockNotice.classList.toggle('hidden', isUnlocked);
    })
    .catch(() => {});

  return {
    el,
    destroy() {
      for (const c of owned) c.destroy?.();
      owned.length = 0;
      banner.destroy();
      d.dispose();
    },
  };
}
