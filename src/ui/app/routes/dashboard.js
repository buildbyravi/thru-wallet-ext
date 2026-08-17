// Dashboard route — the landing screen.
//
// MERGED FROM TWO EXISTING IMPLEMENTATIONS after diffing them:
//
//   From popup.js loadDashboard/refreshBalance (better):
//     - raw base-unit hint under the balance
//     - auto-creates the on-chain account when it does not exist yet
//     - renders deployed tokens alongside native THRU
//
//   From screens/dashboard.js (better):
//     - a real refresh affordance with spin feedback
//     - explicit account pill wiring rather than a delegated data-action
//
//   Fixed here, wrong in BOTH:
//     - dashboard.js's cleanup() removed the pill/copy/lock/refresh listeners, and
//       'go-dashboard' never re-mounted the module, so those four buttons died permanently
//       after one round trip to any other screen. disposer() plus the router's guaranteed
//       destroy/mount cycle makes that structural.
//     - popup.js read t.ticker while the token service now normalizes to t.symbol, so every
//       deployed token rendered as "TOKEN".
//     - neither showed pending transactions, so a submitted transfer vanished until the user
//       reloaded history. The backend tracks them now, so the UI shows them.
//     - balance was fetched with a single blocking call before anything rendered; this paints
//       from cache first and corrects itself.

import { h, disposer } from '../../kit/dom.js';
import { icon } from '../../kit/icon.js';
import { Button, IconButton, CopyButton } from '../../kit/button.js';
import { Banner, Empty } from '../../kit/feedback.js';
import { AccountAvatar, AddressText } from '../../domain/account-avatar.js';
import { AssetRow } from '../../domain/token-row.js';
import * as bridge from '../bridge.js';
import { formatThru } from '../../../shared/format.js';

/**
 * One button in the quick-action grid.
 *
 * Uses the existing .action-btn class and its exact child shape (svg + span) rather than
 * inventing .action-tile. Duplicating a style that already exists is how stylesheets grow
 * dead rules, and screens.css already had ~200 unreachable lines.
 */
function ActionTile({ iconName, label, onClick }) {
  const d = disposer();
  const el = h('button', { type: 'button', class: 'action-btn' }, [
    icon(iconName, 17),
    h('span', { text: label }),
  ]);
  d.on(el, 'click', onClick);
  return { el, destroy() { d.dispose(); el.remove(); } };
}

