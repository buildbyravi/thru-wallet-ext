// Token drawer — the Rabby-style slide-up sheet behind the balance box.
//
// The dashboard's balance box is the entry point ("click anywhere in the box"): tapping it
// opens THIS sheet, which owns the whole token list — search, rows, and the "Add custom
// token" flow. The dashboard body keeps only a quiet Tokens strip; the list itself lives
// here, exactly like Rabby's balance-card → token-drawer split.
//
// Honesty rules, unchanged from the old inline ledger:
//   - Rows render from what the chain/registry actually returned; a balance that could not
//     be read is "—", never a zero (AssetRow decides how to show it).
//   - The sample USDC row is a deliberate preview row (balance 0.00) when no USDC is
//     registered — kept from the original "full Rabby token ledger preview" design.
//   - "Add custom token" verifies the pasted mint on-chain (readMint) and takes decimals
//     from the chain before import — free-typed decimals corrupt base-unit amounts.
//
// Structure reuses the transaction-detail sheet's primitives wholesale: .modal-overlay +
// .tx-sheet bottom card, backdrop click / Escape / Close all close, focus-trap wraps Tab,
// focus returns to whatever opened the drawer. Every node comes from h(); every handler is
// registered through the disposer so teardown leaves no listener on a detached node.

import { h, disposer } from '../kit/dom.js';
import { icon } from '../kit/icon.js';
import { Button } from '../kit/button.js';
import { Field } from '../kit/field.js';
import { focusTrap } from '../kit/focus-trap.js';
import { AssetRow } from './token-row.js';
import { formatTokenAmount } from '../../shared/format.js';

/**
 * @param {Object} props
 *   assets        { nativeText, nativeUsd, tokens, stale, tokenState } snapshot to render
 *   networkLabel  network label for the rows (e.g. 'Betanet')
 *   onReadMint    async (mintAddress) => mint info; powers the on-chain lookup
 *   onImportToken async ({ mintAddress, symbol, name, decimals }) => saved record
 *   onChanged     async () => called after a successful import so the host can reload
 *   onClose       () => called exactly once when the drawer closes
 * @returns {{ el: HTMLElement, update(assets): void, destroy(): void }}
 */
