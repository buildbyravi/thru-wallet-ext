// Unlock route — the first screen on the new stack.
//
// MERGED FROM TWO EXISTING IMPLEMENTATIONS. Neither was a superset of the other:
//
//   From screens/unlock.js (better):
//     - empty-password guard before calling the backend
//     - show/hide reveal toggle
//     - autofocus
//     - clears the field and refocuses on failure
//
//   From popup.js + popup.html (better):
//     - nothing behavioural; its only advantage was being reachable at all
//
//   Fixed here, wrong in BOTH:
//     - teardown. Both push closures that call removeEventListener with a NEWLY created
//       arrow function, so nothing is ever removed. The kit's disposer holds the real
//       handler references.
//     - the password string was left in the input's value on success. It is now
//       overwritten and cleared via Field.clearSecret().
//     - `onsubmit="return false;"` in the module's markup is silently blocked by CSP, so
//       its form was never actually prevented from navigating. A real submit listener with
//       preventDefault replaces it.
//     - lockout state was never surfaced. The background now enforces exponential backoff,
//       so the UI must show the wait instead of letting the user retype into a rejection.

import { h, disposer } from '../../kit/dom.js';
import { icon } from '../../kit/icon.js';
import { Field } from '../../kit/field.js';
import { Button } from '../../kit/button.js';
import { Banner } from '../../kit/feedback.js';
import * as bridge from '../bridge.js';
import { invalidate } from '../guards.js';

export function UnlockRoute({ navigate }) {
  const d = disposer();
  let countdownTimer = null;

  const banner = Banner({ tone: 'error' });

  const password = Field({
    label: 'Password',
    type: 'password',
    autocomplete: 'current-password',
    placeholder: 'Enter your password',
    autofocus: true,
    onInput: () => {
      password.setError('');
      banner.clear();
    },
    onEnter: () => submit(),
  });

  const unlockBtn = Button({
    label: 'Unlock',
    variant: 'primary',
    type: 'submit',
    busyLabel: 'Unlocking…',
    onClick: (event) => {
      event.preventDefault();
      return submit();
    },
  });

  const resetBtn = Button({
    label: 'Reset wallet on this device',
    variant: 'text',
    onClick: () => navigate('/reset'),
  });

  function stopCountdown() {
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
  }

  /**
   * Show a live countdown while the backend's backoff window is open. Disabling the
   * control is honest here: the attempt genuinely cannot succeed yet, and letting someone
   * retype a correct password into a guaranteed rejection is worse than saying wait.
   */
  function startCountdown(retryInMs) {
    stopCountdown();
    let remaining = Math.ceil(retryInMs / 1000);
    password.setDisabled(true);
    unlockBtn.update({ disabled: true });

    const tick = () => {
      if (remaining <= 0) {
        stopCountdown();
        password.setDisabled(false);
        unlockBtn.update({ disabled: false });
        banner.clear();
        password.focus();
        return;
      }
      banner.set(`Too many attempts. Try again in ${remaining}s.`, 'warning');
      remaining -= 1;
    };
    tick();
    countdownTimer = setInterval(tick, 1000);
    d.add(stopCountdown);
  }

  async function submit() {
    if (unlockBtn.el.disabled) return;

    const value = password.value;
    if (!value) {
      password.setError('Enter your password to continue.');
      password.focus();
      return;
    }

    banner.clear();
    password.setError('');

    try {
      await bridge.send('wallet.unlock', { password: value });
      // Clear before navigating: the string must not outlive this screen.
      password.clearSecret();
      invalidate();
      navigate('/dashboard', { replace: true });
    } catch (error) {
      password.clearSecret();

      if (error.code === 'AUTH_LOCKED_OUT') {
        try {
          const lockout = await bridge.send('wallet.getLockoutState');
          startCountdown(lockout?.retryInMs || 5000);
        } catch {
          banner.set(error.message, 'warning');
        }
        return;
      }

      password.setError(error.message || 'Incorrect password.');
      password.focus();
    }
  }

  const form = h('form', { class: 'unlock-form', novalidate: true }, [
    password.el,
    banner.el,
    unlockBtn.el,
    resetBtn.el,
  ]);

  // A real listener with preventDefault. The old `onsubmit="return false;"` attribute was
  // injected via innerHTML and blocked by the extension CSP, so it never ran.
  d.on(form, 'submit', (event) => {
    event.preventDefault();
    submit();
  });

  const el = h('section', { class: 'screen' }, [
    h('div', { class: 'unlock-container' }, [
      h('div', { class: 'unlock-brand' }, [
        h('div', { class: 'unlock-icon-wrap' }, icon('lock', 24)),
        h('h1', { text: 'Welcome back' }),
        h('p', { class: 'muted', text: 'Enter your password to unlock your wallet.' }),
      ]),
      form,
    ]),
  ]);

  // If a backoff window is already open when the screen mounts (the user reopened the
  // popup mid-lockout), show it immediately rather than after a failed attempt.
  bridge.send('wallet.getLockoutState')
    .then((lockout) => {
      if (lockout?.retryInMs > 0) startCountdown(lockout.retryInMs);
    })
    .catch(() => {});

  return {
    el,
    destroy() {
      stopCountdown();
      password.destroy();
      unlockBtn.destroy();
      resetBtn.destroy();
      d.dispose();
    },
  };
}
