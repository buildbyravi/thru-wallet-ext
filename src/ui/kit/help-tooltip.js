// A (?) trigger with an in-wallet popover.
//
// The native `title` tooltip belongs to the browser, and the browser is not bound by the
// wallet's 400x600 surface: on a narrow popup (and in the side panel) a long title can
// render partly or fully outside the extension document. This renders the tooltip in the
// screen instead: an absolutely positioned card, right-aligned to a full-width host row
// and capped at 240px, so it can never leave the popup boundary.
//
// Opens on hover and on click (touch has no hover), closes on mouseleave, a second
// click, blur, or when the owning route disposes it.

import { h, disposer } from './dom.js';
import { icon } from './icon.js';

/**
 * @param {{ host: object, label: string, text: string }} options
 *   host — the full-width row that becomes the popover's positioning context. It receives
 *     the `help-tooltip-host` class (position: relative) and the popover as its last
 *     child. Pass a row that spans the content width — never a narrow inline wrapper —
 *     because the card is right-aligned to the host and extends leftward from it.
 *   label — accessible name for the trigger.
 *   text — the popover copy.
 */
export function HelpTooltip({ host, label, text }) {
  const d = disposer();

  const trigger = h('button', {
    type: 'button',
    class: 'help-circle-icon',
    'aria-label': label,
    'aria-expanded': 'false',
  }, icon('help', 13));

  const tip = h('span', { class: 'inline-tooltip', role: 'tooltip', hidden: true }, text);
  host.classList.add('help-tooltip-host');
  host.appendChild(tip);

  function show() {
    tip.removeAttribute('hidden');
    trigger.setAttribute('aria-expanded', 'true');
  }

  function hide() {
    tip.setAttribute('hidden', '');
    trigger.setAttribute('aria-expanded', 'false');
  }

  d.on(trigger, 'mouseenter', show);
  d.on(trigger, 'mouseleave', hide);
  d.on(trigger, 'focus', show);
  d.on(trigger, 'blur', hide);
  // Click only ever OPENS. It never toggles closed, because a touch tap fires a synthetic
  // mouseenter+click pair — a toggle would open then immediately close the popover. Mouse
  // users dismiss by moving away (mouseleave); keyboard users by tabbing off (blur).
  d.on(trigger, 'click', show);

  return {
    trigger,
    tip,
    show,
    hide,
    destroy() {
      d.dispose();
      tip.remove();
      host.classList.remove('help-tooltip-host');
    },
  };
}
