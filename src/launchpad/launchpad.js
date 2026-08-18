import * as bridge from '../ui/bridge.js';
import { formatThru, truncateAddress } from '../shared/format.js';
import { explorerAddressUrl, explorerTxUrl } from '../lib/networks.js';
import { icons, byteMarkHtml } from '../popup/icons.js';
import { showToast } from '../popup/toast.js';
import { openAccountSwitcher } from '../ui/components/account-switcher.js';
import { openNetworkSwitcher } from '../ui/components/network-switcher.js';

const FAUCET_MAX_PER_CLAIM = 10_000n;

let activeAccount = null;
let activeNetwork = { explorerUrl: 'https://scan.thru.org' };
let currentTab = 'create';
let previewSeed = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
let isDeploying = false;
let swapMode = 'buy'; // 'buy' | 'sell'

// Route map for hash routing
const ROUTE_MAP = {
  '': 'create',
  '#': 'create',
  '#/': 'create',
  '#/launchpad': 'create',
  '#/create': 'create',
  '#/my-tokens': 'my-tokens',
  '#/tokens': 'my-tokens',
  '#/dex': 'dex',
  '#/swap': 'dex',
  '#/predictions': 'predictions',
};

const TAB_TO_HASH = {
  'create': '#/launchpad',
  'my-tokens': '#/my-tokens',
  'dex': '#/dex',
  'predictions': '#/predictions',
};

// Inject inline icons
function injectIcons() {
  for (const el of document.querySelectorAll('[data-icon]')) {
    const render = icons[el.dataset.icon];
    if (render) el.insertAdjacentHTML('afterbegin', render());
  }
}

/**
 * Apply data-driven widths to fill bars.
 *
 * These used to be `style="width: 74%"` attributes in the markup, which the extension
 * CSP refuses ("Applying inline style violates the following Content Security Policy
 * directive") because style-src has no 'unsafe-inline'. CSSOM assignment is NOT covered
 * by that directive, so setting .style.width here is both allowed and the right place —
 * these values will come from chain data rather than markup anyway.
 */
function applyFillBars(root = document) {
  for (const el of root.querySelectorAll('[data-fill]')) {
    const pct = Number(el.dataset.fill);
    if (Number.isFinite(pct)) {
      el.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    }
  }
}

async function init() {
  injectIcons();
  applyFillBars();

  try {
    const state = await bridge.bootstrap();
    if (state.network) {
      activeNetwork = state.network;
    }
    if (state.unlocked && state.account) {
      activeAccount = state.account;
      updateAccountHeader();
      await refreshBalance();
    } else {
      document.getElementById('lp-account-name').textContent = 'Wallet locked';
      document.getElementById('lp-account-address').textContent = 'Please unlock extension';
    }
    if (state.networkHealth) {
      updateNetworkStatus(state.networkHealth);
    } else {
      updateNetworkStatus();
    }
  } catch (err) {
    console.warn('Bootstrap failed:', err);
    document.getElementById('lp-account-name').textContent = 'No active wallet';
    document.getElementById('lp-account-address').textContent = 'Please unlock extension';
    updateNetworkStatus();
  }

  setupEventListeners();
  updateLivePreview();
  await loadDeployedTokens();

  // Initialize route from current window hash
  handleHashChange();
  window.addEventListener('hashchange', handleHashChange);

  // Periodic network health check
  setInterval(updateNetworkStatus, 15000);
}

function handleHashChange() {
  const hash = window.location.hash || '';
  const targetTab = ROUTE_MAP[hash] || 'create';
  switchTab(targetTab, false);
}

function updateAccountHeader() {
  if (!activeAccount) return;
  document.getElementById('lp-account-name').textContent = activeAccount.label || 'Account 1';
  document.getElementById('lp-account-address').textContent = truncateAddress(activeAccount.address);
  document.getElementById('lp-account-mark').innerHTML = byteMarkHtml(activeAccount.address, activeAccount.ref, { small: true });
  document.getElementById('preview-creator').textContent = truncateAddress(activeAccount.address);
}

async function refreshBalance() {
  if (!activeAccount) return;
  const balanceEl = document.getElementById('lp-balance-display');
  const swapBalanceEl = document.getElementById('swap-user-balance');
  try {
    const info = await bridge.send('tx.getAccountInfo', { address: activeAccount.address });
    if (info.exists) {
      const formatted = formatThru(BigInt(info.balance));
      balanceEl.textContent = formatted;
      if (swapBalanceEl) swapBalanceEl.textContent = formatted;
    } else {
      balanceEl.textContent = '0';
      if (swapBalanceEl) swapBalanceEl.textContent = '0';
    }
  } catch {
    balanceEl.textContent = '0';
  }
}