export function TokenDrawer({
  assets = {},
  networkLabel = 'Betanet',
  onReadMint,
  onImportToken,
  onChanged,
  onClose,
} = {}) {
  const d = disposer();
  const owned = [];
  let trap = null;
  let closed = false;
  let rows = [];
  let data = {
    nativeText: '—',
    nativeUsd: null,
    tokens: [],
    stale: false,
    tokenState: null,
    ...assets,
  };

  function track(component) {
    owned.push(component);
    return component;
  }

  function close() {
    if (closed) return;
    closed = true;
    // Release the Tab trap first so focus is restored to the opener before the node leaves
    // the document — restoring afterwards lands on <body> and the user loses their place.
    trap?.destroy();
    trap = null;
    for (const c of owned) c.destroy?.();
    owned.length = 0;
    d.dispose();
    overlay.remove();
    onClose?.();
  }

  // ---- Head ----------------------------------------------------------------
  const closeBtn = track(Button({
    label: 'Close',
    variant: 'text',
    onClick: () => close(),
  }));

  const head = h('div', { class: 'modal-head token-drawer-head' }, [
    h('span', { class: 'modal-icon' }, icon('coins', 18)),
    h('h2', { text: 'Tokens' }),
    closeBtn.el,
  ]);

  // ---- Search --------------------------------------------------------------
  const searchField = track(Field({
    label: 'Search',
    placeholder: 'Symbol, name, or mint address',
    onInput: () => renderList(),
  }));

  // ---- List ----------------------------------------------------------------
  const listHost = h('div', { class: 'token-ledger' });
  const emptyHint = h('p', { class: 'token-drawer-empty hidden', text: '' });

  function disposeRows() {
    for (const row of rows) row.destroy();
    rows = [];
    while (listHost.firstChild) listHost.removeChild(listHost.firstChild);
  }

  function matchesQuery(query, { symbol, name, mintAddress }) {
    if (!query) return true;
    return [symbol, name, mintAddress]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(query));
  }

  function renderList() {
    disposeRows();
    const query = searchField.value.trim().toLowerCase();

    // Native THRU row. No changePercent: this wallet has no market-data source.
    if (matchesQuery(query, { symbol: 'THRU', name: 'Thru Native Token' })) {
      rows.push(AssetRow({
        symbol: 'THRU',
        name: 'Thru Native Token',
        balanceText: data.nativeText,
        usdValue: data.nativeUsd,
        network: networkLabel,
        isNative: true,
        stale: data.stale,
      }));
    }

    const allTokens = [...(data.tokens || [])];
    // Preview row when no USDC is registered — kept from the original ledger design.
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
      if (!matchesQuery(query, token)) continue;
      const state = data.tokenState?.get(token.mintAddress);
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
      rows.push(AssetRow({
        symbol: token.symbol,
        name: token.name,
        balanceText,
        network: networkLabel,
        mintAddress: token.mintAddress,
        imageUrl: token.imageUrl,
        usdValue: '$0.00',
      }));
    }

    for (const row of rows) listHost.appendChild(row.el);
    const empty = rows.length === 0;
    emptyHint.classList.toggle('hidden', !empty);
    emptyHint.textContent = empty
      ? `No tokens match “${searchField.value.trim()}”.`
      : '';
  }

  // ---- Add custom token ----------------------------------------------------
  // The MetaMask flow: paste the mint (contract) address, the chain verifies it and
  // supplies the real decimals, then the record joins the list. Decimals are read from the
  // chain on purpose: sends burn base units of the actual decimals, so free-typed metadata
  // corrupts amounts (a wrong-decimals custom token is worse than no token).
  let addTokenOpen = false;
  let checking = false;
  let submitting = false;
  let lookup = null;

  function setAddTokenOpen(open, { reset = false } = {}) {
    addTokenOpen = Boolean(open);
    addTokenPanel.hidden = !addTokenOpen;
    addTokenBtn.el.setAttribute('aria-expanded', String(addTokenOpen));
    if (!addTokenOpen && reset) {
      for (const f of [mintField, symbolField, nameField, decimalsField]) {
        f.value = '';
        f.setError('');
      }
      lookup = null;
      addBtn.el.disabled = true;
      addTokenHint.textContent = '';
    }
    if (addTokenOpen) mintField.focus();
  }

  async function checkMint() {
    const mint = mintField.value.trim();
    if (!mint || checking || typeof onReadMint !== 'function') return;
    checking = true;
    checkBtn.setBusy(true);
    mintField.setError('');
    try {
      const info = await onReadMint(mint);
      if (!info || info.exists === false) {
        lookup = null;
        addBtn.el.disabled = true;
        mintField.setError('No token mint exists at that address.');
        addTokenHint.textContent = '';
        return;
      }
      lookup = info;
      symbolField.value = info.ticker || '';
      if (!nameField.value.trim()) nameField.value = info.ticker || '';
      decimalsField.value = String(info.decimals ?? '');
      addTokenHint.textContent = `Verified on chain · ${info.decimals} decimals · supply ${info.supply ?? '—'}.`;
      addBtn.el.disabled = false;
    } catch (err) {
      lookup = null;
      addBtn.el.disabled = true;
      addTokenHint.textContent = '';
      mintField.setError(err?.message || 'Could not read that address from the chain.');
    } finally {
      checking = false;
      checkBtn.setBusy(false);
    }
  }

  async function submitAdd() {
    const mint = mintField.value.trim();
    const symbol = symbolField.value.trim();
    const name = nameField.value.trim();
    const decimals = Number(decimalsField.value.trim());
    if (!mint || submitting || typeof onImportToken !== 'function') return;
    symbolField.setError('');
    decimalsField.setError('');
    if (!lookup || lookup.exists === false) {
      mintField.setError('Check the address on-chain first.');
      return;
    }
    if (!symbol) {
      symbolField.setError('Symbol is required.');
      return;
    }
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
      decimalsField.setError('Use a whole number 0–18.');
      return;
    }
    submitting = true;
    addBtn.setBusy(true);
    try {
      await onImportToken({ mintAddress: mint, symbol, name: name || symbol, decimals });
      setAddTokenOpen(false, { reset: true });
      // The host reloads and pushes a fresh snapshot through update(); until it answers,
      // the list keeps showing what it already knew (never a blanked sheet).
      await onChanged?.();
    } catch (err) {
      mintField.setError(err?.message || 'Could not save that token.');
    } finally {
      submitting = false;
      addBtn.setBusy(false);
    }
  }

  const mintField = Field({
    label: 'Token mint (contract address)',
    placeholder: 'ta… mint address',
    hint: 'Verified against the chain before adding.',
    onInput: () => {
      lookup = null;
      addBtn.el.disabled = true;
    },
    onEnter: () => { void checkMint(); },
  });
  const symbolField = Field({ label: 'Symbol', maxLength: 12, placeholder: 'e.g. LAB' });
  const nameField = Field({ label: 'Name', maxLength: 48, placeholder: 'Token name (optional)' });
  const decimalsField = Field({
    label: 'Decimals',
    inputMode: 'numeric',
    maxLength: 2,
    hint: 'Filled from the chain on lookup.',
  });
  const checkBtn = track(Button({ label: 'Check on chain', onClick: () => { void checkMint(); } }));
  const addBtn = track(Button({ label: 'Add to wallet', primary: true, onClick: () => { void submitAdd(); } }));
  addBtn.el.disabled = true;
  const cancelBtn = track(Button({
    label: 'Cancel',
    variant: 'text',
    onClick: () => setAddTokenOpen(false, { reset: true }),
  }));
  const addTokenHint = h('p', { class: 'add-token-hint', text: '' });

  const addTokenPanel = h('div', { class: 'add-token-panel', hidden: true }, [
    mintField.el,
    addTokenHint,
    checkBtn.el,
    symbolField.el,
    nameField.el,
    decimalsField.el,
    h('div', { class: 'add-token-actions' }, [addBtn.el, cancelBtn.el]),
  ]);
  track(mintField);
  track(symbolField);
  track(nameField);
  track(decimalsField);

  const addTokenBtn = track(Button({
    label: 'Add custom token',
    onClick: () => setAddTokenOpen(!addTokenOpen),
  }));
  addTokenBtn.el.classList.add('token-drawer-add');

  // ---- Assemble + open -----------------------------------------------------
  const card = h('div', { class: ['modal-card', 'tx-sheet', 'token-drawer'] }, [
    head,
    searchField.el,
    addTokenPanel,
    listHost,
    emptyHint,
    addTokenBtn.el,
  ]);

  const overlay = h('div', { class: 'modal-overlay tx-sheet-overlay' }, card);

  // Backdrop click closes; a click inside must not.
  d.on(overlay, 'mousedown', (event) => {
    if (event.target === overlay) close();
  });

  trap = focusTrap(card, { onEscape: () => close() });

  document.body.appendChild(overlay);
  renderList();
  requestAnimationFrame(() => {
    overlay.classList.add('open');
    trap?.focusFirst();
    // The drawer's job is browsing tokens — put the caret in the search, not on Close.
    searchField.focus();
  });

  return {
    el: overlay,
    /** Push a fresh snapshot (balances changed / import succeeded) and repaint the rows. */
    update(next = {}) {
      if (closed) return;
      data = {
        nativeText: '—',
        nativeUsd: null,
        tokens: [],
        stale: false,
        tokenState: null,
        ...next,
      };
      renderList();
    },
    destroy() {
      close();
    },
  };
}
