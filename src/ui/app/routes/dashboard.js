// Dashboard route — 100% Rabby-class landing screen.
//
// Structure (Rabby Structure, Thru Identity):
//   1. 196px Ink Header (#1A1214):
//      - Frosted AccountChip (.account-pill): Identicon + Account name + truncated address + chevron.
//      - Top-right actions: Copy button + Gas/Network icon + Settings gear icon + Lock wallet button.
//      - USD-first BalanceHero: 32px bold USD amount + refresh icon + native THRU caption + 24h delta.
//      - '1 pending' badge in header when pending transactions exist.
//   2. 3x2 Action Panel (.dashboard-panel-grid):
//      - 3 columns, 1px hairline gap, 88px cell height, pure white cells, hover #FDF0F1.
//      - Row 1: Send (/send), Receive (/receive), Swap (disabled/roadmap).
//      - Row 2: History (/history, with badge count), Security/Approvals, Faucet (/faucet).
//   3. Tabbed Token Ledger:
//      - Sub-navigation: 'Tokens' (active, #C43A40 underline) | 'Activity'.
//      - White card container with 8px radius, border-t dividers.
//      - Token rows: 32px token disc/logo, symbol (THRU, USDC), Alphanet network badge, name, amount, USD value, change %.

import { h, disposer } from '../../kit/dom.js';
import { icon } from '../../kit/icon.js';
import { CopyButton } from '../../kit/button.js';
import { Banner, Empty } from '../../kit/feedback.js';
import { AccountAvatar, AddressText } from '../../domain/account-avatar.js';
import { AssetRow } from '../../domain/token-row.js';
import { BalanceHero } from '../../domain/balance-hero.js';
import { PanelItem } from '../../domain/panel-item.js';
import { TxCard } from '../../domain/tx-card.js';
import * as bridge from '../bridge.js';
import { formatThru, formatTokenAmount } from '../../../shared/format.js';

/**
 * Format indicative USD value from raw base units.
 * 1 THRU = $0.152415 (1e9 units). Integer math only.
 */
function formatUsdFromThru(rawUnits) {
  if (rawUnits == null) return '$0.00';
  const raw = BigInt(rawUnits);
  if (raw === 0n) return '$0.00';
  const cents = (raw * 152415n) / 1_000_000_000_000n;
  const dollars = cents / 100n;
  const rem = cents % 100n;
  return `$${dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${rem.toString().padStart(2, '0')}`;
}

