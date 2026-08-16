// Field primitive: label + control + inline error + hint, as one unit.
//
// `setError` exists in EIGHT near-identical copies across the old UI (popup.js:102,
// send.js:468, faucet.js:80, unlock.js:106, create-password.js:99, import.js:143,
// add-key.js:82, export-password.js:101). All eight toggle a `.hidden` class and set
// textContent. Owning that here removes the duplication and lets error state also drive
// aria-invalid and aria-describedby, which none of the eight copies do — so screen
// readers currently never learn that a field is invalid.

import { h, disposer } from './dom.js';
import { icon } from './icon.js';

let uid = 0;
function nextId(prefix) {
  uid += 1;
  return `${prefix}-${uid}`;
}

/**
 * @param {Object} props
 *   label        string
 *   type         input type (default 'text'); 'password' adds a reveal toggle
 *   name         input name
 *   placeholder  string
 *   hint         helper text under the control
 *   value        initial value
 *   multiline    render a textarea
 *   rows         textarea rows (default 3)
 *   secret       true for seed phrases / private keys — hardens the control, see below
 *   autofocus    boolean
 *   inputMode    e.g. 'decimal'
 *   maxLength    number
 *   onInput      (value) => void
 *   onEnter      () => void   fires on Enter for single-line controls
 */
export function Field(props = {}) {
  const d = disposer();
  const {
    label, type = 'text', name, placeholder, hint, value = '',
    multiline = false, rows = 3, secret = false, autofocus = false,
    inputMode, maxLength, onInput, onEnter,
  } = props;

  const controlId = nextId('f');
  const errorId = `${controlId}-err`;
  const hintId = `${controlId}-hint`;

  const isPassword = type === 'password';

  const control = multiline
    ? h('textarea', {
      id: controlId,
      name,
      rows,
      placeholder,
      class: 'textarea-lg',
      maxlength: maxLength,
    })
    : h('input', {
      id: controlId,
      name,
      type: isPassword ? 'password' : type,
      placeholder,
      inputmode: inputMode,
      maxlength: maxLength,
    });

  control.value = value;

  // Secret inputs must never reach a spell checker, an autofill store, or an
  // autocapitalise pass. With Chrome's Enhanced Spell Check enabled, a spellchecked
  // textarea sends its contents to Google — a documented seed-phrase exfiltration path.
  // The two textareas that actually render in popup.html today have none of these.
  if (secret) {
    control.setAttribute('autocomplete', 'off');
    control.setAttribute('autocorrect', 'off');
    control.setAttribute('autocapitalize', 'off');
    control.setAttribute('spellcheck', 'false');
    control.setAttribute('data-lpignore', 'true');
  } else if (isPassword) {
    control.setAttribute('autocomplete', props.autocomplete || 'current-password');
    control.setAttribute('spellcheck', 'false');
  }

  const errorEl = h('p', { class: ['error', 'hidden'], id: errorId, role: 'alert' });
  const hintEl = hint ? h('p', { class: 'hint', id: hintId, text: hint }) : null;

  let controlWrap = control;
  let toggle = null;
  if (isPassword) {
    toggle = h('button', {
      type: 'button',
      class: 'icon-btn-ghost password-toggle',
      title: 'Show password',
      'aria-label': 'Show password',
      'aria-pressed': 'false',
    }, icon('eye', 15));

    d.on(toggle, 'click', () => {
      const revealing = control.type === 'password';
      control.type = revealing ? 'text' : 'password';
      toggle.replaceChildren(icon(revealing ? 'eyeOff' : 'eye', 15));
      const next = revealing ? 'Hide password' : 'Show password';
      toggle.title = next;
      toggle.setAttribute('aria-label', next);
      toggle.setAttribute('aria-pressed', revealing ? 'true' : 'false');
    });

    controlWrap = h('div', { class: 'password-input-wrap' }, [control, toggle]);
  }

  const el = h('label', { class: 'field', for: controlId }, [
    label ? h('span', { text: label }) : null,
    controlWrap,
    hintEl,
    errorEl,
  ]);

  if (typeof onInput === 'function') {
    d.on(control, 'input', () => onInput(control.value));
  }
  if (typeof onEnter === 'function' && !multiline) {
    d.on(control, 'keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        onEnter();
      }
    });
  }

  if (autofocus) {
    // A focus() call during mount lands before the element is in the document, so it is
    // deferred a frame rather than silently doing nothing.
    requestAnimationFrame(() => control.focus());
  }

  function describedBy() {
    const ids = [];
    if (!errorEl.classList.contains('hidden')) ids.push(errorId);
    if (hintEl) ids.push(hintId);
    if (ids.length) control.setAttribute('aria-describedby', ids.join(' '));
    else control.removeAttribute('aria-describedby');
  }
  describedBy();

  return {
    el,
    control,
    get value() {
      return control.value;
    },
    set value(next) {
      control.value = next ?? '';
    },
    focus() {
      control.focus();
    },
    setError(message) {
      if (message) {
        errorEl.textContent = String(message);
        errorEl.classList.remove('hidden');
        control.setAttribute('aria-invalid', 'true');
      } else {
        errorEl.textContent = '';
        errorEl.classList.add('hidden');
        control.removeAttribute('aria-invalid');
      }
      describedBy();
    },
    setDisabled(disabled) {
      control.disabled = Boolean(disabled);
      if (toggle) toggle.disabled = Boolean(disabled);
    },
    /**
     * Overwrite the value then clear it. Called when navigating away from a screen that
     * held a secret, so the string is not left addressable in the DOM.
     */
    clearSecret() {
      try {
        control.value = '\u0000'.repeat(Math.max(8, String(control.value || '').length));
      } catch {
        // ignore
      }
      control.value = '';
      if (control.type === 'text' && isPassword) control.type = 'password';
    },
    destroy() {
      this.clearSecret();
      d.dispose();
      el.remove();
    },
  };
}
