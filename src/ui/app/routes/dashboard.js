// Dashboard: account controls above an inset balance card, equal-sized action tiles,
// and a separate ecosystem row. The balance opens the existing Assets drawer.

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
import { isVerifiedTokenBalance } from '../../../shared/tokens.js';

export function DashboardRoute({ navigate }) {
  const d = disposer();
  const owned = [];
  let account = null;
  let currentNetwork = null;
  let assetContext = 0;
  // No authoritative fiat price source is available.
  let currentBalanceUsd = null;

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
    h('span', { class: 'account-pill-chevron' }, icon('chevronRight', 12)),
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

  // ---- Inset balance card -------------------------------------------------
  const balanceHero = track(BalanceHero({
    onRefresh: () => load({ force: true }),
    // The whole box is the token-drawer entry — Rabby's clickable balance card.
    onOpen: () => openDrawer(),
  }));

  const pendingBadge = h('div', { class: 'dash-pending-badge hidden', text: '1 pending' });

  const dashHeader = h('header', { class: 'dash-header' }, [
    headerTop,
    h('div', { class: 'dash-balance-card' }, [
      h('div', { class: 'dash-balance-art-clip' },
        h('img', { class: 'dash-header-art', src: 'icons/balance-art.svg', alt: '', width: 520, height: 340 })),
      balanceHero.el,
    ]),
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
    // 2026-10-26 owner directive: swap UI removed pending the launchpad backend; tile stays
    // a roadmap affordance matching main 14e16b1 exactly.
    iconName: 'swap',
    label: 'Swap',
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
  // Hidden until applyNetworkCapabilities (called from load() with the live record) proves
  // this network actually declares a faucet — see the mainnet-readiness note there.
  faucetTile.el.style.display = 'none';

  // Owner directive 2026-10-23: the dashboard grid must render EXACTLY like main's
  // 14e16b1 — 2 rows x 3 tiles, Faucet in row 2. The Domain screen stays fully built
  // at /name (route registered in boot.js) but has NO dashboard tile: a 7th tile left a
  // 1-item orphan row above and was judged bad-looking.
  const actionPanel = h('div', { class: 'dashboard-panel-grid' }, [
    sendTile.el,
    receiveTile.el,
    swapTile.el,
    historyTile.el,
    securityTile.el,
    faucetTile.el,
  ]);

  // Owner directive 2026-10-24: a SECOND grid below the main panel for ecosystem
  // entries — tiles identical in size to Send/Receive (same .panel-item class, same
  // 3-column grid). First entry: Domain (/name — ENS-style search/register). More are
  // planned here (liquidity, launchpad, DEX…). The main 6-tile grid above stays
  // byte-identical to main 14e16b1.
  const nameTile = track(PanelItem({
    iconName: 'globe',
    label: 'Domain',
    onClick: () => navigate('/name'),
  }));

  const servicesPanel = h('div', { class: 'dashboard-panel-grid dashboard-services-grid' }, [
    nameTile.el,
  ]);

  function applyNetworkCapabilities(network) {
    const faucetAvailable = Boolean(network?.faucetProgramId && network?.faucetStateAccount);
    // Mainnet-readiness (2026-10-09): a network without a faucet HIDES the tile entirely —
    // no affordance, no "unavailable" explanation needed — and until the network record has
    // loaded the tile stays hidden, so a first paint can never flash a clickable faucet at
    // a faucet-less chain. The disabled state stays as a complement for edge races.
    faucetTile.el.style.display = faucetAvailable ? '' : 'none';
    faucetTile.el.disabled = !faucetAvailable;
    faucetTile.el.title = faucetAvailable ? 'Faucet' : 'Faucet unavailable on this network';
  }

  // ---- Token drawer + strip (Rabby balance-card → token-drawer) -------------
  // The token list lives in the drawer, opened from the balance box ("click anywhere in
  // the box") or from the quiet strip below the action panel. load() keeps a snapshot so
  // the drawer opens instantly and repaints when balances or the registry change.
  let drawer = null;
  // One recent successful mint lookup per network/mint; no prefetch for list rows.
  const detailCache = new Map();
  const detailReads = new Map();

  function readTokenDetails(mintAddress) {
    const key = `${currentNetwork?.id || ''}:${mintAddress}`;
    const hit = detailCache.get(key);
    if (hit && Date.now() - hit.fetchedAt < 60_000) return Promise.resolve(hit.result);
    if (detailReads.has(key)) return detailReads.get(key);
    const pending = bridge.send('token.readMint', { mintAddress }).then((result) => {
      if (result?.exists && detailReads.get(key) === pending) {
        detailCache.delete(key);
        detailCache.set(key, { result, fetchedAt: Date.now() });
        if (detailCache.size > 64) detailCache.delete(detailCache.keys().next().value);
      }
      return result;
    }).finally(() => { if (detailReads.get(key) === pending) detailReads.delete(key); });
    detailReads.set(key, pending);
    return pending;
  }

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
    balanceHero.update({ assets: assetsSnapshot.tokens.filter((token) => !token.hidden) });
    drawer?.update(assetsSnapshot);
  }

  function tokenRows(snapshot) {
    if (!currentNetwork?.id || snapshot?.networkId !== currentNetwork.id || !Array.isArray(snapshot.balances)) {
      return [];
    }
    return snapshot.balances;
  }

  function reconcileTokenBalances(tokens, snapshot) {
    const live = new Map(tokenRows(snapshot).map((row) => [row.mintAddress, row]));
    return new Map(tokens.map(({ mintAddress }) => {
      const row = live.get(mintAddress);
      const previous = assetsSnapshot.tokenState?.get(mintAddress);
      return [mintAddress, isVerifiedTokenBalance(row) ? { ...row, stale: false }
        : isVerifiedTokenBalance(previous) ? { ...previous, stale: true }
          : { error: true }];
    }));
  }

  let registryRevision = 0;
  let registryRead = 0;
  let appliedRegistryRead = 0;
  let tokenBalanceRead = 0;
  let appliedTokenBalanceRead = 0;
  const visibilityChanges = new Map();

  async function readTokenRegistry() {
    const revision = registryRevision;
    const read = ++registryRead;
    const tokens = await bridge.send('token.list');
    return { revision, read, tokens };
  }

  function acceptTokenRegistry(snapshot) {
    // A refresh can receive token.list quickly, then wait on cached or live balances.
    // Preserve only the changed visibility flags; registry metadata and other mints
    // can still hydrate. A newer read supersedes the patch, and older reads cannot repaint.
    if (!Array.isArray(snapshot?.tokens) || snapshot.read < appliedRegistryRead) return undefined;
    appliedRegistryRead = snapshot.read;
    for (const [mint, change] of visibilityChanges) {
      if (change.revision <= snapshot.revision) visibilityChanges.delete(mint);
    }
    return snapshot.tokens.map((token) => {
      const change = visibilityChanges.get(token.mintAddress);
      return change ? { ...token, hidden: change.hidden } : token;
    });
  }

  function openDrawer() {
    if (drawer) return;
    drawer = TokenDrawer({
      assets: assetsSnapshot,
      networkLabel: currentNetwork?.label || currentNetwork?.id || 'Betanet',
      onReadMint: (mintAddress) => bridge.send('token.readMint', { mintAddress }),
      onReadDetails: readTokenDetails,
      onSetVisibility: async (mintAddress, hidden) => {
        const context = assetContext;
        await bridge.send('token.setVisibility', { mintAddress, hidden });
        if (context !== assetContext) return;
        visibilityChanges.set(mintAddress, { revision: ++registryRevision, hidden });
        const { nativeText, stale, tokens } = assetsSnapshot;
        updateAssets(nativeText, tokens.map((token) => token.mintAddress === mintAddress ? { ...token, hidden } : token), stale);
      },
      onImportToken: (params) => bridge.send('token.importVerified', params),
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
      autoLockMinutes: autoLock.status === 'fulfilled' ? autoLock.value : null,
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
    }, 1_000); // blocks land in a few ms (owner 2026-10-26): a 1s poll settles within a beat of the block landing
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
    const context = assetContext;
    banner.clear();
    balanceHero.setSpinning(true);

    try {
      const network = await bridge.send('network.getActive');
      if (context !== assetContext) return;
      currentNetwork = network;
      applyNetworkCapabilities(currentNetwork);
    } catch {
      // safe fallback
    }

    try {
      const active = await bridge.send('account.getActive');
      if (context !== assetContext) return;
      account = active;
      if (account) {
        pillMark.replaceChildren(AccountAvatar({
          address: account.address,
          imported: account.keyring?.type === 'privateKey',
          size: 'sm',
        }));
        pillName.textContent = account.label || 'Account';
        pillAddr.replaceChildren(AddressText({ address: account.address, chars: 6 }));
      }
    } catch (error) {
      if (context !== assetContext) return;
      banner.set(error.message || 'Could not load the active account.');
      balanceHero.setSpinning(false);
      return;
    }

    if (context !== assetContext) return;
    const address = account?.address;
    if (!address) {
      balanceHero.setSpinning(false);
      return;
    }

    // Cached balance first paint; retain it (visibly labelled by the warning) if the live
    // call fails. A stale batch placeholder with fetchedAt:0 is never a cache snapshot.
    let nativeText = '—';
    let hasCachedBalance = false;
    try {
      const cached = await bridge.send('tx.getCachedBalances', { addresses: [address] });
      if (context !== assetContext) return;
      const entry = cached?.[address];
      if (entry?.balance != null && /^[0-9]+$/.test(String(entry.balance))
        && Number.isFinite(entry.fetchedAt) && entry.fetchedAt > 0) {
        const raw = BigInt(entry.balance);
        const formatted = `${formatThru(raw)} THRU`;
        nativeText = formatted;
        hasCachedBalance = true;
        hasKnownBalance = true;
        currentBalanceUsd = null;
        balanceHero.update({
          usd: currentBalanceUsd,
          native: formatted,
        });
        updateAssets(formatted, undefined, entry.stale, undefined);
      }
    } catch {
      // cache miss is not an error
    }

    if (context !== assetContext) return;

    // Auto-discovery (v26, Solana-parity ask 2026-10-26): any incoming token mint observed in
    // cached history is chain-verified and registered serverside, so the asset list below
    // shows it without the user pasting an address. Best-effort and non-blocking: a chain that
    // cannot reach some mints yields skipped-reasons, never a failed dashboard.
    bridge.send('token.discover', { address: address }).catch(() => null);

    // Hard rule 15 (2026-10-26): token list paints from the network-scoped snapshot BEFORE
    // any live read. A slow chain replaces the rows; it never blocks them.
    {
      try {
        const [cachedList, cachedBal] = await Promise.all([
          readTokenRegistry(),
          bridge.send('token.getCachedBalances', { address: address }),
        ]);
        if (context !== assetContext) return;
        const cachedState = new Map(assetsSnapshot.tokenState || []);
        for (const row of tokenRows(cachedBal)) {
          if (isVerifiedTokenBalance(row) && !isVerifiedTokenBalance(cachedState.get(row.mintAddress))) {
            cachedState.set(row.mintAddress, { ...row, stale: true });
          }
        }
        updateAssets(assetsSnapshot.nativeText, acceptTokenRegistry(cachedList),
          assetsSnapshot.stale, cachedState);
      } catch {
        // Cache miss is not an error; live hydration follows.
      }
    }

    if (context !== assetContext) return;
    const balanceRead = ++tokenBalanceRead;
    const [infoResult, tokensResult, pendingResult, tokenBalancesResult] = await Promise.allSettled([
      force
        ? bridge.send('tx.getBalances', { addresses: [address] })
          .then((m) => m?.[address])
        : bridge.send('tx.getAccountInfo', { address: address }),
      readTokenRegistry(),
      bridge.send('tx.getPending'),
      bridge.send('token.getBalances', { address: address }),
    ]);

    if (context !== assetContext) return;
    balanceHero.setSpinning(false);

    // A forced refresh uses tx.getBalances, which may return a stale placeholder on an
    // offline node. Only a successful live read may replace the hero as a new balance.
    if (infoResult.status === 'fulfilled' && infoResult.value && !infoResult.value.stale
      && infoResult.value.balance != null && /^[0-9]+$/.test(String(infoResult.value.balance))) {
      const info = infoResult.value;
      const raw = BigInt(info.balance);
      nativeText = `${formatThru(raw)} THRU`;
      hasKnownBalance = true;
      currentBalanceUsd = null;
      balanceHero.update({
        usd: currentBalanceUsd,
        native: nativeText,
      });

      if (info.exists === false) {
        // Activate THIS account through the v12 owned-address path, not the legacy
        // `tx.autoCreateAccount` (auth: 'signing'). The legacy method demanded the signing
        // password whenever the user opted into per-sign re-auth, so a fire-and-forget call
        // from a background refresh silently failed for exactly those users. registerAccount
        // is the sanctioned unlocked-only exception: it proves the address is owned by this
        // vault, signs with that account's own key, and re-checks the network before signing.
        bridge.send('tx.registerAccount', { address: address }).catch(() => {});
      }
    } else {
      // Do not leave the neutral "$0.00" default looking like a verified zero when no
      // account read or cache has ever succeeded on this page.
      if (!hasCachedBalance) {
        balanceHero.update({ usd: '—', native: 'Balance unavailable' });
        currentBalanceUsd = '—';
      }
    }

    const tokens = acceptTokenRegistry(tokensResult.value) ?? assetsSnapshot.tokens;
    // An older overlapping refresh can contain fewer mints. Do not let it mark
    // the fresh balance of a newly imported mint as cached (or replace its neighbours).
    let tokenState = assetsSnapshot.tokenState;
    if (balanceRead > appliedTokenBalanceRead) {
      appliedTokenBalanceRead = balanceRead;
      tokenState = reconcileTokenBalances(tokens, tokenBalancesResult.value);
    }
    updateAssets(nativeText, tokens,
      infoResult.status === 'rejected' || infoResult.value?.stale === true, tokenState);

    if (pendingResult.status === 'fulfilled') {
      let pendings = pendingResult.value;
      if ((pendings || []).some((r) => r?.status === 'submitted')) {
        await bridge.send('tx.reconcilePending').catch(() => null);
        pendings = await bridge.send('tx.getPending').catch(() => pendings);
      }
      if (context === assetContext) renderPending(pendings);
    }
  }

  const el = h('section', { class: 'screen dash-screen' }, [
    dashHeader,
    banner.el,
    actionPanel,
    servicesPanel,
  ]);

  let hasKnownBalance = false;
  function resetAssetsContext() {
    assetContext += 1;
    visibilityChanges.clear();
    drawer?.destroy();
    account = null;
    hasKnownBalance = false;
    currentBalanceUsd = null;
    balanceHero.update({ usd: null, native: '—' });
    updateAssets('—', [], false, null);
  }
  load();

  d.add(
    bridge.onEvent('balanceChanged', (map) => {
      const entry = map?.[account?.address];
      if (!entry) return;
      if (entry.stale && !entry.fetchedAt) {
        // The batched reader reports a legacy "0" placeholder when there was no cache;
        // it is UNKNOWN, not a zero — and must not clobber a previously verified cached balance.
        if (!hasKnownBalance) {
          balanceHero.update({ usd: '—', native: 'Balance unavailable' });
          currentBalanceUsd = '—';
          updateAssets('Balance unavailable', assetsSnapshot.tokens, true, assetsSnapshot.tokenState);
        }
        return;
      }
      if (!/^[0-9]+$/.test(String(entry.balance ?? ''))) return;
      const raw = BigInt(entry.balance);
      const formatted = `${formatThru(raw)} THRU`;
      hasKnownBalance = true;
      currentBalanceUsd = null;
      balanceHero.update({
        usd: currentBalanceUsd,
        native: formatted,
      });
      updateAssets(formatted, assetsSnapshot.tokens, entry.stale, assetsSnapshot.tokenState);
    }),
    bridge.onEvent('accountsChanged', () => { resetAssetsContext(); load(); }),
    bridge.onEvent('pendingTxChanged', ({ pending } = {}) => renderPending(pending)),
    bridge.onEvent('networkChanged', () => {
      resetAssetsContext();
      detailCache.clear();
      detailReads.clear();
      load({ force: true });
    }),
  );

  return {
    el,
    destroy() {
      assetContext += 1;
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