async function updateNetworkStatus(preloadedHealth = null) {
  const dot = document.getElementById('lp-network-dot');
  const text = document.getElementById('lp-network-text');
  if (!dot) return;
  const health = preloadedHealth || (await bridge.send('tx.checkHealth'));
  dot.classList.remove('healthy', 'slow', 'offline');
  dot.classList.add(health.status);
  text.textContent = health.latencyMs != null ? `${activeNetwork.id || 'alphanet'} · ${health.latencyMs}ms` : `${activeNetwork.id || 'alphanet'} · offline`;
}

function switchTab(tabId, updateHash = true) {
  currentTab = tabId;
  document.querySelectorAll('.nav-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.tab === tabId);
  });
  document.querySelectorAll('.tab-pane').forEach((pane) => {
    pane.classList.toggle('active', pane.id === `tab-${tabId}`);
  });
  if (updateHash && TAB_TO_HASH[tabId]) {
    window.location.hash = TAB_TO_HASH[tabId];
  }
  if (tabId === 'my-tokens') {
    loadDeployedTokens();
  }
  // Panes become visible only now, and a pane that was hidden at init may hold
  // fill bars that were never sized.
  const pane = document.getElementById(`tab-${tabId}`);
  if (pane) applyFillBars(pane);
}

function updateLivePreview() {
  const tickerInput = document.getElementById('token-ticker')?.value.trim() || '';
  const nameInput = document.getElementById('token-name')?.value.trim() || '';
  const decimalsInput = document.getElementById('token-decimals')?.value || '6';
  const supplyInput = document.getElementById('token-supply')?.value || '1000000000';
  const imageInput = document.getElementById('token-image')?.value.trim() || '';
  const descInput = document.getElementById('token-desc')?.value.trim() || '';

  const ticker = tickerInput ? `$${tickerInput.toUpperCase()}` : '$TICKER';
  const name = nameInput || 'Token Name';
  const supply = supplyInput ? Number(supplyInput).toLocaleString() : '1,000,000,000';

  const pTicker = document.getElementById('preview-ticker');
  const pName = document.getElementById('preview-name');
  const pDecimals = document.getElementById('preview-decimals');
  const pSupply = document.getElementById('preview-supply');
  const pDesc = document.getElementById('preview-desc');

  if (pTicker) pTicker.textContent = ticker;
  if (pName) pName.textContent = name;
  if (pDecimals) pDecimals.textContent = decimalsInput;
  if (pSupply) pSupply.textContent = supply;
  if (pDesc) pDesc.textContent = descInput || 'Enter token details on the left to see live preview…';

  // Logo Preview
  const logoFallback = document.getElementById('preview-logo-fallback');
  const logoImg = document.getElementById('preview-logo-img');
  if (logoImg && logoFallback) {
    if (imageInput && (imageInput.startsWith('http://') || imageInput.startsWith('https://') || imageInput.startsWith('data:'))) {
      logoImg.src = imageInput;
      logoImg.classList.remove('hidden');
      logoFallback.classList.add('hidden');
      logoImg.onerror = () => {
        logoImg.classList.add('hidden');
        logoFallback.classList.remove('hidden');
      };
    } else {
      logoImg.classList.add('hidden');
      logoFallback.classList.remove('hidden');
      logoFallback.innerHTML = tickerInput ? tickerInput.slice(0, 2).toUpperCase() : icons.coins(24);
    }
  }
}

