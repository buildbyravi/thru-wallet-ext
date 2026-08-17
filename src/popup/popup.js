import * as bridge from '../ui/bridge.js';
import { formatThru, parseThruAmount, truncateAddress } from '../shared/format.js';
import { isValidThruAddress, explorerTxUrl, explorerAddressUrl } from '../lib/networks.js';
import { icons, byteMarkHtml } from './icons.js';
import { showToast } from './toast.js';
import { renderQR } from './qr.js';
import { openAccountSwitcher } from '../ui/components/account-switcher.js';
import { openNetworkSwitcher } from '../ui/components/network-switcher.js';
import { renderTxReviewCard } from '../ui/components/tx-review.js';
import { renderTokenRow } from '../ui/components/token-row.js';
import { openTokenSelector } from '../ui/components/token-selector.js';
import { openRecipientSelector, saveRecentRecipient } from '../ui/components/recipient-selector.js';
import { router } from '../ui/router.js';
import { events, Events } from '../ui/events.js';
import { walletStore } from '../ui/store.js';
import * as settingsScreen from './screens/settings.js';
import * as welcomeScreen from './screens/welcome.js';
import * as receiveScreen from './screens/receive.js';
import * as historyScreen from './screens/history.js';
import * as faucetScreen from './screens/faucet.js';
import * as unlockScreen from './screens/unlock.js';
import * as resetConfirmScreen from './screens/reset-confirm.js';
import * as createPasswordScreen from './screens/create-password.js';
import * as backupScreen from './screens/backup.js';
import * as importScreen from './screens/import.js';
import * as addKeyScreen from './screens/add-key.js';
import * as exportPasswordScreen from './screens/export-password.js';
import * as exportRevealScreen from './screens/export-reveal.js';
import * as renameAccountScreen from './screens/rename-account.js';
import * as accountDetailScreen from './screens/account-detail.js';
import * as dashboardScreen from './screens/dashboard.js';
import * as sendScreen from './screens/send.js';
import { FLAGS, applyQueryOverrides } from '../shared/flags.js';
import { boot as bootNextUi } from '../ui/app/boot.js';



const FAUCET_MAX_PER_CLAIM = 10_000n;

// Static markup opts into an icon with data-icon="name"; resolved once at load.
function injectIcons() {
  for (const el of document.querySelectorAll('[data-icon]')) {
    const render = icons[el.dataset.icon];
    if (render) el.insertAdjacentHTML('afterbegin', render());
  }
}

const screens = [
  'loading',
  'disclaimer',
  'welcome',
  'create-password',
  'backup',
  'import',
  'unlock',
  'reset-confirm',
  'add-key',
  'export-password',
  'export-reveal',
  'dashboard',
  'accounts',
  'rename-account',
  'send',
  'send-preview',
  'receive',
  'faucet',
  'history',
  'settings',
];

// Sensitive inputs cleared on navigation
const SENSITIVE_FIELD_IDS = [
  'create-password',
  'create-password-confirm',
  'import-mnemonic',
  'import-privatekey',
  'import-password',
  'unlock-password',
  'add-key-input',
  'export-password',
];

function clearSensitiveFields() {
  for (const id of SENSITIVE_FIELD_IDS) {
    const el = document.getElementById(id);
    if (el) el.value = '';
  }
}

function show(name) {
  for (const s of screens) {
    const el = document.getElementById(`screen-${s}`);
    if (el) el.classList.toggle('hidden', s !== name);
  }
  walletStore.setState({ currentScreen: name });
}

// Register legacy show() as the router's fallback for non-migrated screens.
// As screens are extracted into modules, they get registered with router.register()
// and stop going through this fallback.
router.setLegacyFallback(show);


function setError(id, message) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!message) {
    el.classList.add('hidden');
    el.textContent = '';
  } else {
    el.classList.remove('hidden');
    el.textContent = message;
  }
}

function refsEqual(a, b) {
  if (!a || !b || a.kind !== b.kind) return false;
  return a.kind === 'hd' ? a.index === b.index : a.keyIndex === b.keyIndex;
}

function renderMnemonicGrid(mnemonic, gridEl) {
  gridEl.innerHTML = '';
  mnemonic.split(' ').forEach((word, i) => {
    const span = document.createElement('span');
    span.innerHTML = `${i + 1}. <b>${word}</b>`;
    gridEl.appendChild(span);
  });
}

// Holds state in memory
let pendingMnemonic = null;
let activeAccount = null;
let activeNetwork = { explorerUrl: 'https://scan.thru.org' };
let importMode = 'mnemonic'; // 'mnemonic' | 'privatekey'
let pendingExportRef = null;
let pendingExportSecret = null;
let pendingSend = null; // { toAddress, amountUnits, amountDisplay }
let pendingRenameAddress = null;
let selectedSendToken = {
  symbol: 'THRU',
  name: 'Thru Native Token',
  decimals: 9,
  isNative: true,
  mintAddress: null,
  balanceDisplay: '0',
};
let cachedSenderBalanceStr = '0';
let cachedSenderBalanceUnits = 0n;

