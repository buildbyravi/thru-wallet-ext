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
//        caption + a quiet token-symbols summary line. The whole box is the token-drawer
//        entry (Rabby's clickable balance card): click anywhere in it, or Enter/Space.
//        No 24h delta line — this wallet has no market-data source, so a delta would be
//        fabricated.
//      - '1 pending' badge in header when pending transactions exist.
//   2. 3x2 Action Panel (.dashboard-panel-grid):
//      - 3 columns, 1px hairline gap, 88px cell height, pure white cells, hover #FDF0F1.
//      - Row 1: Send (/send), Receive (/receive), Swap (disabled/roadmap).
//      - Row 2: History (/history, with badge count), Security/Approvals, Faucet (/faucet).
//   3. Token drawer (Rabby balance-card → asset-list popup):
//      - The TOKEN LIST lives in the drawer (src/ui/domain/token-drawer.js), opened from
//        the balance box — "click anywhere in the box". There is NO separate Tokens
//        button below the grid: the box carries its own 'Assets ›' cue instead.
//      - The drawer owns search, the ledger rows and the two-view 'Add custom token' flow
//        (mint verified on-chain before import; the list is hidden while adding).
//   4. Security tile → SecuritySheet (real posture checks), never an inline banner.
//      Transient one-line feedback uses toast(), persistent state uses Banner.