export function DashboardRoute({ navigate }) {
  const d = disposer();
  const owned = [];
  let account = null;
  let assetRows = [];

  function track(c) { owned.push(c); return c; }

  const banner = Banner({ tone: 'error' });

  // ---- Account pill ------------------------------------------------------
  const pillMark = h('span', { class: 'shrink-0' }, AccountAvatar({ address: '' }));
  const pillName = h('span', { class: 'account-pill-name', text: 'Account' });
  const pillAddr = h('span', { class: 'account-pill-address', text: '—' });

  const pill = h('button', {
    type: 'button',
    class: 'account-pill',
    title: 'Switch account',
  }, [
    pillMark,
    h('span', { class: 'account-pill-meta' }, [pillName, pillAddr]),
    h('span', { class: 'account-pill-chevron' }, icon('chevronRight', 12)),
  ]);
  d.on(pill, 'click', () => navigate('/accounts'));

  const copyBtn = track(CopyButton({
    getValue: () => account?.address || '',
    title: 'Copy address',
    onResult: (err) => banner.set(err ? 'Could not copy — clipboard permission denied.' : ''),
  }));

  // ---- Balance ------------------------------------------------------------
  const balanceValue = h('span', { class: 'balance-hero-value', text: '—' });

  const refreshBtn = track(IconButton({
    iconName: 'refresh',
    title: 'Refresh balance',
    size: 14,
    variant: 'icon-btn-ghost',
    onClick: () => load({ force: true }),
  }));

  const balanceHero = h('div', { class: 'balance-hero' }, [
    h('div', { class: 'row-flex between' }, [
      h('span', { class: 'eyebrow balance-hero-label', text: 'Balance' }),
      refreshBtn.el,
    ]),
    h('div', { class: 'balance-hero-row' }, [
      balanceValue,
      h('span', { class: 'balance-hero-unit', text: 'THRU' }),
    ]),
  ]);

  // ---- Pending transactions ---------------------------------------------
  const pendingHost = h('div', { class: 'hidden' });

  function renderPending(list) {
    while (pendingHost.firstChild) pendingHost.removeChild(pendingHost.firstChild);
    const active = (list || []).filter((r) => r.status === 'submitted');
    pendingHost.classList.toggle('hidden', active.length === 0);
    if (!active.length) return;
    pendingHost.appendChild(h('div', { class: 'notice warning' }, [
      h('div', { class: 'row-flex' }, [
        icon('spinner', 14, { className: 'spinning' }),
        h('strong', { text: `${active.length} transaction${active.length === 1 ? '' : 's'} pending` }),
      ]),
      h('p', { class: 'hint', text: 'Waiting for on-chain confirmation.' }),
    ]));
  }

  // ---- Actions -----------------------------------------------------------
  const actionGrid = h('div', { class: 'action-grid' }, [
    track(ActionTile({ iconName: 'send', label: 'Send', onClick: () => navigate('/send') })).el,
    track(ActionTile({ iconName: 'receive', label: 'Receive', onClick: () => navigate('/receive') })).el,
    track(ActionTile({ iconName: 'faucet', label: 'Faucet', onClick: () => navigate('/faucet') })).el,
    track(ActionTile({ iconName: 'history', label: 'History', onClick: () => navigate('/history') })).el,
  ]);

  // ---- Launchpad ---------------------------------------------------------
  // Matches the existing .launchpad-banner child structure, including the
  // .launchpad-banner-left wrapper the CSS positions against.
  const launchpad = h('button', { type: 'button', class: 'launchpad-banner' }, [
    h('div', { class: 'launchpad-banner-left' }, [
      h('span', { class: 'launchpad-banner-icon' }, icon('rocket', 17)),
      h('div', { class: 'launchpad-banner-text' }, [
        h('strong', { text: 'Token Launchpad & DEX' }),
        h('span', { class: 'muted', text: 'Deploy & trade native tokens on ThruVM' }),
      ]),
    ]),
    h('span', { class: 'launchpad-banner-arrow' }, icon('external', 13)),
  ]);
  d.on(launchpad, 'click', () => {
    // A full tab, not the popup: the launchpad needs the width.
    chrome.tabs.create({ url: chrome.runtime.getURL('desktop.html') });
  });

  // ---- Assets ------------------------------------------------------------
  const assetsHost = h('div', { class: 'dash-tokens-list' });

  const assetsSection = h('section', { class: 'dash-assets-section' }, [
    h('header', { class: 'dash-assets-header' }, [
      h('span', { class: 'eyebrow', text: 'Assets' }),
    ]),
    assetsHost,
  ]);

  function disposeAssets() {
    for (const row of assetRows) row.destroy();
    assetRows = [];
    while (assetsHost.firstChild) assetsHost.removeChild(assetsHost.firstChild);
  }

  function renderAssets(nativeText, tokens, stale) {
    disposeAssets();

    assetRows.push(AssetRow({
      symbol: 'THRU',
      name: 'Thru Native Token',
      balanceText: nativeText,
      isNative: true,
      stale,
    }));

    for (const token of tokens || []) {
      if (token.hidden) continue;
      assetRows.push(AssetRow({
        // The token service normalizes ticker -> symbol. popup.js still read t.ticker, which
        // is why every deployed token rendered as "TOKEN".
        symbol: token.symbol,
        name: token.name,
        // A deployed mint's supply is NOT this account's balance. Labelling it as a balance
        // would be a lie; owned token balances need Token Program reads that are not verified
        // on Thru yet (docs/BACKEND_GAPS.md C1).
        balanceText: null,
        mintAddress: token.mintAddress,
        imageUrl: token.imageUrl,
      }));
    }

    for (const row of assetRows) assetsHost.appendChild(row.el);

    if (assetRows.length === 1 && !(tokens || []).length) {
      assetsHost.appendChild(Empty({
        iconName: 'coins',
        title: 'No tokens yet',
        body: 'Tokens you deploy will appear here.',
      }).el);
    }
  }

  // ---- Load --------------------------------------------------------------
  async function load({ force = false } = {}) {
    banner.clear();
    refreshBtn.el.classList.add('spinning');

    try {
      account = await bridge.send('account.getActive');
      if (account) {
        pillMark.replaceChildren(AccountAvatar({
          address: account.address,
          imported: account.keyring?.type === 'privateKey',
        }));
        pillName.textContent = account.label || 'Account';
        pillAddr.replaceChildren(AddressText({ address: account.address, chars: 5 }));
      }
    } catch (error) {
      banner.set(error.message || 'Could not load the active account.');
      refreshBtn.el.classList.remove('spinning');
      return;
    }

    // Paint from cache immediately, then correct. The legacy screen blocked on a live RPC
    // before showing anything.
    try {
      const cached = await bridge.send('tx.getCachedBalances', { addresses: [account.address] });
      const entry = cached?.[account.address];
      if (entry) {
        balanceValue.textContent = formatThru(BigInt(entry.balance));
        renderAssets(`${formatThru(BigInt(entry.balance))} THRU`, [], entry.stale);
      }
    } catch {
      // cache miss is not an error
    }

    const [infoResult, tokensResult, pendingResult] = await Promise.allSettled([
      force
        ? bridge.send('tx.getBalances', { addresses: [account.address] })
          .then((m) => m?.[account.address])
        : bridge.send('tx.getAccountInfo', { address: account.address }),
      bridge.send('token.list'),
      bridge.send('tx.getPending'),
    ]);

    refreshBtn.el.classList.remove('spinning');

    let nativeText = '—';
    if (infoResult.status === 'fulfilled' && infoResult.value) {
      const info = infoResult.value;
      const raw = info.balance != null ? BigInt(info.balance) : 0n;
      balanceValue.textContent = formatThru(raw);
      nativeText = `${formatThru(raw)} THRU`;

      // An account with no on-chain record cannot receive; register it in the background.
      // `exists` is absent from the batch shape, so only the direct call can decide this.
      if (info.exists === false) {
        bridge.send('tx.autoCreateAccount').catch(() => {});
      }
    } else if (infoResult.status === 'rejected') {
      banner.set('Could not reach the network. Showing the last known balance.', 'warning');
    }

    const tokens = tokensResult.status === 'fulfilled' ? tokensResult.value : [];
    renderAssets(nativeText, tokens, infoResult.status === 'rejected');

    if (pendingResult.status === 'fulfilled') renderPending(pendingResult.value);
  }

  const el = h('section', { class: 'screen' }, [
    h('div', { class: 'dash-topbar' }, [
      h('div', { class: 'dash-account-group' }, [pill, copyBtn.el]),
    ]),
    banner.el,
    balanceHero,
    pendingHost,
    actionGrid,
    launchpad,
    assetsSection,
  ]);

  load();

  // Push events, so the screen is not stale until the user navigates away and back.
  d.add(
    bridge.onEvent('balanceChanged', (map) => {
      const entry = map?.[account?.address];
      if (!entry) return;
      const raw = BigInt(entry.balance || '0');
      balanceValue.textContent = formatThru(raw);
      if (assetRows[0]) assetRows[0].setBalance(`${formatThru(raw)} THRU`, entry.stale);
    }),
    bridge.onEvent('accountsChanged', () => load()),
    bridge.onEvent('pendingTxChanged', ({ pending } = {}) => renderPending(pending)),
  );

  return {
    el,
    destroy() {
      disposeAssets();
      for (const c of owned) c.destroy?.();
      owned.length = 0;
      banner.destroy();
      d.dispose();
    },
  };
}
