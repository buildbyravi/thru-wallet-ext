// Send screen module — multi-step Rabby-class transfer flow with simulation review.
//
// Step 1: Sender, Recipient (with live address check & address book), Token, Amount (with MAX/fraction chips).
// Step 2: Pre-Sign Review & simulation card (risk check, fee estimation, balance change).
// Step 3: Sign & broadcast with status toast and explorer link.
// Pure SVG icons, zero emojis.

import * as bridge from '../../ui/bridge.js';
import { walletStore } from '../../ui/store.js';
import { events, Events } from '../../ui/events.js';
import { router } from '../../ui/router.js';
import { icons, byteMarkHtml } from '../icons.js';
import { showToast } from '../toast.js';
import { formatThru, parseThruAmount, truncateAddress } from '../../shared/format.js';
import { isValidThruAddress } from '../../lib/networks.js';
import { openAccountSwitcher } from '../../ui/components/account-switcher.js';
import { openTokenSelector } from '../../ui/components/token-selector.js';
import { openRecipientSelector, saveRecentRecipient } from '../../ui/components/recipient-selector.js';
import { renderTxReviewCard } from '../../ui/components/tx-review.js';

/** @type {Array<function>} */
let _unsubs = [];
let _selectedToken = {
  symbol: 'THRU',
  name: 'Thru Native Token',
  decimals: 9,
  isNative: true,
  mintAddress: null,
  balanceDisplay: '0',
};
let _cachedSenderBalanceStr = '0';
let _cachedSenderBalanceUnits = 0n;
let _pendingSend = null; // { toAddress, amountUnits, amountDisplay }
let _currentStep = 'form'; // 'form' | 'preview'

/**
 * Mount the send screen.
 * @param {HTMLElement} container
 * @param {Object} [params]
 */
