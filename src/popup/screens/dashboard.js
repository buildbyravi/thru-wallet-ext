// Dashboard screen module — primary hub of the Thru Wallet.
//
// Shows active account pill, balance hero, quick actions (Send/Receive/Faucet/History),
// Launchpad entry, token assets list, and network status.
// Subscribes reactively to store changes and event bus.

import * as bridge from '../../ui/bridge.js';
import { walletStore } from '../../ui/store.js';
import { events, Events } from '../../ui/events.js';
import { router } from '../../ui/router.js';
import { icons, byteMarkHtml } from '../icons.js';
import { showToast } from '../toast.js';
import { formatThru, truncateAddress } from '../../shared/format.js';
import { openAccountSwitcher } from '../../ui/components/account-switcher.js';
import { renderTokenRow } from '../../ui/components/token-row.js';
import { FLAGS } from '../../shared/flags.js';

/** @type {Array<function>} */
let _unsubs = [];

/**
 * Mount the dashboard screen.
 * @param {HTMLElement} container
 */
export async function mount(container) {
  const state = walletStore.getState();
  let account = state.activeAccount;

  if (!account) {
    try {
      account = await bridge.send('account.getActive');
      if (account) {
        walletStore.setState({ activeAccount: account, isUnlocked: true });
      }
    } catch {}
  }

  const address = account?.address || '—';
  const label = account?.label || 'Account 1';
  const balanceStr = state.balance || '0';
  const rawUnits = state.balanceRaw || '0';

  container.innerHTML = `
    <div class="dash-topbar">
      <div class="dash-account-group">
        <button type="button" class="account-pill" id="dash-account-pill" title="Switch account">
          <span id="dash-account-mark">${byteMarkHtml(address, account?.ref)}</span>
          <div class="account-pill-meta">
            <span class="account-pill-name" id="dash-account-name">${label}</span>
            <span class="account-pill-address mono" id="dash-account-address">${truncateAddress(address)}</span>
          </div>
          <span class="account-pill-chevron">${icons.chevronDown(12)}</span>
        </button>
        <button type="button" class="icon-btn" id="dash-copy-btn" title="Copy address">
          ${icons.copy(14)}
        </button>
      </div>

      <div class="dash-topbar-actions">
        <button type="button" class="icon-btn" id="dash-settings-btn" title="Settings">
          ${icons.settings(16)}
        </button>
        <button type="button" class="icon-btn danger-hover" id="dash-lock-btn" title="Lock wallet">
          ${icons.lock(15)}
        </button>
      </div>
    </div>

    <div class="balance-hero">
      <span class="eyebrow balance-hero-label">NET BALANCE</span>
      <div class="balance-hero-row">
        <span class="balance-hero-value mono" id="balance-display">${balanceStr}</span>
        <span class="balance-hero-unit">THRU</span>
      </div>
      <p class="hint mono" id="raw-balance-hint">${rawUnits && rawUnits !== '0' ? `${rawUnits} raw units` : ''}</p>
    </div>

    <div class="action-grid">
      <button type="button" class="action-btn" id="dash-send-btn">
        <span class="action-btn-icon">${icons.send(16)}</span>
        <span>Send</span>
      </button>
      <button type="button" class="action-btn" id="dash-receive-btn">
        <span class="action-btn-icon">${icons.receive(16)}</span>
        <span>Receive</span>
      </button>
      <button type="button" class="action-btn" id="dash-faucet-btn">
        <span class="action-btn-icon">${icons.faucet(16)}</span>
        <span>Faucet</span>
      </button>
      <button type="button" class="action-btn" id="dash-history-btn">
        <span class="action-btn-icon">${icons.history(16)}</span>
        <span>History</span>
      </button>
    </div>

    <!-- Launchpad Quick Entry -->
    <div class="launchpad-banner clickable" id="dash-launchpad-btn" title="Open Token Launchpad & DEX">
      <div class="launchpad-banner-left">
        <span class="launchpad-banner-icon">${icons.rocket(18)}</span>
        <div class="launchpad-banner-text">
          <strong>Token Launchpad &amp; DEX</strong>
          <span class="muted">Deploy &amp; trade native tokens on ThruVM</span>
        </div>
      </div>
      <span class="launchpad-banner-arrow">${icons.expand(14)}</span>
    </div>

    <!-- Tokens / Assets List -->
    <div class="dash-assets-section">
      <div class="dash-assets-header">
        <span class="drawer-section-label">Assets</span>
        <button type="button" class="icon-btn-ghost sm" id="dash-refresh-btn" title="Refresh balance">
          ${icons.refresh(14)}
        </button>
      </div>
      <div id="dash-tokens-list" class="dash-tokens-list">
        <!-- Rendered dynamically -->
      </div>
    </div>

    <p class="hint center" id="account-status"></p>
  `;

  // Attach handlers
  const accountPill = container.querySelector('#dash-account-pill');
  const handleOpenAccounts = () => {
    openAccountSwitcher({
      onAccountSwitched: async (newAccount) => {
        walletStore.setState({ activeAccount: newAccount });
        events.emit(Events.ACCOUNT_SWITCHED, newAccount);
        await updateAccountAndBalance(container);
      },
    });
  };
  accountPill?.addEventListener('click', handleOpenAccounts);

  const copyBtn = container.querySelector('#dash-copy-btn');
  const handleCopy = async () => {
    const active = walletStore.getState().activeAccount;
    if (active?.address) {
      await navigator.clipboard.writeText(active.address);
      showToast('Address copied', 'info');
      copyBtn?.classList.add('copied');
      setTimeout(() => copyBtn?.classList.remove('copied'), 1000);
    }
  };
  copyBtn?.addEventListener('click', handleCopy);

  const settingsBtn = container.querySelector('#dash-settings-btn');
  settingsBtn?.addEventListener('click', () => router.navigate('settings'));

  const lockBtn = container.querySelector('#dash-lock-btn');
  const handleLock = async () => {
    await bridge.send('wallet.lock');
    walletStore.setState({ isUnlocked: false, activeAccount: null });
    events.emit(Events.WALLET_LOCKED);
    router.clearHistory();
    router.navigate('unlock');
  };
  lockBtn?.addEventListener('click', handleLock);

  // Action buttons
  container.querySelector('#dash-send-btn')?.addEventListener('click', () => router.navigate('send'));
  container.querySelector('#dash-receive-btn')?.addEventListener('click', () => router.navigate('receive'));
  container.querySelector('#dash-faucet-btn')?.addEventListener('click', () => router.navigate('faucet'));
  container.querySelector('#dash-history-btn')?.addEventListener('click', () => router.navigate('history'));

  // Launchpad banner. Hidden while FLAGS.FEATURE_LAUNCHPAD is off so the core wallet ships
  // without advertising an unfinished trading surface.
  const launchpadBtn = container.querySelector('#dash-launchpad-btn');
  if (launchpadBtn && !FLAGS.FEATURE_LAUNCHPAD) {
    launchpadBtn.classList.add('hidden');
  }
  launchpadBtn?.addEventListener('click', () => {
    const url = chrome.runtime.getURL('launchpad.html');
    chrome.tabs.create({ url });
  });

  // Refresh button
  const refreshBtn = container.querySelector('#dash-refresh-btn');
  const handleRefresh = async () => {
    if (refreshBtn) refreshBtn.classList.add('spinning');
    await updateAccountAndBalance(container);
    if (refreshBtn) setTimeout(() => refreshBtn.classList.remove('spinning'), 500);
  };
  refreshBtn?.addEventListener('click', handleRefresh);

  // Subscribe to store updates
  const unsubBalance = walletStore.select('balance', (newBal) => {
    const balEl = container.querySelector('#balance-display');
    if (balEl) balEl.textContent = newBal;
  });

  const unsubAccount = walletStore.select('activeAccount', (newAcc) => {
    if (!newAcc) return;
    const nameEl = container.querySelector('#dash-account-name');
    const addrEl = container.querySelector('#dash-account-address');
    const markEl = container.querySelector('#dash-account-mark');
    if (nameEl) nameEl.textContent = newAcc.label || 'Account';
    if (addrEl) addrEl.textContent = truncateAddress(newAcc.address);
    if (markEl) markEl.innerHTML = byteMarkHtml(newAcc.address, newAcc.ref);
  });

  // Subscribe to event bus
  const unsubEvtBal = events.on(Events.BALANCE_UPDATED, () => updateAccountAndBalance(container));
  const unsubEvtAcc = events.on(Events.ACCOUNT_SWITCHED, () => updateAccountAndBalance(container));
  const unsubEvtRenamed = events.on(Events.ACCOUNT_RENAMED, () => updateAccountAndBalance(container));

  _unsubs.push(
    () => accountPill?.removeEventListener('click', handleOpenAccounts),
    () => copyBtn?.removeEventListener('click', handleCopy),
    () => lockBtn?.removeEventListener('click', handleLock),
    () => refreshBtn?.removeEventListener('click', handleRefresh),
    unsubBalance,
    unsubAccount,
    unsubEvtBal,
    unsubEvtAcc,
    unsubEvtRenamed,
  );

  // Initial balance and token fetch
  await updateAccountAndBalance(container);
}

