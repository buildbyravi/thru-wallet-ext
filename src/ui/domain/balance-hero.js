import { h, disposer } from '../kit/dom.js';
import { icon } from '../kit/icon.js';

/**
 * USD-first balance readout inside the 196px ink header.
 *
 * There is deliberately no 24h-delta line: this wallet has no price or market-data
 * source, so any percentage here would be fabricated. The previous iteration rendered
 * a static '+2.14% (+$268.40)' that load() never updated, pinning invented numbers
 * beside a real balance — a dashboard whose first impression is a fake is worse than
 * one with no delta at all. If a price feed lands, add the delta back with its source.
 *
 * @param {Object} props
 *   usd       formatted USD balance (default '$0.00' — neutral, never invented)
 *   native    formatted native THRU amount (default '—' until the first real value)
 *   summary   one quiet line of token symbols (e.g. 'THRU · LAB') — real symbols only,
 *             the Rabby balance-card chain-chips analog
 *   onRefresh handler for the refresh balance icon button
 *   onOpen    handler for the box itself: the whole hero is the token-drawer entry
 *             (Rabby's clickable balance card). When present the hero becomes a real
 *             control — role=button, tabindex=0, Enter/Space — not just a div with a
 *             mouse handler.
 */
export function BalanceHero({
  usd = '$0.00',
  native = '—',
  summary = '',
  onRefresh,
  onOpen,
} = {}) {
  const d = disposer();

  const refreshBtn = h('button', {
    type: 'button',
    class: 'dash-header-btn',
    title: 'Refresh balance',
    'aria-label': 'Refresh balance',
  }, icon('refresh', 14));

  if (onRefresh) {
    d.on(refreshBtn, 'click', (event) => {
      // The refresh button lives INSIDE the clickable box; without this the click would
      // also open the token drawer. Guarded: tests invoke this handler directly with no
      // event at all.
      event?.stopPropagation?.();
      onRefresh(event);
    });
  }

  const usdEl = h('div', { class: 'dash-balance-usd', text: usd });
  const row = h('div', { class: 'dash-balance-row' }, [usdEl, refreshBtn]);
  const nativeEl = h('div', { class: 'dash-balance-native', text: native });
  const summaryEl = h('div', {
    class: `dash-balance-summary${summary ? '' : ' hidden'}`,
    text: summary,
  });

  const elAttrs = { class: 'dash-balance-hero' };
  if (onOpen) {
    elAttrs.role = 'button';
    elAttrs.tabindex = '0';
    elAttrs.title = 'Open token list';
    elAttrs['aria-label'] = 'Open token list';
    elAttrs.class = 'dash-balance-hero clickable';
  }
  const el = h('div', elAttrs, [row, nativeEl, summaryEl]);

  if (onOpen) {
    d.on(el, 'click', () => onOpen());
    d.on(el, 'keydown', (event) => {
      // Only when the hero ITSELF is focused: Enter/Space on the nested refresh button
      // must refresh, not also open the drawer.
      if (event.target !== el) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onOpen();
      }
    });
  }

  return {
    el,
    update({ usd: u, native: n, summary: s } = {}) {
      if (u !== undefined) usdEl.textContent = u;
      if (n !== undefined) nativeEl.textContent = n;
      if (s !== undefined) {
        summaryEl.textContent = s;
        summaryEl.classList.toggle('hidden', !s);
      }
    },
    setSpinning(spinning) {
      refreshBtn.classList.toggle('spinning', Boolean(spinning));
    },
    destroy() {
      d.dispose();
      el.remove();
    },
  };
}