async function updateSendScreenState() {
  if (!activeAccount) return;
  // Update From Sender Box
  const fromMark = document.getElementById('send-from-mark');
  if (fromMark) fromMark.innerHTML = byteMarkHtml(activeAccount.address, activeAccount.ref);
  const fromName = document.getElementById('send-from-name');
  if (fromName) fromName.textContent = activeAccount.label || 'Account';
  const fromAddr = document.getElementById('send-from-address');
  if (fromAddr) fromAddr.textContent = truncateAddress(activeAccount.address);

  // Fetch active account balance
  try {
    const info = await bridge.send('tx.getAccountInfo', { address: activeAccount.address });
    if (info.exists) {
      cachedSenderBalanceUnits = BigInt(info.balance);
      cachedSenderBalanceStr = formatThru(cachedSenderBalanceUnits);
    } else {
      cachedSenderBalanceUnits = 0n;
      cachedSenderBalanceStr = '0';
    }
  } catch {
    cachedSenderBalanceUnits = 0n;
    cachedSenderBalanceStr = '0';
  }
  const fromBal = document.getElementById('send-from-balance');
  if (fromBal) fromBal.textContent = `${cachedSenderBalanceStr} THRU`;

  // Update Token Selector Card
  if (selectedSendToken.isNative) {
    selectedSendToken.balanceDisplay = cachedSenderBalanceStr;
  }
  const symEl = document.getElementById('send-token-symbol');
  if (symEl) symEl.textContent = selectedSendToken.symbol;
  const nameEl = document.getElementById('send-token-name');
  if (nameEl) nameEl.textContent = selectedSendToken.name;
  const balEl = document.getElementById('send-token-balance');
  if (balEl) balEl.textContent = selectedSendToken.balanceDisplay;
  const tagEl = document.getElementById('send-token-tag');
  if (tagEl) tagEl.textContent = selectedSendToken.isNative ? 'Native' : 'Token';
  const avEl = document.getElementById('send-token-avatar');
  if (avEl) {
    avEl.innerHTML = selectedSendToken.isNative ? icons.bolt(16) : `<span class="token-avatar-text">${selectedSendToken.symbol.slice(0, 3).toUpperCase()}</span>`;
  }
  const unitEl = document.getElementById('send-amount-unit');
  if (unitEl) unitEl.textContent = selectedSendToken.symbol;
  const availEl = document.getElementById('send-avail-amount');
  if (availEl) availEl.textContent = `${selectedSendToken.balanceDisplay} ${selectedSendToken.symbol}`;
}