import { h, disposer } from '../../kit/dom.js';
import { icon } from '../../kit/icon.js';
import { CopyButton } from '../../kit/button.js';
import { Banner } from '../../kit/feedback.js';
import { toast } from '../../kit/toast.js';
import { AccountAvatar, AddressText } from '../../domain/account-avatar.js';
import { BalanceHero } from '../../domain/balance-hero.js';
import { PanelItem } from '../../domain/panel-item.js';
import { TokenDrawer } from '../../domain/token-drawer.js';
import { SecuritySheet } from '../../domain/security-sheet.js';
import * as bridge from '../bridge.js';
import { formatThru } from '../../../shared/format.js';

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


  // Side panel: the windowId is cached at mount, never awaited inside the click handler.
  // chrome.sidePanel.open() only runs inside a transient user gesture, and an await
  // between the gesture and the call (the old code awaited chrome.windows.getCurrent()
  // on every click) is exactly how a perfectly supported browser reports "no user
  // gesture". The Settings "Side Panel Mode" toggle only flips setPanelBehavior; this
  // button is the one-off open, so it keeps its own gesture-safe path.
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
        toast({ tone: 'warning', title: 'Side panel unavailable', message: 'This browser has no side panel API. The popup keeps working as usual.' });
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
          toast({ tone: 'warning', title: 'Could not open the side panel', message: error?.message || '' });
        });
    } catch (error) {
      toast({ tone: 'warning', title: 'Could not open the side panel', message: error?.message || '' });
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
    // The whole box is the token-drawer entry — Rabby's clickable balance card.
    onOpen: () => openDrawer(),
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
    onClick: () => toast({ tone: 'info', title: 'Swap is coming later', message: 'Swap is planned for a future upgrade.' }),
  }));

  const historyTile = track(PanelItem({
    iconName: 'history',
    label: 'History',
    onClick: () => navigate('/history'),
  }));

  const securityTile = track(PanelItem({
    iconName: 'shield',
    label: 'Security',
    onClick: () => openSecurity(),
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

  // ---- Token drawer + strip (Rabby balance-card → token-drawer) -------------
  // The token list lives in the drawer, opened from the balance box ("click anywhere in
  // the box") or from the quiet strip below the action panel. load() keeps a snapshot so
  // the drawer opens instantly and repaints when balances or the registry change.
  let drawer = null;
  let assetsSnapshot = {
    nativeText: '—',
    nativeUsd: null,
    tokens: [],
    stale: false,
    tokenState: null,
  };

  // `tokens` / `tokenState` === undefined mean "keep what the drawer already has". The cached
  // first paint used to pass [] here, which BLANKED every real token in an open drawer until the
  // live reads landed (the "wallet tokens flash while adding a custom token" bug).
  function updateAssets(nativeText, tokens, stale, tokenState) {
    assetsSnapshot = {
      nativeText,
      nativeUsd: currentBalanceUsd,
      tokens: tokens === undefined ? assetsSnapshot.tokens : (tokens || []),
      stale,
      tokenState: tokenState === undefined ? assetsSnapshot.tokenState : tokenState,
    };
    // The balance box summarizes what the drawer holds — real symbols only.
    const realTokens = assetsSnapshot.tokens.filter((t) => !t.hidden);
    balanceHero.update({
      summary: ['THRU', ...realTokens.map((t) => t.symbol)].join(' · '),
    });
    drawer?.update(assetsSnapshot);
  }

  function openDrawer() {
    if (drawer) return;
    drawer = TokenDrawer({
      assets: assetsSnapshot,
      networkLabel: currentNetwork?.label || currentNetwork?.id || 'Betanet',
      onReadMint: (mintAddress) => bridge.send('token.readMint', { mintAddress }),
      onImportToken: (params) => bridge.send('token.import', params),
      // The drawer waits for this BEFORE it shows the list again and raises its own
      // "added" toast, so the user never sees a half-refreshed list.
      onChanged: () => load({ force: true }),
      onClose: () => { drawer = null; },
    });
  }

  // ---- Security sheet --------------------------------------------------------------
  // Three read-only calls; each is allowed to fail on its own so one slow read cannot hide
  // the other two checks (a failed read becomes an 'unknown' row, never a fake pass).
  let security = null;

  async function loadSecuritySnapshot() {
    const [prefs, autoLock, keyrings] = await Promise.allSettled([
      bridge.send('settings.get'),
      bridge.send('system.getAutoLock'),
      bridge.send('keyring.list'),
    ]);
    return {
      prefs: prefs.status === 'fulfilled' ? prefs.value : null,
      autoLockMinutes: autoLock.status === 'fulfilled' ? Number(autoLock.value) : null,
      keyrings: keyrings.status === 'fulfilled' ? keyrings.value : null,
      networkLabel: currentNetwork?.label || currentNetwork?.id || 'Betanet',
      isTestNetwork: (currentNetwork?.id || 'betanet') !== 'mainnet',
    };
  }

  function openSecurity() {
    if (security) return;
    security = SecuritySheet({
      load: loadSecuritySnapshot,
      onNavigate: (route) => navigate(route),
      onClose: () => { security = null; },
    });
  }

  // ---- Pending Transactions ------------------------------------------------
  let pendingPollTimer = null;

  function stopPendingPoll() {
    if (pendingPollTimer) {
      clearInterval(pendingPollTimer);
      pendingPollTimer = null;
    }
  }

  function startPendingPoll() {
    if (pendingPollTimer) return;
    pendingPollTimer = setInterval(async () => {
      try {
        const res = await bridge.send('tx.reconcilePending');
        if (res?.settled > 0) {
          const next = await bridge.send('tx.getPending').catch(() => []);
          renderPending(next);
        }
      } catch {
        // ignore
      }
    }, 2_000); // ~6s blocks: one check every 2s settles within a beat of the block landing
  }

  function renderPending(list) {
    const active = (list || []).filter((r) => r.status === 'submitted');
    const count = active.length;
    if (count > 0) {
      pendingBadge.textContent = `${count} pending`;
      pendingBadge.classList.remove('hidden');
      historyTile.setBadge(count);
      startPendingPoll();
    } else {
      pendingBadge.classList.add('hidden');
      historyTile.setBadge(null);
      stopPendingPoll();
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

    // Cached balance first paint; retain it (visibly labelled by the warning) if the live
    // call fails. A stale batch placeholder with fetchedAt:0 is never a cache snapshot.
    let nativeText = '—';
    let hasCachedBalance = false;
    try {
      const cached = await bridge.send('tx.getCachedBalances', { addresses: [account.address] });
      const entry = cached?.[account.address];
      if (entry) {
        const raw = BigInt(entry.balance);
        const formatted = `${formatThru(raw)} THRU`;
        nativeText = formatted;
        hasCachedBalance = true;
        currentBalanceUsd = formatUsdFromThru(raw);
        balanceHero.update({
          usd: currentBalanceUsd,
          native: formatted,
        });
        updateAssets(formatted, undefined, entry.stale, undefined);
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

    // A forced refresh uses tx.getBalances, which may return a stale placeholder on an
    // offline node. Only a successful live read may replace the hero as a new balance.
    if (infoResult.status === 'fulfilled' && infoResult.value && !infoResult.value.stale
      && infoResult.value.balance != null) {
      const info = infoResult.value;
      const raw = BigInt(info.balance);
      nativeText = `${formatThru(raw)} THRU`;
      currentBalanceUsd = formatUsdFromThru(raw);
      balanceHero.update({
        usd: currentBalanceUsd,
        native: nativeText,
      });

      if (info.exists === false) {
        bridge.send('tx.autoCreateAccount').catch(() => {});
      }
    } else {
      // Do not leave the neutral "$0.00" default looking like a verified zero when no
      // account read or cache has ever succeeded on this page.
      if (!hasCachedBalance) {
        balanceHero.update({ usd: '—', native: 'Balance unavailable' });
        currentBalanceUsd = '—';
      }
    }

    const tokens = tokensResult.status === 'fulfilled' ? tokensResult.value : [];
    const tokenState = tokenBalancesResult.status === 'fulfilled'
      ? new Map((tokenBalancesResult.value?.balances || []).map((b) => [b.mintAddress, b]))
      : null;
    updateAssets(nativeText, tokens,
      infoResult.status === 'rejected' || infoResult.value?.stale === true, tokenState);

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
  ]);

  load();

  d.add(
    bridge.onEvent('balanceChanged', (map) => {
      const entry = map?.[account?.address];
      if (!entry) return;
      if (entry.stale && !entry.fetchedAt) {
        // The batched reader reports a legacy "0" placeholder when there was no cache;
        // it is UNKNOWN, not a zero the dashboard may display as a new balance.
        balanceHero.update({ usd: '—', native: 'Balance unavailable' });
        currentBalanceUsd = '—';
        updateAssets('Balance unavailable', assetsSnapshot.tokens, true, assetsSnapshot.tokenState);
        return;
      }
      const raw = BigInt(entry.balance || '0');
      const formatted = `${formatThru(raw)} THRU`;
      currentBalanceUsd = formatUsdFromThru(raw);
      balanceHero.update({
        usd: currentBalanceUsd,
        native: formatted,
      });
      updateAssets(formatted, assetsSnapshot.tokens, entry.stale, assetsSnapshot.tokenState);
    }),
    bridge.onEvent('accountsChanged', () => load()),
    bridge.onEvent('pendingTxChanged', ({ pending } = {}) => renderPending(pending)),
    bridge.onEvent('networkChanged', () => load({ force: true })),
  );

  return {
    el,
    destroy() {
      stopPendingPoll();
      drawer?.destroy();
      drawer = null;
      security?.destroy();
      security = null;
      for (const c of owned) c.destroy?.();
      owned.length = 0;
      banner.destroy();
      d.dispose();
    },
  };
}