export async function mount(container, params = {}) {
  _currentStep = 'form';
  _pendingSend = null;
  _selectedToken = {
    symbol: 'THRU',
    name: 'Thru Native Token',
    decimals: 9,
    isNative: true,
    mintAddress: null,
    balanceDisplay: '0',
  };

  const account = walletStore.getState().activeAccount;

  container.innerHTML = `
    <div class="subheader">
      <button type="button" class="icon-btn" id="send-back-btn" title="Back">
        ${icons.back(16)}
      </button>
      <h1 id="send-title">Send</h1>
      <span class="subheader-spacer"></span>
    </div>

    <!-- Step 1: Send Form View -->
    <div id="send-form-view">
      <!-- From Account Selector Bar -->
      <div class="send-from-box clickable" id="send-from-card" title="Click to change sender account">
        <span class="send-section-label">FROM SENDER</span>
        <div class="send-from-content">
          <div class="send-from-left">
            <span id="send-from-mark">${byteMarkHtml(account?.address, account?.ref)}</span>
            <div class="send-from-meta">
              <span class="send-from-name" id="send-from-name">${account?.label || 'Account'}</span>
              <span class="send-from-address mono" id="send-from-address">${truncateAddress(account?.address || '')}</span>
            </div>
          </div>
          <div class="send-from-right">
            <span class="send-from-balance mono" id="send-from-balance">— THRU</span>
            <span class="account-pill-chevron">${icons.chevronRight(12)}</span>
          </div>
        </div>
      </div>

      <!-- Token Selector Card -->
      <div class="send-token-card clickable" id="send-token-card" title="Click to select asset">
        <div class="send-token-left">
          <div class="send-token-avatar" id="send-token-avatar">${icons.bolt(16)}</div>
          <div class="send-token-meta">
            <div class="send-token-title-row">
              <span class="send-token-symbol" id="send-token-symbol">THRU</span>
              <span class="tag-native" id="send-token-tag">Native</span>
            </div>
            <span class="send-token-name" id="send-token-name">Thru Native Token</span>
          </div>
        </div>
        <div class="send-token-right">
          <span class="send-token-avail-label">Available</span>
          <span class="send-token-balance mono" id="send-token-balance">—</span>
          <span class="account-pill-chevron">${icons.chevronRight(12)}</span>
        </div>
      </div>

      <!-- Recipient Field -->
      <div class="send-field-group">
        <div class="send-field-header">
          <span class="send-section-label">TO RECIPIENT</span>
          <div class="recipient-quick-actions">
            <button type="button" class="btn-chip" id="send-paste-btn" title="Paste from clipboard">
              ${icons.clipboard(14)} Paste
            </button>
            <button type="button" class="btn-chip" id="send-my-accs-btn" title="Send to your other in-wallet accounts">
              ${icons.user(14)} My Accounts
            </button>
          </div>
        </div>
        <div class="field-with-indicator">
          <input type="text" id="send-to" placeholder="Enter recipient ta… address" autocomplete="off" />
          <span id="send-to-indicator" class="field-indicator hidden"></span>
        </div>
        <div class="recipient-badge-row hidden" id="recipient-badge-row">
          <span class="tag-subtle" id="recipient-type-badge">In-Wallet Account</span>
        </div>
      </div>

      <!-- Amount Field -->
      <div class="send-field-group">
        <div class="send-field-header">
          <span class="send-section-label">AMOUNT</span>
          <span class="send-avail-hint">Available: <strong class="mono" id="send-avail-amount">—</strong></span>
        </div>
        <div class="amount-input-box">
          <input type="text" id="send-amount" placeholder="0.0" autocomplete="off" />
          <span class="amount-unit" id="send-amount-unit">THRU</span>
        </div>
        <div class="fraction-chips-row">
          <button type="button" class="btn-chip pct-chip" data-pct="25">25%</button>
          <button type="button" class="btn-chip pct-chip" data-pct="50">50%</button>
          <button type="button" class="btn-chip pct-chip" data-pct="75">75%</button>
          <button type="button" class="btn-chip pct-chip" data-pct="100">MAX</button>
        </div>
      </div>

      <p class="error hidden" id="send-error"></p>
      <button type="button" class="btn primary w-100 mt-3" id="send-review-btn">Review Transaction</button>
    </div>

    <!-- Step 2: Pre-Sign Review View (Hidden initially) -->
    <div id="send-preview-view" class="hidden">
      <div id="send-tx-review-container"></div>
      <p class="hint center my-2">Transactions on Thru blockchain are final and irreversible.</p>
      <button type="button" class="btn primary w-100" id="send-confirm-btn">Sign &amp; Broadcast</button>
      <button type="button" class="btn text w-100 mt-2" id="send-cancel-btn">Back to Edit</button>
    </div>
  `;

  // Attach event handlers
  const backBtn = container.querySelector('#send-back-btn');
  backBtn?.addEventListener('click', () => {
    if (_currentStep === 'preview') {
      showStep('form', container);
    } else {
      router.navigate('dashboard');
    }
  });

  // Switch sender account
  const fromCard = container.querySelector('#send-from-card');
  fromCard?.addEventListener('click', () => {
    openAccountSwitcher({
      onAccountSwitched: async (newAcc) => {
        walletStore.setState({ activeAccount: newAcc });
        events.emit(Events.ACCOUNT_SWITCHED, newAcc);
        await updateSendFormState(container);
      },
    });
  });

  // Select token
  const tokenCard = container.querySelector('#send-token-card');
  tokenCard?.addEventListener('click', () => {
    openTokenSelector({
      activeAccount: walletStore.getState().activeAccount,
      nativeBalanceStr: _cachedSenderBalanceStr,
      selectedMint: _selectedToken.mintAddress,
      onTokenSelected: (tok) => {
        _selectedToken = tok;
        updateSendFormState(container);
      },
    });
  });

  // Paste recipient
  const pasteBtn = container.querySelector('#send-paste-btn');
  pasteBtn?.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      const sendToInput = container.querySelector('#send-to');
      if (sendToInput && text) {
        sendToInput.value = text.trim();
        checkRecipientAddress(text.trim(), container);
      }
    } catch {
      showToast('Clipboard access denied', 'error');
    }
  });

  // My Accounts picker
  const myAccsBtn = container.querySelector('#send-my-accs-btn');
  myAccsBtn?.addEventListener('click', () => {
    openRecipientSelector({
      currentAccount: walletStore.getState().activeAccount,
      onRecipientSelected: ({ address }) => {
        const sendToInput = container.querySelector('#send-to');
        if (sendToInput) {
          sendToInput.value = address;
          checkRecipientAddress(address, container);
          container.querySelector('#send-amount')?.focus();
        }
      },
    });
  });

  // Recipient input listener
  const sendToInput = container.querySelector('#send-to');
  sendToInput?.addEventListener('input', () => {
    const cleaned = sendToInput.value.replace(/\s/g, '');
    if (cleaned !== sendToInput.value) {
      const cursor = sendToInput.selectionStart - (sendToInput.value.length - cleaned.length);
      sendToInput.value = cleaned;
      sendToInput.setSelectionRange(cursor, cursor);
    }
    checkRecipientAddress(cleaned, container);
  });

  // Fraction chips (25%, 50%, 75%, MAX)
  container.querySelectorAll('.pct-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const pct = Number(chip.dataset.pct);
      const amountInput = container.querySelector('#send-amount');
      if (!amountInput) return;

      if (_selectedToken.isNative) {
        const maxUnits = _cachedSenderBalanceUnits;
        if (maxUnits <= 0n) {
          amountInput.value = '0';
          return;
        }

        if (pct === 100) {
          const gasReserve = 10_000n;
          const sendable = maxUnits > gasReserve ? maxUnits - gasReserve : 0n;
          amountInput.value = formatThru(sendable);
        } else {
          const sendable = (maxUnits * BigInt(pct)) / 100n;
          amountInput.value = formatThru(sendable);
        }
      } else {
        const total = parseFloat(_selectedToken.balanceDisplay.replace(/,/g, '')) || 0;
        const sendable = (total * pct) / 100;
        amountInput.value = sendable > 0 ? (Math.floor(sendable * 10000) / 10000).toString() : '0';
      }
    });
  });

  // Review button
  const reviewBtn = container.querySelector('#send-review-btn');
  reviewBtn?.addEventListener('click', () => {
    const toAddress = container.querySelector('#send-to')?.value.trim();
    const amountRaw = container.querySelector('#send-amount')?.value.trim();
    const errorEl = container.querySelector('#send-error');
    const account = walletStore.getState().activeAccount;

    setError(errorEl, '');

    if (!isValidThruAddress(toAddress)) {
      setError(errorEl, "That doesn't look like a valid Thru address.");
      return;
    }
    if (account && toAddress.toLowerCase() === account.address.toLowerCase()) {
      setError(errorEl, "That's the address you're sending from (self-transfer).");
      return;
    }

    let amountUnits;
    try {
      amountUnits = parseThruAmount(amountRaw);
    } catch (err) {
      setError(errorEl, err.message);
      return;
    }

    if (amountUnits <= 0n) {
      setError(errorEl, 'Please enter an amount greater than zero.');
      return;
    }

    // Save recipient to recent
    saveRecentRecipient(toAddress).catch(() => {});

    const amountDisplay = `${formatThru(amountUnits)} ${_selectedToken.symbol}`;
    _pendingSend = { toAddress, amountUnits: amountUnits.toString(), amountDisplay };

    const network = walletStore.getState().activeNetwork;
    const reviewContainer = container.querySelector('#send-tx-review-container');
    if (reviewContainer) {
      reviewContainer.innerHTML = renderTxReviewCard({
        toAddress,
        amountUnits,
        fromAddress: account?.address || '',
        networkLabel: network.label || 'Thru Alphanet',
        estimatedFee: '~1 raw unit',
      });
    }

    showStep('preview', container);
  });

  // Cancel review / back to edit
  container.querySelector('#send-cancel-btn')?.addEventListener('click', () => {
    showStep('form', container);
  });

  // Confirm and broadcast transaction
  const confirmBtn = container.querySelector('#send-confirm-btn');
  confirmBtn?.addEventListener('click', async () => {
    if (!_pendingSend) return;
    const { toAddress, amountUnits, amountDisplay } = _pendingSend;

    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Signing & Broadcasting…';

    try {
      const result = await bridge.send('tx.send', { toAddress, amountUnits });
      _pendingSend = null;

      if (result && result.signature) {
        showToast(`Sent ${amountDisplay}`, 'success');
      } else {
        showToast('Sent successfully', 'success');
      }

      events.emit(Events.TRANSACTION_CONFIRMED, result);
      events.emit(Events.BALANCE_UPDATED);
      router.navigate('dashboard');
    } catch (err) {
      showToast(`Send failed: ${err.message}`, 'error');
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Sign & Broadcast';
    }
  });

  // Initial form population
  await updateSendFormState(container);
}

