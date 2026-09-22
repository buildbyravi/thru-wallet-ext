import { h, disposer } from '../kit/dom.js';
import { icon } from '../kit/icon.js';

/**
 * USD-first balance readout inside the 196px ink header.
 *
 * @param {Object} props
 *   usd       formatted USD balance (default '$12,847.20')
 *   native    formatted native THRU amount (default '84,291.02 THRU')
 *   delta     24h percentage delta (default '+2.14%')
 *   deltaUsd  24h fiat gain/loss (default '+$268.40')
 *   onRefresh handler for the refresh balance icon button
 */
export function BalanceHero({
  usd = '$12,847.20',
  native = '84,291.02 THRU',
  delta = '+2.14%',
  deltaUsd = '+$268.40',
  onRefresh,
} = {}) {
  const d = disposer();
  const isLoss = String(delta).startsWith('-');

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

  const deltaText = h('span', { text: delta });
  const fiatText = h('span', { class: 'dash-balance-delta-fiat', text: `(${deltaUsd})` });
  const deltaEl = h('div', { class: isLoss ? 'dash-balance-delta loss' : 'dash-balance-delta' }, [
    deltaText,
    fiatText,
  ]);

  const el = h('div', { class: 'dash-balance-hero' }, [row, nativeEl, deltaEl]);

  return {
    el,
    update({ usd: u, native: n, delta: dt, deltaUsd: du }) {
      if (u !== undefined) usdEl.textContent = u;
      if (n !== undefined) nativeEl.textContent = n;
      if (dt !== undefined) {
        deltaText.textContent = dt;
        deltaEl.classList.toggle('loss', String(dt).startsWith('-'));
      }
      if (du !== undefined) fiatText.textContent = `(${du})`;
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
