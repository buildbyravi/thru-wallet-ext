// Dashboard route — 100% Rabby-class landing screen.
//
// Structure (Rabby Structure, Thru Identity):
//   1. 196px Ink Header (#1A1214):
//      - Frosted AccountChip (.account-pill): Identicon + Account name + truncated address + chevron.
//      - Top-right actions: Copy button (same .dash-header-btn treatment as its siblings,
//        not the white .icon-btn surface) + Gas/Network icon + Side-panel icon (its native
//        hover title explains what it does — no extra chrome for a one-line explanation)
//        + Settings gear icon + Lock wallet button.
//      - USD-first BalanceHero: 32px bold USD amount + frameless refresh icon + native THRU
//        caption. No 24h delta line — this wallet has no market-data source, so a delta
//        would be fabricated.
//      - '1 pending' badge in header when pending transactions exist.
//   2. 3x2 Action Panel (.dashboard-panel-grid):
//      - 3 columns, 1px hairline gap, 88px cell height, pure white cells, hover #FDF0F1.
//      - Row 1: Send (/send), Receive (/receive), Swap (disabled/roadmap).
//      - Row 2: History (/history, with badge count), Security/Approvals, Faucet (/faucet).
//   3. Token Ledger:
//      - Section label: 'Tokens' (active, #C43A40 underline). There is deliberately no
//        'Activity' tab here: recent transactions already have the History tile above and
//        the full /history screen with filters, and a second, shallower copy of the same
//        list is a dead tab.
//      - White card container with 8px radius, border-t dividers.
//      - Token rows: 32px token disc/logo, symbol (THRU, USDC), Alphanet network badge, name, amount, USD value.

import { h, disposer } from '../../kit/dom.js';
import { icon } from '../../kit/icon.js';
import { CopyButton } from '../../kit/button.js';
import { Banner } from '../../kit/feedback.js';
import { AccountAvatar, AddressText } from '../../domain/account-avatar.js';
import { AssetRow } from '../../domain/token-row.js';
import { BalanceHero } from '../../domain/balance-hero.js';
import { PanelItem } from '../../domain/panel-item.js';
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
  // '$0.00' until the first REAL value lands. The old default painted a fabricated
  // '$12,847.20' on first frame for every wallet, including fresh ones with a zero balance.
  let currentBalanceUsd = '$0.00';

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

  // ---- 196px Ink Header: Copy + Top-Right Actions --------------------------
  // The copy button sits next to the account pill (Rabby layout) and wears the SAME
  // .dash-header-btn treatment as its siblings — not the white .icon-btn surface that
  // made it read as a foreign 32px card inside the 28px dark-icon row.
  const copyBtn = track(CopyButton({
    getValue: () => account?.address || '',
    title: 'Copy address',
    className: 'dash-header-btn',
    onResult: (err) => banner.set(err ? 'Could not copy — clipboard permission denied.' : ''),
  }));

  const gasBtn = h('button', {
    type: 'button',
    class: 'dash-header-btn',
    title: 'Gas / Network',
    'aria-label': 'Gas / Network',
  }, icon('gas', 14));
  d.on(gasBtn, 'click', () => navigate('/settings'));

  // Side panel: the windowId is cached at mount, never awaited inside the click handler.
  // chrome.sidePanel.open() only runs inside a transient user gesture, and an await
  // between the gesture and the call (the old code awaited chrome.windows.getCurrent()
  // on every click) is exactly how a perfectly supported browser reports "no user
  // gesture". Same pattern the Settings route used before its Window section moved here.
  let sidePanelWindowId = null;
  try {
    if (chrome?.sidePanel?.open && chrome?.windows?.getCurrent) {
      Promise.resolve(chrome.windows.getCurrent())
        .then((win) => { if (win?.id != null) sidePanelWindowId = win.id; })
        .catch(() => {});
    }
  } catch {
    // Not in an extension context: the button says so on click.
  }

  // The native hover title carries the explanation — the Settings paragraph that used to
  // explain this is gone, and a one-line "why" does not need its own icon in the header.
  const sidePanelBtn = h('button', {
    type: 'button',
    class: 'dash-header-btn',
    title: 'Open in side panel beside your tab',
    'aria-label': 'Open in side panel beside your tab',
  }, icon('sidePanel', 14));
  d.on(sidePanelBtn, 'click', () => {
    try {
      if (!chrome?.sidePanel?.open) {
        banner.set('This browser has no side panel API. The popup keeps working as usual.', 'warning');
        return;
      }
      const openCall = chrome.sidePanel.open(
        sidePanelWindowId != null ? { windowId: sidePanelWindowId } : {},
      );
      // Close the popup only once the open actually succeeded — closing first would
      // strand the user with nothing if the call is rejected.
      Promise.resolve(openCall)
        .then(() => {
          if (typeof window !== 'undefined' && typeof window.close === 'function') {
            window.close();
          }
        })
        .catch((error) => {
          banner.set(error?.message || 'Could not open the side panel.', 'warning');
        });
    } catch (error) {
      banner.set(error?.message || 'Could not open the side panel.', 'warning');
    }
  });

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
    gasBtn,
    sidePanelBtn,
    settingsBtn,
    lockBtn,
  ]);

  const headerTop = h('div', { class: 'dash-header-top' }, [
    pill,
    copyBtn.el,
    headerActions,
  ]);

  // ---- 196px Ink Header: USD-First BalanceHero ----------------------------
  const balanceHero = track(BalanceHero({
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

  // ---- Token Ledger --------------------------------------------------------
  // One section, one tab. The former 'Activity' tab rendered a five-entry preview of the
  // same list that /history already shows in full with filters, and it duplicated the
  // History tile two rows up. Recent transactions belong in History; the dashboard keeps
  // the ledger.
  const tokensTabBtn = h('button', {
    type: 'button',
    class: 'dash-tab-btn active',
    text: 'Tokens',
  });

  const tabsBar = h('div', { class: 'dash-tabs-bar' }, [tokensTabBtn]);

  const tokenLedgerHost = h('div', { class: 'token-ledger' });

  function disposeAssets() {
    for (const row of assetRows) row.destroy();
    assetRows = [];
    while (tokenLedgerHost.firstChild) tokenLedgerHost.removeChild(tokenLedgerHost.firstChild);
  }

  function renderAssets(nativeText, tokens, stale, tokenState) {
    disposeAssets();

    const netName = currentNetwork?.label || currentNetwork?.id || 'Alphanet';

    // Native THRU row. No changePercent: there is no 24h data source, so any percentage
    // here would be fabricated market data.
    assetRows.push(AssetRow({
      symbol: 'THRU',
      name: 'Thru Native Token',
      balanceText: nativeText,
      usdValue: currentBalanceUsd,
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
      }));
    }

    for (const row of assetRows) tokenLedgerHost.appendChild(row.el);
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
      for (const c of owned) c.destroy?.();
      owned.length = 0;
      banner.destroy();
      d.dispose();
    },
  };
}