function showStep(step, container) {
  _currentStep = step;
  const formView = container.querySelector('#send-form-view');
  const previewView = container.querySelector('#send-preview-view');
  const title = container.querySelector('#send-title');

  if (step === 'preview') {
    formView?.classList.add('hidden');
    previewView?.classList.remove('hidden');
    if (title) title.textContent = 'Review';
  } else {
    formView?.classList.remove('hidden');
    previewView?.classList.add('hidden');
    if (title) title.textContent = 'Send';
  }
}

async function updateSendFormState(container) {
  const account = walletStore.getState().activeAccount;
  if (!account) return;

  const fromMark = container.querySelector('#send-from-mark');
  const fromName = container.querySelector('#send-from-name');
  const fromAddr = container.querySelector('#send-from-address');
  const fromBal = container.querySelector('#send-from-balance');

  if (fromMark) fromMark.innerHTML = byteMarkHtml(account.address, account.ref);
  if (fromName) fromName.textContent = account.label || 'Account';
  if (fromAddr) fromAddr.textContent = truncateAddress(account.address);

  try {
    const info = await bridge.send('tx.getAccountInfo', { address: account.address });
    if (info.exists) {
      _cachedSenderBalanceUnits = BigInt(info.balance);
      _cachedSenderBalanceStr = formatThru(_cachedSenderBalanceUnits);
    } else {
      _cachedSenderBalanceUnits = 0n;
      _cachedSenderBalanceStr = '0';
    }
  } catch {
    _cachedSenderBalanceUnits = 0n;
    _cachedSenderBalanceStr = '0';
  }

  if (fromBal) fromBal.textContent = `${_cachedSenderBalanceStr} THRU`;

  // Update token display
  if (_selectedToken.isNative) {
    _selectedToken.balanceDisplay = _cachedSenderBalanceStr;
  }
  const symEl = container.querySelector('#send-token-symbol');
  const nameEl = container.querySelector('#send-token-name');
  const balEl = container.querySelector('#send-token-balance');
  const tagEl = container.querySelector('#send-token-tag');
  const unitEl = container.querySelector('#send-amount-unit');
  const availEl = container.querySelector('#send-avail-amount');

  if (symEl) symEl.textContent = _selectedToken.symbol;
  if (nameEl) nameEl.textContent = _selectedToken.name;
  if (balEl) balEl.textContent = _selectedToken.balanceDisplay;
  if (tagEl) tagEl.textContent = _selectedToken.isNative ? 'Native' : 'Token';
  if (unitEl) unitEl.textContent = _selectedToken.symbol;
  if (availEl) availEl.textContent = `${_selectedToken.balanceDisplay} ${_selectedToken.symbol}`;
}