async function checkRecipientAddress(inputAddress) {
  const indicator = document.getElementById('send-to-indicator');
  const badgeRow = document.getElementById('recipient-badge-row');
  const badgeEl = document.getElementById('recipient-type-badge');
  const cleaned = (inputAddress || '').trim();

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
    // Check if in own accounts
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

    // Check if current active address
    if (activeAccount && cleaned.toLowerCase() === activeAccount.address.toLowerCase()) {
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

async function init() {
  // Blanket guard: no form in an extension page may ever perform a native submit, which
  // would navigate the popup document and blank the UI.
  //
  // Six screens previously relied on `onsubmit="return false;"` in markup injected via
  // innerHTML. Inline handlers are blocked by the extension CSP, so those attributes never
  // ran — the forms were unprotected the whole time and only appeared safe because a click
  // handler usually intercepted first. They also emitted the "Applying inline style /
  // inline event handler violates the following Content Security Policy directive" console
  // errors on every mount.
  //
  // Capture phase, so this wins regardless of what a screen does with its own listener.
  document.addEventListener('submit', (event) => {
    event.preventDefault();
  }, true);

  // New-stack opt-in. While FLAGS.NEXT_UI is false this whole branch is skipped and the
  // legacy path below runs byte-for-byte as before, so the migration cannot regress the
  // shipping UI. Force it on for a session with popup.html?next=1
  applyQueryOverrides(window.location.search);
  if (FLAGS.NEXT_UI) {
    const nextRoot = document.getElementById('app');
    const legacyRoot = document.getElementById('legacy-app');

    // Swap which tree is visible. Both must never be shown at once, and the legacy tree
    // must be un-hidden before show() runs on it — otherwise an unmigrated route renders
    // into a hidden container and the user sees a blank panel.
    //
    // Falling back must also HYDRATE the legacy screen, not merely reveal it. show() only
    // toggles .hidden; the data comes from a per-screen loader. Calling show('dashboard')
    // directly is why the pill read "Account —" and the balance read "— THRU": init()
    // returned early into the new stack, so `activeAccount` was never set and
    // refreshActiveAccountAndBalance() never ran.
    const LEGACY_LOADERS = {
      dashboard: () => loadDashboard(),
      accounts: () => renderAccountsList(''),
    };

    const showLegacy = (screenId) => {
      nextRoot?.classList.add('hidden');
      legacyRoot?.classList.remove('hidden');
      const loader = LEGACY_LOADERS[screenId];
      if (loader) {
        // The loader calls show() itself, then populates.
        Promise.resolve(loader()).catch((error) => {
          console.error(`[popup] legacy loader for '${screenId}' failed:`, error);
          show(screenId);
        });
      } else {
        show(screenId);
      }
    };

    const mounted = await bootNextUi({
      root: nextRoot,
      legacyFallback: (path) => {
        const screenId = path.replace(/^\//, '') || 'dashboard';
        showLegacy(screenId);
      },
      // Called when the router lands on a migrated route, so the legacy tree goes away
      // again after a fallback excursion.
      onMigratedRoute: () => {
        legacyRoot?.classList.add('hidden');
        nextRoot?.classList.remove('hidden');
      },
    });

    if (mounted) {
      nextRoot?.classList.remove('hidden');
      legacyRoot?.classList.add('hidden');
      // The legacy tree is hidden rather than removed: unmigrated hashes still fall back
      // to it, and removing it would break that escape hatch mid-migration.
      return;
    }
    // If the mount point is missing, fall through to the legacy UI rather than
    // showing the user nothing.
  }

  const { disclaimerAcknowledged } = await chrome.storage.local.get('disclaimerAcknowledged');
  if (!disclaimerAcknowledged) {
    show('disclaimer');
    return;
  }
  await proceedAfterDisclaimer();
}

/** Normal init flow — called after disclaimer is acknowledged (or was already). */
async function proceedAfterDisclaimer() {
  try {
    const state = await bridge.bootstrap();
    if (state.network) {
      activeNetwork = state.network;
      walletStore.setState({ activeNetwork: state.network });
    }
    if (state.networkHealth) {
      walletStore.setState({ networkHealth: state.networkHealth });
      updateNetworkStatus(state.networkHealth);
    }
    if (state.autoLockMinutes !== undefined) {
      walletStore.setState({
        settings: { ...walletStore.getState().settings, autoLockMinutes: state.autoLockMinutes }
      });
    }
    if (!state.hasVault) {
      router.navigate('welcome');
      return;
    }
    if (state.unlocked && state.account) {
      activeAccount = state.account;
      walletStore.setState({ activeAccount: state.account, isUnlocked: true });
      router.navigate('dashboard');
    } else {
      router.navigate('unlock');
    }
  } catch {
    const has = await bridge.send('wallet.hasVault');
    if (!has) {
      router.navigate('welcome');
    } else {
      router.navigate('unlock');
    }
    updateNetworkStatus();
  }
}

async function loadDashboard() {
  show('dashboard');
  await refreshActiveAccountAndBalance();
}

async function refreshActiveAccountAndBalance() {
  activeAccount = await bridge.send('account.getActive');
  if (!activeAccount) return;
  walletStore.setState({ activeAccount, isUnlocked: true });
  const markEl = document.getElementById('dash-account-mark');
  if (markEl) markEl.innerHTML = byteMarkHtml(activeAccount.address, activeAccount.ref);
  // The name was never populated here, so even after the missing element was added the pill
  // still showed only a truncated address.
  const nameEl = document.getElementById('dash-account-name');
  if (nameEl) nameEl.textContent = activeAccount.label || 'Account';
  const addrEl = document.getElementById('dash-account-address');
  if (addrEl) addrEl.textContent = truncateAddress(activeAccount.address);
  await refreshBalance();
}

async function renderAccountsList(query = '') {
  const accounts = await bridge.send('account.list');
  const activeRef = await bridge.send('account.getActiveRef');
  const hasSeedKeyring = await bridge.send('wallet.hasSeed');
  const container = document.getElementById('accounts-list');
  container.innerHTML = '';

  const q = (query || '').trim().toLowerCase();
  const filtered = q
    ? accounts.filter((acc) => acc.label.toLowerCase().includes(q) || acc.address.toLowerCase().includes(q))
    : accounts;

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = q ? `No accounts matching "${query}"` : 'No accounts found.';
    container.appendChild(empty);
  } else {
    for (const acc of filtered) {
      const row = document.createElement('div');
      row.className = 'row' + (refsEqual(acc.ref, activeRef) ? ' active' : '');

      const switchBtn = document.createElement('button');
      switchBtn.type = 'button';
      switchBtn.className = 'row-content-btn';
      switchBtn.dataset.action = 'switch-account';
      switchBtn.dataset.ref = JSON.stringify(acc.ref);
      switchBtn.innerHTML = `${byteMarkHtml(acc.address, acc.ref)}<span class="row-body"><span class="row-title">${acc.label}</span><span class="row-sub">${truncateAddress(acc.address)}</span></span>`;

      const renameBtn = document.createElement('button');
      renameBtn.type = 'button';
      renameBtn.className = 'row-rename-btn';
      renameBtn.dataset.action = 'go-rename-account';
      renameBtn.dataset.address = acc.address;
      renameBtn.dataset.name = acc.label;
      renameBtn.title = 'Rename account';
      renameBtn.innerHTML = icons.edit(14);

      row.appendChild(switchBtn);
      row.appendChild(renameBtn);
      container.appendChild(row);
    }
  }
  document.getElementById('add-account-btn').classList.toggle('hidden', !hasSeedKeyring);
}

async function refreshBalance() {
  if (!activeAccount) return;
  const balanceEl = document.getElementById('balance-display');
  const statusEl = document.getElementById('account-status');
  const rawHintEl = document.getElementById('raw-balance-hint');
  const tokensListEl = document.getElementById('dash-tokens-list');
  balanceEl.textContent = '…';
  try {
    const info = await bridge.send('tx.getAccountInfo', { address: activeAccount.address });
    let nativeBalanceStr = '0';
      if (info.exists) {
        const rawUnits = BigInt(info.balance);
        nativeBalanceStr = formatThru(rawUnits);
        balanceEl.textContent = nativeBalanceStr;
        rawHintEl.textContent = `${info.balance} raw units`;
        statusEl.textContent = '';
        walletStore.setState({ balance: nativeBalanceStr, balanceRaw: info.balance });
      } else {
        balanceEl.textContent = '0';
        rawHintEl.textContent = '';
        statusEl.textContent = '';
        walletStore.setState({ balance: '0', balanceRaw: '0' });
        bridge.send('tx.autoCreateAccount').catch(() => {});
      }
      events.emit(Events.BALANCE_UPDATED, { balance: nativeBalanceStr });

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
    balanceEl.textContent = '0';
    statusEl.textContent = err.message || '';
  }
}

function historyIconAndClass(entry) {
  if (entry.success === false) return { icon: icons.x(14), cls: 'failed' };
  const kind = entry.kind;
  if (kind === 'sent') return { icon: icons.send(14), cls: 'sent' };
  if (kind === 'received') return { icon: icons.receive(14), cls: 'received' };
  if (kind === 'faucet') return { icon: icons.faucet(14), cls: 'faucet' };
  return { icon: icons.dot(14), cls: 'other' };
}

function historyDescription(entry) {
  const amountUnits = entry.amount ? BigInt(entry.amount) : 0n;
  if (entry.kind === 'sent') return `Sent ${formatThru(amountUnits)} THRU to ${truncateAddress(entry.counterparty)}`;
  if (entry.kind === 'received') return `Received ${formatThru(amountUnits)} THRU from ${truncateAddress(entry.counterparty)}`;
  if (entry.kind === 'faucet') return `Claimed ${formatThru(amountUnits)} THRU from faucet`;
  return `Program call (${truncateAddress(entry.programAddress)})`;
}

async function renderHistory() {
  if (!activeAccount) return;
  const container = document.getElementById('history-list');
  const statusEl = document.getElementById('history-status');
  container.innerHTML = '';
  statusEl.textContent = 'Loading…';
  try {
    const entries = await bridge.send('tx.listHistory', { address: activeAccount.address });
    statusEl.textContent = entries.length ? '' : 'No transactions yet for this account.';
    for (const entry of entries) {
      const { icon, cls } = historyIconAndClass(entry);
      const row = document.createElement('div');
      row.className = 'row';
      const sigDisplay = entry.signature ? truncateAddress(entry.signature) : 'pending';
      const linkHtml = entry.signature
        ? `<a class="history-explorer-link" href="${explorerTxUrl(activeNetwork, entry.signature)}" target="_blank" rel="noopener" title="View on explorer">${icons.external()}</a>`
        : '';
      row.innerHTML = `<span class="row-glyph ${cls}">${icon}</span><span class="row-body"><span class="row-title">${historyDescription(entry)}${entry.success === false ? ' (failed)' : ''}</span><span class="history-sig-row"><button type="button" class="history-sig" data-action="copy-history-sig" data-sig="${entry.signature ?? ''}" title="Copy signature">${sigDisplay}</button>${linkHtml}</span></span>`;
      container.appendChild(row);
    }
  } catch (err) {
    statusEl.textContent = `Couldn't load history: ${err.message}`;
  }
}

function renderExportReveal(secret) {
  const title = document.getElementById('export-reveal-title');
  const warning = document.getElementById('export-reveal-warning');
  const grid = document.getElementById('export-mnemonic-grid');
  const pkDisplay = document.getElementById('export-privatekey-display');
  if (secret.kind === 'hd') {
    title.textContent = 'Recovery phrase';
    warning.textContent = 'This controls every account derived from this seed, not just the one you exported from — anyone with these words can take everything across all of them.';
    grid.classList.remove('hidden');
    pkDisplay.classList.add('hidden');
    renderMnemonicGrid(secret.mnemonic, grid);
    grid.dataset.raw = secret.mnemonic;
  } else {
    title.textContent = 'Private key';
    warning.textContent = 'This controls only this one imported account. Anyone with this key can take everything in it.';
    grid.classList.add('hidden');
    pkDisplay.classList.remove('hidden');
    pkDisplay.textContent = secret.privateKeyHex;
  }
}

function setImportMode(mode) {
  importMode = mode;
  document.getElementById('tab-mnemonic').classList.toggle('active', mode === 'mnemonic');
  document.getElementById('tab-privatekey').classList.toggle('active', mode === 'privatekey');
  document.getElementById('import-mnemonic-fields').classList.toggle('hidden', mode !== 'mnemonic');
  document.getElementById('import-privatekey-fields').classList.toggle('hidden', mode !== 'privatekey');
}

/**
 * Legacy actions whose destination has been rebuilt on the new stack.
 *
 * Without this table the migrated routes are UNREACHABLE. After unlock the new router
 * navigates to /dashboard, which has not migrated yet, so it falls through to the legacy
 * tree — and from there every control is a legacy show() call. The account switcher opened
 * the old drawer, export stayed as unreachable as it always was, and the new screens sat in
 * the bundle with no click path to them.
 *
 * Each entry is deleted when its originating legacy screen is deleted.
 */
const NEXT_UI_REDIRECTS = {
  'go-accounts': '/accounts',
  'go-add-key': '/add-account',
  'go-export-password': '/accounts',
};

async function handleAction(action, target) {
  // Intercept before the legacy switch runs, so a migrated destination wins.
  if (FLAGS.NEXT_UI && Object.prototype.hasOwnProperty.call(NEXT_UI_REDIRECTS, action)) {
    window.location.hash = `#${NEXT_UI_REDIRECTS[action]}`;
    return;
  }

  switch (action) {
    case 'go-welcome':
      clearSensitiveFields();
      setError('create-error', '');
      setError('import-error', '');
      show('welcome');
      break;

    case 'acknowledge-disclaimer':
      await chrome.storage.local.set({ disclaimerAcknowledged: true });
      await proceedAfterDisclaimer();
      break;

    case 'go-create':
      clearSensitiveFields();
      show('create-password');
      break;

    case 'go-import':
      clearSensitiveFields();
      setImportMode('mnemonic');
      show('import');
      break;

    case 'go-import-key':
      clearSensitiveFields();
      setImportMode('privatekey');
      show('import');
      break;

    case 'import-mode-mnemonic':
      setImportMode('mnemonic');
      break;

    case 'import-mode-privatekey':
      setImportMode('privatekey');
      break;

    case 'go-unlock':
      clearSensitiveFields();
      show('unlock');
      break;

    case 'go-reset-confirm':
      show('reset-confirm');
      break;

    case 'open-desktop': {
      const url = chrome.runtime.getURL('desktop.html');
      chrome.tabs.create({ url });
      break;
    }

    case 'go-dashboard':
      clearSensitiveFields();
      pendingExportRef = null;
      pendingExportSecret = null;
      document.getElementById('export-mnemonic-grid').innerHTML = '';
      document.getElementById('export-privatekey-display').textContent = '';
      await loadDashboard();
      break;

    case 'go-accounts': {
      openAccountSwitcher({
        onAccountSwitched: async (newAccount) => {
          activeAccount = newAccount;
          document.getElementById('dash-account-mark').innerHTML = byteMarkHtml(activeAccount.address, activeAccount.ref);
          document.getElementById('dash-account-address').textContent = truncateAddress(activeAccount.address);
          await refreshBalance();
        },
        onAddKeyRequested: () => {
          clearSensitiveFields();
          setError('add-key-error', '');
          show('add-key');
        },
      });
      break;
    }

    case 'open-network-switcher': {
      openNetworkSwitcher({
        onNetworkSwitched: async (newConfig) => {
          activeNetwork = newConfig;
          updateNetworkStatus();
          await refreshBalance();
        },
      });
      break;
    }

    case 'go-rename-account': {
      pendingRenameAddress = target.dataset.address;
      const currentName = target.dataset.name || '';
      document.getElementById('rename-address-display').textContent = pendingRenameAddress;
      const renameInput = document.getElementById('rename-input');
      renameInput.value = currentName;
      show('rename-account');
      setTimeout(() => {
        renameInput.focus();
        renameInput.select();
      }, 50);
      break;
    }

    case 'submit-rename': {
      if (!pendingRenameAddress) break;
      const newName = document.getElementById('rename-input').value.trim();
      await bridge.send('account.setLabel', { address: pendingRenameAddress, label: newName });
      showToast('Account renamed', 'success');
      pendingRenameAddress = null;
      await refreshActiveAccountAndBalance();
      const currentSearch = document.getElementById('accounts-search')?.value || '';
      await renderAccountsList(currentSearch);
      show('accounts');
      break;
    }

    case 'go-send':
      setError('send-error', '');
      pendingSend = null;
      selectedSendToken = {
        symbol: 'THRU',
        name: 'Thru Native Token',
        decimals: 9,
        isNative: true,
        mintAddress: null,
        balanceDisplay: '0',
      };
      await updateSendScreenState();
      checkRecipientAddress(document.getElementById('send-to')?.value);
      show('send');
      break;

    case 'switch-send-account':
      openAccountSwitcher({
        onAccountSwitched: async (newAccount) => {
          activeAccount = newAccount;
          await updateSendScreenState();
          checkRecipientAddress(document.getElementById('send-to')?.value);
        },
      });
      break;

    case 'open-token-selector':
      openTokenSelector({
        activeAccount,
        nativeBalanceStr: cachedSenderBalanceStr,
        selectedMint: selectedSendToken.mintAddress,
        onTokenSelected: (token) => {
          selectedSendToken = token;
          updateSendScreenState();
        },
      });
      break;

    case 'paste-recipient': {
      try {
        const text = await navigator.clipboard.readText();
        const sendToEl = document.getElementById('send-to');
        if (sendToEl && text) {
          sendToEl.value = text.trim();
          checkRecipientAddress(text.trim());
        }
      } catch {
        showToast('Clipboard access denied', 'error');
      }
      break;
    }

    case 'open-my-accounts-recipient':
      openRecipientSelector({
        currentAccount: activeAccount,
        onRecipientSelected: ({ address }) => {
          const sendToEl = document.getElementById('send-to');
          if (sendToEl) {
            sendToEl.value = address;
            checkRecipientAddress(address);
            document.getElementById('send-amount')?.focus();
          }
        },
      });
      break;

    case 'set-amount-pct': {
      const pct = Number(target.dataset.pct);
      const amountInput = document.getElementById('send-amount');
      if (!amountInput) break;

      if (selectedSendToken.isNative) {
        const maxUnits = cachedSenderBalanceUnits;
        if (maxUnits <= 0n) {
          amountInput.value = '0';
          break;
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
        const total = parseFloat(selectedSendToken.balanceDisplay.replace(/,/g, '')) || 0;
        const sendable = (total * pct) / 100;
        amountInput.value = sendable > 0 ? (Math.floor(sendable * 10000) / 10000).toString() : '0';
      }
      break;
    }

    case 'go-receive':
      if (activeAccount) {
        document.getElementById('receive-address-display').textContent = activeAccount.address;
        document.getElementById('receive-explorer-link').href = explorerAddressUrl(activeNetwork, activeAccount.address);
        renderQR(document.getElementById('receive-qr'), activeAccount.address);
      }
      show('receive');
      break;

    case 'go-faucet':
      setError('faucet-error', '');
      document.getElementById('faucet-explorer-link').classList.add('hidden');
      show('faucet');
      break;

    case 'go-history':
      show('history');
      await renderHistory();
      break;

    case 'go-add-key':
      clearSensitiveFields();
      setError('add-key-error', '');
      show('add-key');
      break;

    case 'submit-create': {
      const pw = document.getElementById('create-password').value;
      const pw2 = document.getElementById('create-password-confirm').value;
      if (pw.length < 8) return setError('create-error', 'Use at least 8 characters.');
      if (pw !== pw2) return setError('create-error', "Passwords don't match.");
      setError('create-error', '');
      try {
        const result = await bridge.send('wallet.create', { password: pw });
        pendingMnemonic = result.mnemonic;
        clearSensitiveFields();
        renderMnemonicGrid(pendingMnemonic, document.getElementById('mnemonic-grid'));
        document.getElementById('backup-confirmed').checked = false;
        document.getElementById('backup-continue').disabled = true;
        walletStore.setState({ hasVault: true, isUnlocked: true });
        events.emit(Events.WALLET_CREATED);
        show('backup');
      } catch (err) {
        setError('create-error', err.message);
      }
      break;
    }

    case 'finish-create':
      pendingMnemonic = null;
      document.getElementById('mnemonic-grid').innerHTML = '';
      await loadDashboard();
      break;

    case 'submit-import': {
      const pw = document.getElementById('import-password').value;
      if (pw.length < 8) return setError('import-error', 'Use at least 8 characters.');
      try {
        if (importMode === 'privatekey') {
          await bridge.send('wallet.importPrivateKey', {
            privateKeyHex: document.getElementById('import-privatekey').value,
            password: pw,
          });
        } else {
          await bridge.send('wallet.importMnemonic', {
            mnemonic: document.getElementById('import-mnemonic').value,
            password: pw,
          });
        }
        setError('import-error', '');
        clearSensitiveFields();
        walletStore.setState({ hasVault: true, isUnlocked: true });
        events.emit(Events.WALLET_IMPORTED);
        await loadDashboard();
      } catch (err) {
        setError('import-error', err.message);
      }
      break;
    }

    case 'submit-unlock': {
      const pw = document.getElementById('unlock-password').value;
      try {
        await bridge.send('wallet.unlock', { password: pw });
        setError('unlock-error', '');
        clearSensitiveFields();
        walletStore.setState({ isUnlocked: true });
        events.emit(Events.WALLET_UNLOCKED);
        await loadDashboard();
      } catch (err) {
        setError('unlock-error', err.message);
        document.getElementById('unlock-password').value = '';
      }
      break;
    }

    case 'confirm-reset':
      await bridge.send('wallet.reset');
      pendingMnemonic = null;
      activeAccount = null;
      pendingExportRef = null;
      pendingExportSecret = null;
      clearSensitiveFields();
      document.getElementById('mnemonic-grid').innerHTML = '';
      document.getElementById('export-mnemonic-grid').innerHTML = '';
      document.getElementById('export-privatekey-display').textContent = '';
      document.getElementById('accounts-list').innerHTML = '';
      show('welcome');
      break;

    case 'copy-address':
      if (activeAccount) {
        await navigator.clipboard.writeText(activeAccount.address);
        showToast('Address copied', 'info');
        const copyBtn = document.getElementById('dash-copy-btn');
        if (copyBtn) {
          copyBtn.classList.add('copied');
          setTimeout(() => copyBtn.classList.remove('copied'), 1000);
        }
      }
      break;

    case 'copy-receive-address':
      if (activeAccount) {
        await navigator.clipboard.writeText(activeAccount.address);
        showToast('Address copied', 'info');
      }
      break;

    case 'add-account': {
      try {
        await bridge.send('account.addHd');
        await refreshActiveAccountAndBalance();
        await renderAccountsList();
      } catch (err) {
        setError('add-key-error', err.message);
      }
      break;
    }

    case 'submit-add-key': {
      const hex = document.getElementById('add-key-input').value;
      try {
        await bridge.send('account.addImported', { privateKeyHex: hex });
        setError('add-key-error', '');
        clearSensitiveFields();
        await refreshActiveAccountAndBalance();
        await renderAccountsList();
        show('accounts');
      } catch (err) {
        setError('add-key-error', err.message);
      }
      break;
    }

    case 'switch-account': {
      const ref = JSON.parse(target.dataset.ref);
      await bridge.send('account.switch', { ref });
      await refreshActiveAccountAndBalance();
      await renderAccountsList();
      break;
    }

    case 'go-export-password':
      pendingExportRef = await bridge.send('account.getActiveRef');
      clearSensitiveFields();
      setError('export-password-error', '');
      show('export-password');
      break;

    case 'submit-export-password': {
      const pw = document.getElementById('export-password').value;
      try {
        pendingExportSecret = await bridge.send('wallet.exportSecret', {
          ref: pendingExportRef,
          password: pw,
        });
        setError('export-password-error', '');
        clearSensitiveFields();
        renderExportReveal(pendingExportSecret);
        show('export-reveal');
      } catch (err) {
        setError('export-password-error', err.message);
      }
      break;
    }

    case 'copy-export-secret': {
      if (!pendingExportSecret) break;
      const text = pendingExportSecret.kind === 'hd' ? pendingExportSecret.mnemonic : pendingExportSecret.privateKeyHex;
      await navigator.clipboard.writeText(text);
      break;
    }

    case 'claim-faucet': {
      const amountInput = document.getElementById('faucet-amount');
      const amount = Number(amountInput.value.trim());
      const btn = document.getElementById('faucet-claim-btn');
      const linkEl = document.getElementById('faucet-explorer-link');
      setError('faucet-error', '');
      linkEl.classList.add('hidden');
      if (!Number.isInteger(amount) || amount <= 0 || amount > Number(FAUCET_MAX_PER_CLAIM)) {
        setError('faucet-error', `Enter a whole number between 1 and ${FAUCET_MAX_PER_CLAIM}.`);
        break;
      }
      btn.disabled = true;
      btn.textContent = 'Claiming…';
      try {
        const result = await bridge.send('tx.claimFaucet', { amountUnits: amount });
        if (result && result.signature) {
          showToast(`Claimed ${amount} raw units`, 'success');
          linkEl.href = explorerTxUrl(activeNetwork, result.signature);
          linkEl.classList.remove('hidden');
        } else {
          showToast('Claimed', 'success');
        }
        await refreshBalance();
      } catch (err) {
        setError('faucet-error', err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Claim on-chain';
      }
      break;
    }

    case 'preview-send': {
      const toAddress = document.getElementById('send-to').value.trim();
      const amountRaw = document.getElementById('send-amount').value.trim();
      setError('send-error', '');

      if (!isValidThruAddress(toAddress)) {
        setError('send-error', "That doesn't look like a valid Thru address.");
        break;
      }
      if (activeAccount && toAddress.toLowerCase() === activeAccount.address.toLowerCase()) {
        setError('send-error', "That's the address you're sending from.");
        break;
      }
      let amountUnits;
      try {
        amountUnits = parseThruAmount(amountRaw);
      } catch (err) {
        setError('send-error', err.message);
        break;
      }

      // Save recipient into recent list
      saveRecentRecipient(toAddress).catch(() => {});

      const amountDisplay = `${formatThru(amountUnits)} ${selectedSendToken.symbol}`;
      pendingSend = { toAddress, amountUnits: amountUnits.toString(), amountDisplay };
      const reviewContainer = document.getElementById('tx-review-container');
      if (reviewContainer) {
        reviewContainer.innerHTML = renderTxReviewCard({
          toAddress,
          amountUnits,
          fromAddress: activeAccount.address,
          networkLabel: activeNetwork.label || 'Thru Alphanet',
          estimatedFee: '~1 raw unit',
        });
      }
      show('send-preview');
      break;
    }

    case 'confirm-send': {
      if (!pendingSend) break;
      const { toAddress, amountUnits, amountDisplay } = pendingSend;
      const btn = document.getElementById('send-confirm-btn');

      btn.disabled = true;
      btn.textContent = 'Sending…';
      try {
        const result = await bridge.send('tx.send', { toAddress, amountUnits });
        pendingSend = null;
        document.getElementById('send-to').value = '';
        document.getElementById('send-amount').value = '';
        if (result && result.signature) {
          showToast(`Sent ${amountDisplay}`, 'success');
        } else {
          showToast('Sent', 'success');
        }
        await refreshBalance();
        show('dashboard');
      } catch (err) {
        showToast(`Send failed: ${err.message}`, 'error');
        show('send');
        setError('send-error', err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Confirm & Send';
      }
      break;
    }

    case 'copy-history-sig': {
      if (target.dataset.sig) {
        await navigator.clipboard.writeText(target.dataset.sig);
        showToast('Signature copied', 'info');
      }
      break;
    }

    case 'refresh':
      await refreshBalance();
      break;

    case 'lock':
      clearSensitiveFields();
      await bridge.send('wallet.lock');
      walletStore.setState({ isUnlocked: false, activeAccount: null });
      events.emit(Events.WALLET_LOCKED);
      router.clearHistory();
      show('unlock');
      break;

    case 'go-settings':
      router.navigate('settings');
      break;

    default:
      break;
  }
}

document.getElementById('backup-confirmed')?.addEventListener('change', (e) => {
  document.getElementById('backup-continue').disabled = !e.target.checked;
});

document.getElementById('disclaimer-agreed')?.addEventListener('change', (e) => {
  document.getElementById('disclaimer-continue').disabled = !e.target.checked;
});

document.addEventListener('click', (e) => {
  const target = e.target.closest('[data-action]');
  if (!target || target.disabled) return;
  handleAction(target.dataset.action, target);
});

// Network health indicator
async function updateNetworkStatus(preloadedHealth = null) {
  const dot = document.getElementById('network-dot');
  const latencyEl = document.getElementById('network-latency');
  if (!dot) return;
  const result = preloadedHealth || (await bridge.send('tx.checkHealth'));
  dot.classList.remove('healthy', 'slow', 'offline');
  dot.classList.add(result.status);
  if (latencyEl) {
    latencyEl.textContent = result.latencyMs != null ? `${result.latencyMs} ms` : 'offline';
  }
}

// Live address validation on send screen
const sendToInput = document.getElementById('send-to');
if (sendToInput) {
  sendToInput.addEventListener('input', () => {
    const cleaned = sendToInput.value.replace(/\s/g, '');
    if (cleaned !== sendToInput.value) {
      const cursor = sendToInput.selectionStart - (sendToInput.value.length - cleaned.length);
      sendToInput.value = cleaned;
      sendToInput.setSelectionRange(cursor, cursor);
    }
    checkRecipientAddress(cleaned);
  });
}

// Accounts search filter
const accountsSearchInput = document.getElementById('accounts-search');
if (accountsSearchInput) {
  accountsSearchInput.addEventListener('input', (e) => {
    renderAccountsList(e.target.value);
  });
}

// Keyboard shortcuts (Enter to submit, Esc to go back)
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
    const activeEl = document.activeElement;
    if (activeEl && activeEl.tagName === 'TEXTAREA') return;
    const visibleScreen = document.querySelector('.screen:not(.hidden)');
    if (!visibleScreen) return;
    const primaryBtn = visibleScreen.querySelector('.btn.primary:not(:disabled)');
    if (primaryBtn) {
      e.preventDefault();
      primaryBtn.click();
    }
  }
  if (e.key === 'Escape') {
    const visibleScreen = document.querySelector('.screen:not(.hidden)');
    if (!visibleScreen) return;
    const backBtn = visibleScreen.querySelector('.icon-btn[data-icon="back"]');
    if (backBtn) {
      e.preventDefault();
      backBtn.click();
    }
  }
});

injectIcons();

// Register screen modules with the router.
// As screens are migrated from the monolithic handleAction(), they get
// registered here and the router manages their lifecycle.
router.register('settings', settingsScreen);
router.register('welcome', welcomeScreen);
router.register('receive', receiveScreen);
router.register('history', historyScreen);
router.register('faucet', faucetScreen);
router.register('unlock', unlockScreen);
router.register('reset-confirm', resetConfirmScreen);
router.register('create-password', createPasswordScreen);
router.register('backup', backupScreen);
router.register('import', importScreen);
router.register('add-key', addKeyScreen);
router.register('export-password', exportPasswordScreen);
router.register('export-reveal', exportRevealScreen);
router.register('rename-account', renameAccountScreen);
router.register('account-detail', accountDetailScreen);
router.register('dashboard', dashboardScreen);
router.register('send', sendScreen);


init();
