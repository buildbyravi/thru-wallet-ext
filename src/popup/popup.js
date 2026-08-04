import {
  createVault,
  importMnemonicVault,
  importPrivateKeyVault,
  hasVault,
  isUnlocked,
  unlock,
  lock,
  resetWallet,
  hasSeed,
  getActiveAccount,
  getActiveRef,
  listAccounts,
  switchActiveAccount,
  addHdAccount,
  addImportedKey,
  exportAccountSecret,
} from '../lib/vault.js';
import {
  getAccountInfo,
  createOnChainAccount,
  formatThru,
  parseThruAmount,
  isValidThruAddress,
  claimFaucet,
  FAUCET_MAX_PER_CLAIM,
  sendTransfer,
  listAccountHistory,
  explorerTxUrl,
  explorerAddressUrl,
  checkNetworkHealth,
} from '../lib/thru-client.js';
import { icons, byteMarkHtml } from './icons.js';
import { showToast } from './toast.js';
import { renderQR } from './qr.js';

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
  'send',
  'send-preview',
  'receive',
  'faucet',
  'history',
];

// Every input whose value counts as sensitive (recovery phrases, private keys, passwords).
// Cleared on every navigation transition that leaves its screen, and unconditionally on
// reset, so nothing lingers in a form field after it stops being relevant — that's what
// made a previously-imported key "auto show up" again after a reset.
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
    document.getElementById(`screen-${s}`).classList.toggle('hidden', s !== name);
  }
}

function setError(id, message) {
  const el = document.getElementById(id);
  if (!message) {
    el.classList.add('hidden');
    el.textContent = '';
  } else {
    el.classList.remove('hidden');
    el.textContent = message;
  }
}

function truncateAddress(address) {
  if (!address || address.length < 18) return address;
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function refsEqual(a, b) {
  if (!a || !b || a.kind !== b.kind) return false;
  return a.kind === 'hd' ? a.index === b.index : a.keyIndex === b.keyIndex;
}

// Byte-mark identicon per address (see icons.js). Square container for
// seed-derived accounts, round for imported keys — same seed/key distinction
// Rabby draws with square vs circle avatars.

function renderMnemonicGrid(mnemonic, gridEl) {
  gridEl.innerHTML = '';
  mnemonic.split(' ').forEach((word, i) => {
    const span = document.createElement('span');
    span.innerHTML = `${i + 1}. <b>${word}</b>`;
    gridEl.appendChild(span);
  });
}

// Holds the mnemonic only transiently, between "create" and the user confirming they saved
// it on the backup screen. Never written to disk in plaintext.
let pendingMnemonic = null;
let activeAccount = null;
let importMode = 'mnemonic'; // 'mnemonic' | 'privatekey'
let pendingExportRef = null;
let pendingExportSecret = null;
// v1.1: staged send data (preview → confirm flow)
let pendingSend = null; // { toAddress, amountUnits, amountDisplay }

async function init() {
  // v1.1: first-run disclaimer — show once, gate everything behind it
  const { disclaimerAcknowledged } = await chrome.storage.local.get('disclaimerAcknowledged');
  if (!disclaimerAcknowledged) {
    show('disclaimer');
    return;
  }
  await proceedAfterDisclaimer();
}

/** Normal init flow — called after disclaimer is acknowledged (or was already). */
async function proceedAfterDisclaimer() {
  const has = await hasVault();
  if (!has) {
    show('welcome');
    return;
  }
  const unlocked = await isUnlocked();
  if (unlocked) {
    await loadDashboard();
  } else {
    show('unlock');
  }
  // v1.1: check network health (non-blocking, fire-and-forget)
  updateNetworkStatus();
}

async function loadDashboard() {
  show('dashboard');
  await refreshActiveAccountAndBalance();
}

async function refreshActiveAccountAndBalance() {
  activeAccount = await getActiveAccount();
  document.getElementById('dash-account-mark').innerHTML = byteMarkHtml(activeAccount.address, activeAccount.ref);
  document.getElementById('dash-account-address').textContent = truncateAddress(activeAccount.address);
  await refreshBalance();
}

async function renderAccountsList() {
  const accounts = await listAccounts();
  const activeRef = await getActiveRef();
  const container = document.getElementById('accounts-list');
  container.innerHTML = '';
  for (const acc of accounts) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'row' + (refsEqual(acc.ref, activeRef) ? ' active' : '');
    row.dataset.action = 'switch-account';
    row.dataset.ref = JSON.stringify(acc.ref);
    row.innerHTML = `${byteMarkHtml(acc.address, acc.ref)}<span class="row-body"><span class="row-title">${acc.label}</span><span class="row-sub">${truncateAddress(acc.address)}</span></span>`;
    container.appendChild(row);
  }
  document.getElementById('add-account-btn').classList.toggle('hidden', !(await hasSeed()));
}