async function checkRecipientAddress(inputAddress, container) {
  const indicator = container.querySelector('#send-to-indicator');
  const badgeRow = container.querySelector('#recipient-badge-row');
  const badgeEl = container.querySelector('#recipient-type-badge');
  const cleaned = (inputAddress || '').trim();
  const account = walletStore.getState().activeAccount;

  if (!cleaned) {
    indicator?.classList.add('hidden');
    badgeRow?.classList.add('hidden');
    return;
  }

  const valid = isValidThruAddress(cleaned);
  if (indicator) {
    indicator.classList.remove('hidden', 'valid', 'invalid');
    indicator.classList.add(valid ? 'valid' : 'invalid');
    indicator.innerHTML = valid ? icons.check(12) : icons.x(12);
  }

  if (valid && badgeRow && badgeEl) {
    try {
      const accounts = await bridge.send('account.list');
      const matched = accounts.find((a) => a.address.toLowerCase() === cleaned.toLowerCase());
      if (matched) {
        badgeEl.textContent = `In-Wallet: ${matched.label}`;
        badgeEl.className = 'tag-accent';
        badgeRow.classList.remove('hidden');
        return;
      }
    } catch {}

    if (account && cleaned.toLowerCase() === account.address.toLowerCase()) {
      badgeEl.textContent = 'Warning: Self-Transfer';
      badgeEl.className = 'tag-subtle';
      badgeRow.classList.remove('hidden');
      return;
    }

    badgeEl.textContent = 'External Address';
    badgeEl.className = 'tag-subtle';
    badgeRow.classList.remove('hidden');
  } else {
    badgeRow?.classList.add('hidden');
  }
}

function setError(el, message) {
  if (!el) return;
  if (!message) {
    el.classList.add('hidden');
    el.textContent = '';
  } else {
    el.classList.remove('hidden');
    el.textContent = message;
  }
}

/**
 * Cleanup send screen.
 */
export function cleanup() {
  _pendingSend = null;
  _currentStep = 'form';
  for (const unsub of _unsubs) {
    try { unsub(); } catch {}
  }
  _unsubs = [];
}
