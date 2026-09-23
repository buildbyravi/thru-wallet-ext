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
 *   onRefresh handler for the refresh balance icon button
 */
export function BalanceHero({
  usd = '$0.00',
  native = '—',
  onRefresh,
} = {}) {
  const d = disposer();

  const refreshBtn = h('button', {
    type: 'button',
    class: 'dash-header-btn',
    title: 'Refresh balance',
    'aria-label': 'Refresh balance',
  }, icon('refresh', 14));

  if (onRefresh) {
    d.on(refreshBtn, 'click', onRefresh);
  }

  const usdEl = h('div', { class: 'dash-balance-usd', text: usd });
  const row = h('div', { class: 'dash-balance-row' }, [usdEl, refreshBtn]);
  const nativeEl = h('div', { class: 'dash-balance-native', text: native });

  const el = h('div', { class: 'dash-balance-hero' }, [row, nativeEl]);

  return {
    el,
    update({ usd: u, native: n } = {}) {
      if (u !== undefined) usdEl.textContent = u;
      if (n !== undefined) nativeEl.textContent = n;
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