async function refreshBalance() {
  const balanceEl = document.getElementById('balance-display');
  const statusEl = document.getElementById('account-status');
  const rawHintEl = document.getElementById('raw-balance-hint');
  const banner = document.getElementById('bootstrap-banner');
  balanceEl.textContent = '…';
  const info = await getAccountInfo(activeAccount.address);
  if (info.exists) {
    balanceEl.textContent = formatThru(info.balance);
    rawHintEl.textContent = `${info.balance.toString()} raw units`;
    statusEl.textContent = '';
    banner.classList.add('hidden');
  } else {
    balanceEl.textContent = '0';
    rawHintEl.textContent = '';
    statusEl.textContent = '';
    banner.classList.remove('hidden');
  }
}

function historyIconAndClass(entry) {
  if (entry.success === false) return { icon: icons.x(), cls: 'failed' };
  if (entry.kind === 'sent') return { icon: icons.send(14), cls: 'sent' };
  if (entry.kind === 'received') return { icon: icons.receive(14), cls: 'received' };
  if (entry.kind === 'faucet') return { icon: icons.plus(), cls: 'faucet' };
  return { icon: icons.dot(), cls: 'other' };
}

function historyDescription(entry) {
  if (entry.kind === 'sent') return `Sent ${formatThru(entry.amount)} THRU to ${truncateAddress(entry.counterparty)}`;
  if (entry.kind === 'received') return `Received ${formatThru(entry.amount)} THRU from ${truncateAddress(entry.counterparty)}`;
  if (entry.kind === 'faucet') return `Claimed ${formatThru(entry.amount)} THRU from faucet`;
  return `Program call (${truncateAddress(entry.programAddress)})`;
}