async function updateAccountAndBalance(container) {
  const account = walletStore.getState().activeAccount;
  if (!account) return;

  const balanceEl = container.querySelector('#balance-display');
  const rawHintEl = container.querySelector('#raw-balance-hint');
  const tokensListEl = container.querySelector('#dash-tokens-list');
  const statusEl = container.querySelector('#account-status');

  try {
    const info = await bridge.send('tx.getAccountInfo', { address: account.address });
    let nativeBalanceStr = '0';
    if (info.exists) {
      const rawUnits = BigInt(info.balance);
      nativeBalanceStr = formatThru(rawUnits);
      if (balanceEl) balanceEl.textContent = nativeBalanceStr;
      if (rawHintEl) rawHintEl.textContent = `${info.balance} raw units`;
      if (statusEl) statusEl.textContent = '';
      walletStore.setState({ balance: nativeBalanceStr, balanceRaw: info.balance });
    } else {
      if (balanceEl) balanceEl.textContent = '0';
      if (rawHintEl) rawHintEl.textContent = '';
      if (statusEl) statusEl.textContent = '';
      walletStore.setState({ balance: '0', balanceRaw: '0' });
      bridge.send('tx.autoCreateAccount').catch(() => {});
    }

    // Render Native Token + Deployed Tokens
    if (tokensListEl) {
      let deployedTokens = [];
      try {
        deployedTokens = await bridge.send('token.list');
      } catch {}

      let tokensHtml = renderTokenRow({
        symbol: 'THRU',
        name: 'Thru Native Token',
        balanceDisplay: nativeBalanceStr,
        isNative: true,
      });

      for (const t of deployedTokens) {
        tokensHtml += renderTokenRow({
          symbol: t.ticker,
          name: t.name,
          balanceDisplay: t.initialSupply ? Number(t.initialSupply).toLocaleString() : '—',
          mintAddress: t.mintAddress,
          imageUrl: t.imageUrl,
          isNative: false,
        });
      }

      tokensListEl.innerHTML = tokensHtml;
    }
  } catch (err) {
    if (balanceEl) balanceEl.textContent = '0';
    if (statusEl) statusEl.textContent = err.message || '';
  }
}

/**
 * Cleanup dashboard screen.
 */
export function cleanup() {
  for (const unsub of _unsubs) {
    try { unsub(); } catch {}
  }
  _unsubs = [];
}