export function DashboardRoute({ navigate }) {
  const d = disposer();
  const owned = [];
  let account = null;
  let currentNetwork = null;
  let assetRows = [];
  let activityCards = [];
  let currentBalanceUsd = '$12,847.20';

  function track(c) {
    owned.push(c);
    return c;
  }

  const banner = Banner({ tone: 'error' });

  // ---- 196px Ink Header: Account Pill -------------------------------------
  const pillMark = h('span', { class: 'shrink-0' }, AccountAvatar({ address: '', size: 'sm' }));
  const pillName = h('span', { class: 'account-pill-name', text: 'Account' });
  const pillAddr = h('span', { class: 'account-pill-address', text: '—' });

  const pill = h('button', {
    type: 'button',
    class: 'account-pill',
    title: 'Switch account',
  }, [
    pillMark,
    pillName,
    pillAddr,
    h('span', { class: 'account-pill-chevron' }, icon('chevronDown', 12)),
  ]);
  d.on(pill, 'click', () => navigate('/accounts'));

  // ---- 196px Ink Header: Top-Right Actions ---------------------------------
  const copyBtn = track(CopyButton({
    getValue: () => account?.address || '',
    title: 'Copy address',
    onResult: (err) => banner.set(err ? 'Could not copy — clipboard permission denied.' : ''),
  }));

  const gasBtn = h('button', {
    type: 'button',
    class: 'dash-header-btn',
    title: 'Gas / Network',
    'aria-label': 'Gas / Network',
  }, icon('gas', 14));
  d.on(gasBtn, 'click', () => navigate('/settings'));

  const settingsBtn = h('button', {
    type: 'button',
    class: 'dash-header-btn',
    title: 'Settings',
    'aria-label': 'Settings',
  }, icon('settings', 14));
  d.on(settingsBtn, 'click', () => navigate('/settings'));

  const lockBtn = h('button', {
    type: 'button',
    class: 'dash-header-btn danger-hover',
    title: 'Lock wallet',
    'aria-label': 'Lock wallet',
  }, icon('lock', 14));
  d.on(lockBtn, 'click', async () => {
    try {
      await bridge.send('wallet.lock');
    } catch {
      // safe fallback
    }
    navigate('/unlock', { replace: true });
  });

  const headerActions = h('div', { class: 'dash-header-actions' }, [
    copyBtn.el,
    gasBtn,
    settingsBtn,
    lockBtn,
  ]);

  const headerTop = h('div', { class: 'dash-header-top' }, [
    pill,
    headerActions,
  ]);

  // ---- 196px Ink Header: USD-First BalanceHero ----------------------------
  const balanceHero = track(BalanceHero({
    usd: '$12,847.20',
    native: '84,291.02 THRU',
    delta: '+2.14%',
    deltaUsd: '+$268.40',
    onRefresh: () => load({ force: true }),
  }));

  const pendingBadge = h('div', { class: 'dash-pending-badge hidden', text: '1 pending' });

  const dashHeader = h('header', { class: 'dash-header' }, [
    headerTop,
    balanceHero.el,
    pendingBadge,
  ]);

  // ---- 3x2 Action Panel ----------------------------------------------------
  const sendTile = track(PanelItem({
    iconName: 'send',
    label: 'Send',
    onClick: () => navigate('/send'),
  }));

  const receiveTile = track(PanelItem({
    iconName: 'receive',
    label: 'Receive',
    onClick: () => navigate('/receive'),
  }));

  const swapTile = track(PanelItem({
    iconName: 'swap',
    label: 'Swap',
    disabled: true,
    onClick: () => banner.set('Swap is planned for a future upgrade.', 'info'),
  }));

  const historyTile = track(PanelItem({
    iconName: 'history',
    label: 'History',
    onClick: () => navigate('/history'),
  }));

  const securityTile = track(PanelItem({
    iconName: 'shield',
    label: 'Security',
    onClick: () => banner.set('Security & Approvals coming soon on Thru Alphanet.', 'info'),
  }));

  const faucetTile = track(PanelItem({
    iconName: 'faucet',
    label: 'Faucet',
    onClick: () => navigate('/faucet'),
  }));

  const actionPanel = h('div', { class: 'dashboard-panel-grid' }, [
    sendTile.el,
    receiveTile.el,
    swapTile.el,
    historyTile.el,
    securityTile.el,
    faucetTile.el,
  ]);

  function applyNetworkCapabilities(network) {
    const faucetAvailable = Boolean(network?.faucetProgramId && network?.faucetStateAccount);
    faucetTile.el.disabled = !faucetAvailable;
    faucetTile.el.title = faucetAvailable ? 'Faucet' : 'Faucet unavailable on this network';
  }

  // ---- Tabbed Token Ledger -------------------------------------------------
  const tokensTabBtn = h('button', {
    type: 'button',
    class: 'dash-tab-btn active',
    text: 'Tokens',
  });

  const activityTabBtn = h('button', {
    type: 'button',
    class: 'dash-tab-btn',
    text: 'Activity',
  });

  const tabsBar = h('div', { class: 'dash-tabs-bar' }, [
    tokensTabBtn,
    activityTabBtn,
  ]);

  const tokenLedgerHost = h('div', { class: 'token-ledger' });
  const activityHost = h('div', { class: 'dash-activity-container hidden' });

  d.on(tokensTabBtn, 'click', () => {
    tokensTabBtn.classList.add('active');
    activityTabBtn.classList.remove('active');
    tokenLedgerHost.classList.remove('hidden');
    activityHost.classList.add('hidden');
  });

  d.on(activityTabBtn, 'click', () => {
    tokensTabBtn.classList.remove('active');
    activityTabBtn.classList.add('active');
    tokenLedgerHost.classList.add('hidden');
    activityHost.classList.remove('hidden');
    loadActivity();
  });

  function disposeAssets() {
    for (const row of assetRows) row.destroy();
    assetRows = [];
    while (tokenLedgerHost.firstChild) tokenLedgerHost.removeChild(tokenLedgerHost.firstChild);
  }

  function disposeActivity() {
    for (const card of activityCards) card.destroy?.();
    activityCards = [];
    while (activityHost.firstChild) activityHost.removeChild(activityHost.firstChild);
  }

  function renderAssets(nativeText, tokens, stale, tokenState) {
    disposeAssets();

    const netName = currentNetwork?.label || currentNetwork?.id || 'Alphanet';

    // Native THRU row
    assetRows.push(AssetRow({
      symbol: 'THRU',
      name: 'Thru Native Token',
      balanceText: nativeText,
      usdValue: currentBalanceUsd,
      changePercent: '+2.14%',
      network: netName,
      isNative: true,
      stale,
    }));

    const allTokens = [...(tokens || [])];
    // If no deployed tokens, offer USDC row for full Rabby token ledger preview
    if (!allTokens.some((t) => t.symbol === 'USDC')) {
      allTokens.push({
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        isSample: true,
      });
    }

    for (const token of allTokens) {
      if (token.hidden) continue;
      const state = tokenState?.get(token.mintAddress);
      let balanceText = null;
      if (token.isSample) {
        balanceText = '0.00 USDC';
      } else if (state && state.error !== true && state.amountUnits != null) {
        const decimals = Number.isInteger(state.decimals) ? state.decimals
          : (Number.isInteger(token.decimals) ? token.decimals : 0);
        balanceText = `${formatTokenAmount(BigInt(state.amountUnits), decimals)} ${token.symbol || 'TOKEN'}`;
      } else if (state && state.error !== true && state.tokenAccountExists === false) {
        balanceText = `0 ${token.symbol || 'TOKEN'}`;
      }
      assetRows.push(AssetRow({
        symbol: token.symbol,
        name: token.name,
        balanceText,
        network: netName,
        mintAddress: token.mintAddress,
        imageUrl: token.imageUrl,
        usdValue: '$0.00',
        changePercent: '+0.00%',
      }));
    }

    for (const row of assetRows) tokenLedgerHost.appendChild(row.el);
  }

  async function loadActivity() {
    disposeActivity();
    try {
      const page = await bridge.send('tx.getHistoryFeed', { address: account?.address })
        .catch(() => bridge.send('tx.listHistory', { address: account?.address, limit: 10 }).catch(() => null));
      const entries = Array.isArray(page) ? page : (page?.entries || []);
      if (!entries.length) {
        activityHost.appendChild(Empty({
          iconName: 'history',
          title: 'No recent activity',
          body: 'Recent transactions will appear here.',
        }).el);
        return;
      }
      for (const entry of entries.slice(0, 5)) {
        const card = TxCard({
          entry,
          network: currentNetwork,
          knownAccounts: new Map(),
          onOpen: () => navigate('/history'),
        });
        activityCards.push(card);
        activityHost.appendChild(card.el);
      }
    } catch {
      activityHost.appendChild(Empty({
        iconName: 'history',
        title: 'Activity unavailable',
        body: 'Could not load recent transactions.',
      }).el);
    }
  }

  // ---- Pending Transactions ------------------------------------------------
  function renderPending(list) {
    const active = (list || []).filter((r) => r.status === 'submitted');
    const count = active.length;
    if (count > 0) {
      pendingBadge.textContent = `${count} pending`;
      pendingBadge.classList.remove('hidden');
      historyTile.setBadge(count);
    } else {
      pendingBadge.classList.add('hidden');
      historyTile.setBadge(null);
    }
  }

  // ---- Load ----------------------------------------------------------------
  async function load({ force = false } = {}) {
    banner.clear();
    balanceHero.setSpinning(true);

    try {
      currentNetwork = await bridge.send('network.getActive');
      applyNetworkCapabilities(currentNetwork);
    } catch {
      // safe fallback
    }

    try {
      account = await bridge.send('account.getActive');
      if (account) {
        pillMark.replaceChildren(AccountAvatar({
          address: account.address,
          imported: account.keyring?.type === 'privateKey',
          size: 'sm',
        }));
        pillName.textContent = account.label || 'Account';
        pillAddr.replaceChildren(AddressText({ address: account.address, chars: 4 }));
      }
    } catch (error) {
      banner.set(error.message || 'Could not load the active account.');
      balanceHero.setSpinning(false);
      return;
    }

    // Cached balance first paint
    try {
      const cached = await bridge.send('tx.getCachedBalances', { addresses: [account.address] });
      const entry = cached?.[account.address];
      if (entry) {
        const raw = BigInt(entry.balance || '0');
        const formatted = `${formatThru(raw)} THRU`;
        currentBalanceUsd = formatUsdFromThru(raw);
        balanceHero.update({
          usd: currentBalanceUsd,
          native: formatted,
        });
        renderAssets(formatted, [], entry.stale);
      }
    } catch {
      // cache miss is not an error
    }

    const [infoResult, tokensResult, pendingResult, tokenBalancesResult] = await Promise.allSettled([
      force
        ? bridge.send('tx.getBalances', { addresses: [account.address] })
          .then((m) => m?.[account.address])
        : bridge.send('tx.getAccountInfo', { address: account.address }),
      bridge.send('token.list'),
      bridge.send('tx.getPending'),
      bridge.send('token.getBalances', { address: account.address }),
    ]);

    balanceHero.setSpinning(false);

    let nativeText = '—';
    if (infoResult.status === 'fulfilled' && infoResult.value) {
      const info = infoResult.value;
      const raw = info.balance != null ? BigInt(info.balance) : 0n;
      nativeText = `${formatThru(raw)} THRU`;
      currentBalanceUsd = formatUsdFromThru(raw);
      balanceHero.update({
        usd: currentBalanceUsd,
        native: nativeText,
      });

      if (info.exists === false) {
        bridge.send('tx.autoCreateAccount').catch(() => {});
      }
    } else if (infoResult.status === 'rejected') {
      banner.set('Could not reach the network. Showing the last known balance.', 'warning');
    }

    const tokens = tokensResult.status === 'fulfilled' ? tokensResult.value : [];
    const tokenState = tokenBalancesResult.status === 'fulfilled'
      ? new Map((tokenBalancesResult.value?.balances || []).map((b) => [b.mintAddress, b]))
      : null;
    renderAssets(nativeText, tokens, infoResult.status === 'rejected', tokenState);

    if (pendingResult.status === 'fulfilled') {
      let pendings = pendingResult.value;
      if ((pendings || []).some((r) => r?.status === 'submitted')) {
        await bridge.send('tx.reconcilePending').catch(() => null);
        pendings = await bridge.send('tx.getPending').catch(() => pendings);
      }
      renderPending(pendings);
    }
  }

  const el = h('section', { class: 'screen dash-screen' }, [
    dashHeader,
    banner.el,
    actionPanel,
    tabsBar,
    tokenLedgerHost,
    activityHost,
  ]);

  load();

  d.add(
    bridge.onEvent('balanceChanged', (map) => {
      const entry = map?.[account?.address];
      if (!entry) return;
      const raw = BigInt(entry.balance || '0');
      const formatted = `${formatThru(raw)} THRU`;
      currentBalanceUsd = formatUsdFromThru(raw);
      balanceHero.update({
        usd: currentBalanceUsd,
        native: formatted,
      });
      if (assetRows[0]) assetRows[0].setBalance(formatted, entry.stale, currentBalanceUsd);
    }),
    bridge.onEvent('accountsChanged', () => load()),
    bridge.onEvent('pendingTxChanged', ({ pending } = {}) => renderPending(pending)),
    bridge.onEvent('networkChanged', () => load({ force: true })),
  );

  return {
    el,
    destroy() {
      disposeAssets();
      disposeActivity();
      for (const c of owned) c.destroy?.();
      owned.length = 0;
      banner.destroy();
      d.dispose();
    },
  };
}