async function loadDeployedTokens() {
  let tokens = [];
  try {
    tokens = await bridge.send('token.list');
  } catch (err) {
    console.warn('Could not load deployed tokens:', err);
  }
  const countBadge = document.getElementById('my-tokens-count');
  if (countBadge) countBadge.textContent = tokens.length;

  const container = document.getElementById('deployed-tokens-container');
  if (!container) return;

  if (tokens.length === 0) {
    container.innerHTML = `
      <div class="empty-state empty-state-full">
        <span class="empty-icon">${icons.coins(36)}</span>
        <h3>No Tokens Deployed Yet</h3>
        <p>Use the Token Launchpad to create and deploy your first native token on ThruVM.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  for (const token of tokens) {
    const card = document.createElement('div');
    card.className = 'token-item-card';

    const formattedDate = new Date(token.createdAt).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    card.innerHTML = `
      <div class="token-item-top">
        <div class="token-item-id">
          <div class="token-avatar">${token.ticker.slice(0, 3)}</div>
          <div class="token-name-group">
            <span class="token-symbol">$${token.ticker}</span>
            <span class="token-fullname">${token.name}</span>
          </div>
        </div>
        <span class="tag-accent">${token.decimals} Decimals</span>
      </div>
      <div class="token-mint-box">
        <span>Mint: ${truncateAddress(token.mintAddress)}</span>
        <button class="btn-chip" data-action="copy-mint" data-mint="${token.mintAddress}" title="Copy full mint address">Copy</button>
      </div>
      <div class="token-meta-row">
        <span>Initial Supply:</span>
        <strong>${token.initialSupply ? Number(token.initialSupply).toLocaleString() : '0'}</strong>
      </div>
      <div class="token-meta-row">
        <span>Deployed:</span>
        <span>${formattedDate}</span>
      </div>
      <div class="success-actions mt-1">
        <a class="btn secondary sm" href="${explorerAddressUrl(activeNetwork, token.mintAddress)}" target="_blank" rel="noopener">Explorer</a>
        ${token.signature ? `<a class="btn text sm" href="${explorerTxUrl(activeNetwork, token.signature)}" target="_blank" rel="noopener">View Tx</a>` : ''}
      </div>
    `;
    container.appendChild(card);
  }
}

function setDeployStep(stepNumber, message) {
  const msgEl = document.getElementById('progress-message');
  if (msgEl && message) msgEl.textContent = message;

  for (let i = 1; i <= 4; i++) {
    const stepEl = document.getElementById(`step-${i}`);
    if (!stepEl) continue;
    if (i < stepNumber) {
      stepEl.className = 'step-item done';
    } else if (i === stepNumber) {
      stepEl.className = 'step-item active';
    } else {
      stepEl.className = 'step-item';
    }
  }
}

function updateSwapEstimate() {
  const payInput = document.getElementById('swap-pay-amount');
  const receiveInput = document.getElementById('swap-receive-amount');
  if (!payInput || !receiveInput) return;
  const payVal = parseFloat(payInput.value) || 0;
  // Bonding curve estimate: 1 THRU = ~23.529 tokens
  const tokenRate = 23.5294;
  if (swapMode === 'buy') {
    receiveInput.value = (payVal * tokenRate).toFixed(2);
  } else {
    receiveInput.value = (payVal / tokenRate).toFixed(4);
  }
}

function setupEventListeners() {
  // Navigation Tabs with Routing
  document.querySelectorAll('.nav-tab').forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Action links / buttons
  document.addEventListener('click', async (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;

    if (action === 'go-tab-create') {
      switchTab('create');
    } else if (action === 'switch-account') {
      openAccountSwitcher({
        onAccountSwitched: async (newAccount) => {
          activeAccount = newAccount;
          updateAccountHeader();
          await refreshBalance();
        },
      });
    } else if (action === 'switch-network') {
      openNetworkSwitcher({
        onNetworkSwitched: async (newConfig) => {
          activeNetwork = newConfig;
          updateNetworkStatus();
          await refreshBalance();
        },
      });
    } else if (action === 'quick-faucet') {
      if (!activeAccount) {
        showToast('Please unlock wallet first.', 'error');
        return;
      }
      target.disabled = true;
      target.textContent = 'Claiming…';
      try {
        await bridge.send('tx.claimFaucet', { amountUnits: FAUCET_MAX_PER_CLAIM.toString() });
        showToast(`Claimed ${formatThru(FAUCET_MAX_PER_CLAIM)} THRU from faucet!`, 'success');
        await refreshBalance();
      } catch (err) {
        showToast(`Faucet error: ${err.message}`, 'error');
      } finally {
        target.disabled = false;
        target.textContent = 'Claim Faucet';
      }
    } else if (action === 'copy-mint') {
      const mint = target.dataset.mint;
      if (mint) {
        await navigator.clipboard.writeText(mint);
        showToast('Mint address copied', 'info');
      }
    } else if (action === 'bet-market') {
      const outcome = target.dataset.outcome;
      showToast(`Simulated prediction order placed for ${outcome.toUpperCase()}`, 'success');
    }
  });

  // Live Input Listeners for Token Deployer
  ['token-ticker', 'token-name', 'token-decimals', 'token-supply', 'token-image', 'token-desc'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', updateLivePreview);
    }
  });

  // Copy success mint button
  const copyMintBtn = document.getElementById('copy-mint-btn');
  if (copyMintBtn) {
    copyMintBtn.addEventListener('click', async () => {
      const mint = document.getElementById('success-mint-address').textContent;
      if (mint) {
        await navigator.clipboard.writeText(mint);
        showToast('Mint address copied to clipboard', 'info');
      }
    });
  }

  // Launch another token
  const deployAnotherBtn = document.getElementById('deploy-another-btn');
  if (deployAnotherBtn) {
    deployAnotherBtn.addEventListener('click', () => {
      document.getElementById('deploy-success-card').classList.add('hidden');
      document.getElementById('token-deploy-form').reset();
      previewSeed = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      updateLivePreview();
    });
  }

  // Swap Mode Toggle (Buy vs Sell)
  const modeBuyBtn = document.getElementById('mode-buy');
  const modeSellBtn = document.getElementById('mode-sell');
  if (modeBuyBtn && modeSellBtn) {
    modeBuyBtn.addEventListener('click', () => {
      swapMode = 'buy';
      modeBuyBtn.classList.add('active');
      modeSellBtn.classList.remove('active');
      document.querySelector('.swap-currency-badge').textContent = 'THRU';
      document.getElementById('swap-receive-symbol').textContent = 'TOKENS';
      updateSwapEstimate();
    });
    modeSellBtn.addEventListener('click', () => {
      swapMode = 'sell';
      modeSellBtn.classList.add('active');
      modeBuyBtn.classList.remove('active');
      document.querySelector('.swap-currency-badge').textContent = 'TOKENS';
      document.getElementById('swap-receive-symbol').textContent = 'THRU';
      updateSwapEstimate();
    });
  }

  // Swap Input Listeners & Quick Amount Chips
  const payInput = document.getElementById('swap-pay-amount');
  if (payInput) {
    payInput.addEventListener('input', updateSwapEstimate);
  }

  document.querySelectorAll('.quick-amounts .btn-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const amt = chip.dataset.amount;
      if (payInput) {
        if (amt === 'max') {
          const userBal = document.getElementById('swap-user-balance')?.textContent || '10';
          payInput.value = userBal;
        } else {
          payInput.value = amt;
        }
        updateSwapEstimate();
      }
    });
  });

  // Execute Swap Button
  const dexTradeBtn = document.getElementById('dex-trade-btn');
  if (dexTradeBtn) {
    dexTradeBtn.addEventListener('click', async () => {
      if (!activeAccount) {
        showToast('Please unlock wallet first.', 'error');
        return;
      }
      const payVal = document.getElementById('swap-pay-amount')?.value;
      dexTradeBtn.disabled = true;
      dexTradeBtn.textContent = 'Executing on-chain…';
      setTimeout(async () => {
        dexTradeBtn.disabled = false;
        dexTradeBtn.innerHTML = `${icons.swap(16)} Execute Swap On-Chain`;
        showToast(`Swap simulated: Traded ${payVal} ${swapMode === 'buy' ? 'THRU' : 'TOKENS'} on ThruVM AMM!`, 'success');
        await refreshBalance();
      }, 1000);
    });
  }

  // Deploy Form Submission
  const form = document.getElementById('token-deploy-form');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (isDeploying) return;

      if (!activeAccount) {
        showToast('Wallet is locked or not detected. Please unlock your extension.', 'error');
        return;
      }

      const ticker = document.getElementById('token-ticker').value.trim();
      const name = document.getElementById('token-name').value.trim();
      const decimals = parseInt(document.getElementById('token-decimals').value, 10);
      const initialSupply = document.getElementById('token-supply').value;
      const imageUrl = document.getElementById('token-image').value.trim();
      const description = document.getElementById('token-desc').value.trim();

      if (!ticker || !name) {
        showToast('Please provide both Token Symbol and Token Name.', 'error');
        return;
      }

      isDeploying = true;
      const progressOverlay = document.getElementById('deploy-progress');
      progressOverlay.classList.remove('hidden');
      document.getElementById('deploy-success-card').classList.add('hidden');

      try {
        setDeployStep(1, 'Deploying native token mint on ThruVM…');

        const deployed = await bridge.send('token.deploy', {
          ticker,
          name,
          decimals,
          initialSupply,
          imageUrl,
          description,
          mintSeed: previewSeed,
        });

        setDeployStep(4, 'Token mint created!');
        progressOverlay.classList.add('hidden');
        showToast(`Token $${deployed.ticker || ticker} deployed successfully!`, 'success');

        // Show success box
        const successCard = document.getElementById('deploy-success-card');
        document.getElementById('success-mint-address').textContent = deployed.mintAddress;
        document.getElementById('success-explorer-link').href = explorerAddressUrl(activeNetwork, deployed.mintAddress);
        successCard.classList.remove('hidden');

        await refreshBalance();
        await loadDeployedTokens();
      } catch (err) {
        progressOverlay.classList.add('hidden');
        showToast(`Deployment failed: ${err.message}`, 'error');
      } finally {
        isDeploying = false;
      }
    });
  }
}

init();