async function renderHistory() {
  const container = document.getElementById('history-list');
  const statusEl = document.getElementById('history-status');
  container.innerHTML = '';
  statusEl.textContent = 'Loading…';
  try {
    const entries = await listAccountHistory(activeAccount.address);
    statusEl.textContent = entries.length ? '' : 'No transactions yet for this account.';
    for (const entry of entries) {
      const { icon, cls } = historyIconAndClass(entry);
      const row = document.createElement('div');
      row.className = 'row';
      const sigDisplay = entry.signature ? truncateAddress(entry.signature) : 'pending';
      const linkHtml = entry.signature
        ? `<a class="history-explorer-link" href="${explorerTxUrl(entry.signature)}" target="_blank" rel="noopener" title="View on explorer">${icons.external()}</a>`
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

async function handleAction(action, target) {
  switch (action) {
    case 'go-welcome':
      clearSensitiveFields();
      setError('create-error', '');
      setError('import-error', '');
      show('welcome');
      break;

    // v1.1: disclaimer acknowledgment
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

    case 'go-dashboard':
      clearSensitiveFields();
      pendingExportRef = null;
      pendingExportSecret = null;
      document.getElementById('export-mnemonic-grid').innerHTML = '';
      document.getElementById('export-privatekey-display').textContent = '';
      await loadDashboard();
      break;

    case 'go-accounts':
      await renderAccountsList();
      show('accounts');
      break;

    case 'go-send':
      setError('send-error', '');
      pendingSend = null;
      show('send');
      break;

    case 'go-receive':
      document.getElementById('receive-address-display').textContent = activeAccount.address;
      document.getElementById('receive-explorer-link').href = explorerAddressUrl(activeAccount.address);
      // v1.1: render QR code
      renderQR(document.getElementById('receive-qr'), activeAccount.address);
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
      pendingMnemonic = await createVault(pw);
      clearSensitiveFields();
      renderMnemonicGrid(pendingMnemonic, document.getElementById('mnemonic-grid'));
      document.getElementById('backup-confirmed').checked = false;
      document.getElementById('backup-continue').disabled = true;
      show('backup');
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
          await importPrivateKeyVault(document.getElementById('import-privatekey').value, pw);
        } else {
          await importMnemonicVault(document.getElementById('import-mnemonic').value, pw);
        }
        setError('import-error', '');
        clearSensitiveFields();
        await loadDashboard();
      } catch (err) {
        setError('import-error', err.message);
      }
      break;
    }

    case 'submit-unlock': {
      const pw = document.getElementById('unlock-password').value;
      try {
        await unlock(pw);
        setError('unlock-error', '');
        clearSensitiveFields();
        await loadDashboard();
      } catch (err) {
        setError('unlock-error', err.message);
        document.getElementById('unlock-password').value = '';
      }
      break;
    }

    case 'confirm-reset':
      await resetWallet();
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

    case 'create-account': {
      const btn = document.getElementById('create-account-btn');
      btn.disabled = true;
      btn.textContent = 'Creating…';
      try {
        await createOnChainAccount(activeAccount);
        await refreshBalance();
      } catch (err) {
        document.getElementById('account-status').textContent = `Account creation failed: ${err.message}`;
      } finally {
        btn.disabled = false;
        btn.textContent = 'Create on-chain account';
      }
      break;
    }

    case 'add-account': {
      try {
        await addHdAccount();
        await refreshActiveAccountAndBalance();
        await renderAccountsList();
      } catch (err) {
        setError('add-key-error', err.message); // reused as a generic inline error slot on this screen
      }
      break;
    }

    case 'submit-add-key': {
      const hex = document.getElementById('add-key-input').value;
      try {
        await addImportedKey(hex);
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
      await switchActiveAccount(ref);
      await refreshActiveAccountAndBalance();
      await renderAccountsList();
      break;
    }

    case 'go-export-password':
      pendingExportRef = await getActiveRef();
      clearSensitiveFields();
      setError('export-password-error', '');
      show('export-password');
      break;

    case 'submit-export-password': {
      const pw = document.getElementById('export-password').value;
      try {
        pendingExportSecret = await exportAccountSecret(pendingExportRef, pw);
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
        const signature = await claimFaucet(activeAccount, amount);
        if (signature) {
          showToast(`Claimed ${amount} raw units`, 'success');
          linkEl.href = explorerTxUrl(signature);
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
      if (toAddress === activeAccount.address) {
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

      // Stage the send and show preview
      const amountDisplay = `${formatThru(amountUnits)} THRU`;
      pendingSend = { toAddress, amountUnits, amountDisplay };
      document.getElementById('preview-amount').textContent = amountDisplay;
      document.getElementById('preview-to').textContent = toAddress;
      document.getElementById('preview-total').textContent = `~${amountDisplay}`;
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
        const signature = await sendTransfer(activeAccount, toAddress, amountUnits);
        pendingSend = null;
        document.getElementById('send-to').value = '';
        document.getElementById('send-amount').value = '';
        if (signature) {
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
      await lock();
      show('unlock');
      break;

    default:
      break;
  }
}

document.getElementById('backup-confirmed').addEventListener('change', (e) => {
  document.getElementById('backup-continue').disabled = !e.target.checked;
});

// v1.1: disclaimer checkbox enables the Continue button
document.getElementById('disclaimer-agreed').addEventListener('change', (e) => {
  document.getElementById('disclaimer-continue').disabled = !e.target.checked;
});

document.addEventListener('click', (e) => {
  const target = e.target.closest('[data-action]');
  if (!target || target.disabled) return;
  handleAction(target.dataset.action, target);
});

// ---- v1.1: Network health indicator ----------------------------------------

async function updateNetworkStatus() {
  const dot = document.getElementById('network-dot');
  const latencyEl = document.getElementById('network-latency');
  if (!dot) return;
  const result = await checkNetworkHealth();
  // Remove all status classes, then add the current one
  dot.classList.remove('healthy', 'slow', 'offline');
  dot.classList.add(result.status);
  if (latencyEl) {
    latencyEl.textContent = result.latencyMs != null ? `${result.latencyMs} ms` : 'offline';
  }
}

// ---- v1.1: Address validation on send screen -------------------------------

const sendToInput = document.getElementById('send-to');
if (sendToInput) {
  sendToInput.addEventListener('input', () => {
    const indicator = document.getElementById('send-to-indicator');
    // Auto-strip all whitespace (spaces, newlines, tabs) — users paste from
    // explorers/messages which often include trailing junk.
    const cleaned = sendToInput.value.replace(/\s/g, '');
    if (cleaned !== sendToInput.value) {
      const cursor = sendToInput.selectionStart - (sendToInput.value.length - cleaned.length);
      sendToInput.value = cleaned;
      sendToInput.setSelectionRange(cursor, cursor);
    }
    if (!cleaned) {
      indicator.classList.add('hidden');
      indicator.classList.remove('valid', 'invalid');
      return;
    }
    const valid = isValidThruAddress(cleaned);
    indicator.classList.remove('hidden', 'valid', 'invalid');
    indicator.classList.add(valid ? 'valid' : 'invalid');
    indicator.innerHTML = valid ? icons.check(12) : icons.x(12);
  });
}

// ---- v1.1: Keyboard shortcuts (Enter to submit, Esc to go back) -----------

document.addEventListener('keydown', (e) => {
  // Enter: click the visible primary button on the current screen
  if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
    const activeEl = document.activeElement;
    // Don't intercept if a textarea is focused (mnemonic/key input needs Enter for newlines)
    if (activeEl && activeEl.tagName === 'TEXTAREA') return;
    // Find the currently visible screen
    const visibleScreen = document.querySelector('.screen:not(.hidden)');
    if (!visibleScreen) return;
    const primaryBtn = visibleScreen.querySelector('.btn.primary:not(:disabled)');
    if (primaryBtn) {
      e.preventDefault();
      primaryBtn.click();
    }
  }
  // Esc: click the back button on the current screen
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

// ---- v1.1: Copy history sigs with toast ------------------------------------

// (Already handled in handleAction; this comment marks the end of v1.1 additions)

injectIcons();
init();
