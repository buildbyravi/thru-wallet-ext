// Export route — restores a feature that has no click path in the shipping UI.
//
// This is not a missing feature, it is a broken one. `data-action="go-export-password"`
// exists only at popup.html:255 inside #screen-accounts, and every path into that screen
// requires already being inside it. The modular route was dead too: account-detail.js could
// never mount, so its export button never rendered. A user currently cannot retrieve their
// own recovery phrase.
//
// Secret handling here is deliberately different from the old flow, which had three defects:
//
//   1. popup.js:465 wrote the mnemonic to `grid.dataset.raw` and nothing ever removed it.
//      manifest.json registers popup.html as a side panel, so that document can live for
//      days with the phrase sitting in an attribute.
//   2. Secrets were passed as router params, and router.js:117 pushed params verbatim into
//      its history array — so the "wipes secret on unmount" comments were false.
//   3. `case 'lock'` never nulled pendingExportSecret, so copy-export-secret still worked
//      AFTER the wallet was locked.
//
// Here: the secret lives in one local variable, is never written to any attribute, never
// enters the URL, and is dropped on destroy AND on a lockStateChanged event.

import { h, disposer } from '../../kit/dom.js';
import { icon } from '../../kit/icon.js';
import { Button, CopyButton } from '../../kit/button.js';
import { PageHeader, Banner } from '../../kit/feedback.js';
import { SeedPhraseGrid, SeedPhraseChallenge } from '../../domain/seed-phrase-grid.js';
import { requirePassword } from '../../domain/password-prompt.js';
import * as bridge from '../bridge.js';
import { decodeRef } from '../../../shared/refs.js';

