// Password re-authentication prompt.
//
// The equivalent of Rabby's AuthenticationModal. Required before export, keyring
// add/rename/remove, and reset, per docs/BUILD_SPEC.md Part V.
//
// The important property: the password this collects is handed straight to a single
// backend call and then destroyed. It is never stored on the instance beyond the call,
// never put in the shared store, never in a data attribute, and never in a router param.
// Resolution passes the value to the caller's `verify` callback rather than returning it,
// so there is no point at which a caller can accidentally hold on to it.

import { h, disposer } from '../kit/dom.js';
import { Field } from '../kit/field.js';
import { Button } from '../kit/button.js';
import { icon } from '../kit/icon.js';

/**
 * Open a modal that collects the master password and runs one guarded action.
 *
 * @param {Object} options
 *   title       heading
 *   body        explanatory copy
 *   confirmLabel button text
 *   danger      style the confirm as destructive
 *   verify      async (password) => any   the ONLY consumer of the password
 * @returns {Promise<any|null>} the verify() result, or null if cancelled
 */
export function requirePassword({
  title = 'Confirm your password',
  body = 'Enter your wallet password to continue.',
  confirmLabel = 'Confirm',
  danger = false,
  verify,
} = {}) {
  return new Promise((resolve) => {
    const d = disposer();
    let settled = false;

    const password = Field({
      label: 'Password',
      type: 'password',
      autocomplete: 'current-password',
      autofocus: true,
      onInput: () => password.setError(''),
      onEnter: () => confirm(),
    });

    function finish(value) {
      if (settled) return;
      settled = true;
      // Overwrite then clear before the node leaves the document, so the string is not
      // left addressable in a detached subtree.
      password.clearSecret();
      password.destroy();
      confirmBtn.destroy();
      cancelBtn.destroy();
      d.dispose();
      overlay.remove();
      resolve(value);
    }

    async function confirm() {
      const value = password.value;
      if (!value) {
        password.setError('Enter your password.');
        password.focus();
        return;
      }
      try {
        const result = await verify(value);
        password.clearSecret();
        finish(result === undefined ? true : result);
      } catch (error) {
        password.clearSecret();
        password.setError(error?.message || 'Incorrect password.');
        password.focus();
      }
    }

    const confirmBtn = Button({
      label: confirmLabel,
      variant: danger ? 'danger' : 'primary',
      busyLabel: 'Checking…',
      onClick: () => confirm(),
    });

    const cancelBtn = Button({
      label: 'Cancel',
      variant: 'text',
      onClick: () => finish(null),
    });

    const card = h('div', {
      class: 'modal-card',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': title,
    }, [
      h('div', { class: 'modal-head' }, [
        h('span', { class: ['modal-icon', danger ? 'danger' : ''].filter(Boolean) },
          icon(danger ? 'warning' : 'shield', 18)),
        h('h2', { text: title }),
      ]),
      h('p', { class: 'muted', text: body }),
      password.el,
      h('div', { class: 'stack stack-2' }, [confirmBtn.el, cancelBtn.el]),
    ]);

    const overlay = h('div', { class: 'modal-overlay' }, card);

    // Clicking the backdrop cancels; clicking inside must not.
    d.on(overlay, 'mousedown', (event) => {
      if (event.target === overlay) finish(null);
    });
    d.on(document, 'keydown', (event) => {
      if (event.key === 'Escape') finish(null);
    });

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));
  });
}