export function ExportRoute({ params, navigate, back }) {
  const d = disposer();
  const ref = decodeRef(params.ref);
  const isBackupFlow = params.mode === 'backup';

  /** The only copy of the secret. Never leaves this closure. */
  let secret = null;
  let grid = null;
  let challenge = null;
  let revealToggle = null;
  let challengeNotice = null;
  const owned = [];

  const banner = Banner({ tone: 'error' });
  const body = h('div', { class: 'stack stack-4' });
  const header = PageHeader({
    title: isBackupFlow ? 'Back up phrase' : 'Export secret',
    onBack: () => back(),
  });
  const el = h('section', { class: 'screen' }, [header.el, banner.el, body]);

  function wipe() {
    secret = null;
    grid?.destroy();
    grid = null;
    challenge?.destroy();
    challenge = null;
    for (const c of owned) c.destroy?.();
    owned.length = 0;
  }

  function clearBody() {
    while (body.firstChild) body.removeChild(body.firstChild);
  }

  if (!ref) {
    banner.set('That export link is not valid.');
    return { el, destroy() { wipe(); header.destroy(); banner.destroy(); d.dispose(); } };
  }

  // If the wallet locks while a secret is on screen, remove it immediately. The old flow
  // left the value readable and copyable after lock.
  d.add(bridge.onEvent('lockStateChanged', ({ unlocked } = {}) => {
    if (!unlocked) {
      wipe();
      clearBody();
      navigate('/unlock', { replace: true });
    }
  }));

  // ---- Step 1: warn, then authenticate ------------------------------------
  function renderGate() {
    clearBody();

    const warning = h('div', { class: 'notice danger' }, [
      h('div', { class: 'row-flex' }, [
        icon('warning', 16),
        h('strong', { text: 'Anyone with this can take your funds' }),
      ]),
      h('ul', { class: 'warn-list' }, [
        h('li', { text: 'Never type it into a website, form, or support chat.' }),
        h('li', { text: 'Never photograph it or store it in a password manager note.' }),
        h('li', { text: 'Write it on paper and keep it offline.' }),
        h('li', { text: 'Thru staff will never ask for it.' }),
      ]),
    ]);

    const revealBtn = Button({
      label: 'Enter password to reveal',
      variant: 'accent',
      iconName: 'key',
      onClick: async () => {
        const result = await requirePassword({
          title: 'Confirm your password',
          body: 'Your password is re-checked against the encrypted vault, even though the '
            + 'wallet is already unlocked.',
          confirmLabel: 'Reveal secret',
          // The password goes straight into this one call and is discarded. The returned
          // secret never touches the URL, the store, or a data attribute.
          verify: (password) => bridge.send('wallet.exportSecret', { ref, password }),
        });
        if (!result) return;
        secret = result;
        renderSecret();
      },
    });
    owned.push(revealBtn);

    body.appendChild(warning);
    body.appendChild(h('div', { class: 'screen-actions' }, revealBtn.el));
  }

  // ---- Step 2: reveal --------------------------------------------------------
  function renderSecret() {
    clearBody();

    const isMnemonic = secret.kind === 'hd' && secret.mnemonic;
    const value = isMnemonic ? secret.mnemonic : secret.privateKeyHex;

    body.appendChild(h('p', { class: 'hint', text: isMnemonic
      ? 'These 12 words restore every account derived from this phrase. Order matters.'
      : 'This key controls exactly one address.' }));

    let valueNode;
    if (isMnemonic) {
      grid = SeedPhraseGrid({ phrase: value, revealed: false });
      valueNode = grid.el;
    } else {
      // Blurred until requested, so the key is not exposed by simply landing here.
      valueNode = h('div', { class: 'monospace-block blurred', text: value });
    }
    body.appendChild(valueNode);

    const toggleBtn = Button({
      label: 'Tap to reveal',
      variant: 'secondary',
      iconName: 'eye',
      onClick: () => {
        const nowVisible = grid
          ? grid.toggle()
          : (valueNode.classList.toggle('blurred'), !valueNode.classList.contains('blurred'));
        toggleBtn.update({
          label: nowVisible ? 'Hide' : 'Tap to reveal',
          iconName: nowVisible ? 'eyeOff' : 'eye',
        });
      },
    });
    owned.push(toggleBtn);
    revealToggle = toggleBtn;

    const copyBtn = CopyButton({
      getValue: () => value,
      title: 'Copy to clipboard',
      onResult: (err) => banner.set(err ? 'Could not copy — clipboard permission denied.' : ''),
    });
    owned.push(copyBtn);

    body.appendChild(h('div', { class: 'row-flex' }, [
      toggleBtn.el,
      h('span', { class: 'grow' }),
      copyBtn.el,
    ]));

    // Shown only once the challenge starts, to explain why reveal is now disabled.
    challengeNotice = h('p', { class: ['hint', 'hidden'], text:
      'The phrase is hidden while you confirm it. Use your written copy to answer.' });
    body.appendChild(challengeNotice);

    body.appendChild(h('p', { class: 'hint', text:
      'Clipboard contents can be read by other applications. Clear it when you are done.' }));

    if (isBackupFlow && isMnemonic) {
      renderChallenge(value);
    } else {
      const doneBtn = Button({
        label: 'Done',
        variant: 'primary',
        onClick: () => {
          wipe();
          navigate('/accounts', { replace: true });
        },
      });
      owned.push(doneBtn);
      body.appendChild(h('div', { class: 'screen-actions' }, doneBtn.el));
    }
  }

  // ---- Step 3 (backup flow only): prove it was recorded ----------------------
  function renderChallenge(phrase) {
    // The phrase MUST be off screen while the challenge is answered. Leaving it visible
    // makes the confirmation meaningless — the user just reads the answers off the grid
    // above, and the whole point is to prove the words were recorded somewhere else.
    grid?.hide();
    if (revealToggle) {
      revealToggle.update({ label: 'Tap to reveal', iconName: 'eye', disabled: true });
    }
    if (challengeNotice) challengeNotice.classList.remove('hidden');

    const confirmBtn = Button({
      label: 'Confirm backup',
      variant: 'primary',
      disabled: true,
      onClick: async () => {
        try {
          const keyringId = secret?.keyringId || ref.keyringId;
          await bridge.send('keyring.setBackedUp', { keyringId, backedUp: true });
          wipe();
          navigate('/accounts', { replace: true });
        } catch (error) {
          banner.set(error.message || 'Could not record the backup.');
        }
      },
    });
    owned.push(confirmBtn);

    challenge = SeedPhraseChallenge({
      phrase,
      rounds: 3,
      onChange: (allCorrect) => confirmBtn.update({ disabled: !allCorrect }),
    });

    body.appendChild(h('div', { class: 'hr' }));
    body.appendChild(h('p', { class: 'eyebrow', text: 'Confirm you wrote it down' }));
    body.appendChild(challenge.el);
    body.appendChild(h('div', { class: 'screen-actions' }, confirmBtn.el));
  }

  renderGate();

  return {
    el,
    destroy() {
      wipe();
      header.destroy();
      banner.destroy();
      d.dispose();
    },
  };
}
