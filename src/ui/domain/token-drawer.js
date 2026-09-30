// Token drawer — the Rabby-style slide-up sheet behind the balance box.
//
// The dashboard's balance box is the entry point ("click anywhere in the box", exactly like
// Rabby's BalanceView -> activePopup('AssetList')): tapping it opens THIS sheet, which owns
// the whole token list — search, rows, and the "Add custom token" flow.
//
// TWO VIEWS, NEVER BOTH  (fixes "wallet tokens show up in the middle of adding a token")
//
//   list view : head, search, token rows, "Add custom token"
//   add view  : back, mint field, verification, preview, "Add token"
//
// The previous drawer kept ONE column — head, search, add-form, token list, add button — and
// merely toggled the form open, so the whole wallet ledger stayed on screen between the form
// and the button while the user was mid-add. On save it also closed the form BEFORE awaiting
// the host reload, so the list flashed stale rows. Now the views are mutually exclusive
// (`.hidden` on the inactive one, which also removes it from the focus trap), and the drawer
// only returns to the list AFTER the host has reloaded, with the new row highlighted.
//
// ADD FLOW (Rabby "Add custom token": paste address -> we look it up -> confirm)
//
//   idle -> checking -> verified -> saving -> (back to list, new row highlighted)
//
//   - Decimals are ALWAYS taken from the chain and shown read-only. Sends burn base units
//     of the real decimals, so a free-typed value corrupts amounts; the old form offered an
//     editable Decimals input while its own comment forbade it.
//   - The symbol is taken from the chain too; the field only appears when the mint carries
//     no ticker.
//   - A mint already in the list is refused before the network call.
//   - Every async step is guarded by an attempt counter, so editing the address mid-lookup
//     can never apply a stale result.
//
// Honesty rules, unchanged: a balance that could not be read is "—", never a zero.
//
// Overlay, backdrop, focus trap, open animation and teardown come from kit/sheet.js (shared with
// the security sheet). Every node comes from h(); every handler goes through the sheet's
// disposer, so teardown leaves no listener on a detached node.

import { h, clear } from '../kit/dom.js';
import { icon } from '../kit/icon.js';
import { Button, IconButton } from '../kit/button.js';
import { Field } from '../kit/field.js';
import { Sheet } from '../kit/sheet.js';
import { toast } from '../kit/toast.js';
import { AssetRow } from './token-row.js';
import { formatTokenAmount } from '../../shared/format.js';

const STEP = Object.freeze({ IDLE: 'idle', CHECKING: 'checking', VERIFIED: 'verified', SAVING: 'saving' });

function shortMint(mint) {
  const s = String(mint || '');
  return s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-6)}` : s;
}

/**
 * @param {Object} props
 *   assets        { nativeText, nativeUsd, tokens, stale, tokenState } snapshot to render
 *   networkLabel  network label for the rows (e.g. 'Betanet')
 *   onReadMint    async (mintAddress) => mint info; powers the on-chain lookup
 *   onImportToken async ({ mintAddress, symbol, name, decimals }) => saved record
 *   onChanged     async () => called after a successful import so the host can reload;
 *                 the drawer waits for it BEFORE showing the list again
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
  let rows = [];
  let view = 'list';
  let step = STEP.IDLE;
  let lookup = null;
  let attempt = 0;
  let highlightMint = null;
  let data = {
    nativeText: '—',
    nativeUsd: null,
    tokens: [],
    stale: false,
    tokenState: null,
    ...assets,
  };

  // Escape steps back one level: add view -> list -> closed. A save in flight is never abandoned.
  const sheet = Sheet({
    label: 'Tokens',
    className: 'token-drawer',
    onClose,
    onEscape: () => {
      if (view === 'add' && step !== STEP.SAVING) setView('list');
      else if (view === 'list') sheet.close();
    },
  });
  const { track } = sheet;
  sheet.cleanup(() => {
    attempt += 1; // invalidate any in-flight lookup
    for (const row of rows) row.destroy();
    rows = [];
  });
  const close = () => sheet.close();

  // ============================================================================================
  // LIST VIEW
  // ============================================================================================
  const closeBtn = track(Button({ label: 'Close', variant: 'text', onClick: () => close() }));
  const listHead = h('div', { class: 'modal-head token-drawer-head' }, [
    h('span', { class: 'modal-icon' }, icon('coins', 18)),
    h('h2', { text: 'Tokens' }),
    closeBtn.el,
  ]);

  const searchField = track(Field({
    label: 'Search',
    placeholder: 'Symbol, name, or mint address',
    onInput: () => renderList(),
  }));

  const listHost = h('div', { class: 'token-ledger' });
  const emptyHint = h('p', { class: 'token-drawer-empty hidden', text: '' });

  function disposeRows() {
    for (const row of rows) row.destroy();
    rows = [];
    clear(listHost);
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

    for (const token of allTokens) {
      if (token.hidden) continue;
      if (!matchesQuery(query, token)) continue;
      const state = data.tokenState?.get(token.mintAddress);
      let balanceText = null;
      if (state && state.error !== true && state.amountUnits != null) {
        const decimals = Number.isInteger(state.decimals) ? state.decimals
          : (Number.isInteger(token.decimals) ? token.decimals : 0);
        balanceText = `${formatTokenAmount(BigInt(state.amountUnits), decimals)} ${token.symbol || 'TOKEN'}`;
      } else if (state && state.error !== true && state.tokenAccountExists === false) {
        balanceText = `0 ${token.symbol || 'TOKEN'}`;
      }
      const row = AssetRow({
        symbol: token.symbol,
        name: token.name,
        balanceText,
        network: networkLabel,
        mintAddress: token.mintAddress,
        imageUrl: token.imageUrl,
        usdValue: '$0.00',
      });
      if (highlightMint && token.mintAddress === highlightMint) row.el.classList.add('just-added');
      rows.push(row);
    }

    for (const row of rows) listHost.appendChild(row.el);
    const empty = rows.length === 0;
    emptyHint.classList.toggle('hidden', !empty);
    emptyHint.textContent = empty ? `No tokens match “${searchField.value.trim()}”.` : '';

    if (highlightMint) {
      const target = rows.find((r) => r.el.classList.contains('just-added'));
      target?.el.scrollIntoView?.({ block: 'nearest' });
      highlightMint = null; // one-shot: the highlight fades, it never sticks to later repaints
    }
  }

  const addTokenBtn = track(Button({
    label: 'Add custom token',
    iconName: 'plus',
    onClick: () => setView('add'),
  }));
  addTokenBtn.el.classList.add('token-drawer-add');

  const listView = h('div', { class: 'token-view' }, [
    listHead,
    searchField.el,
    listHost,
    emptyHint,
    addTokenBtn.el,
  ]);

  // ============================================================================================
  // ADD VIEW
  // ============================================================================================
  const backBtn = track(IconButton({
    iconName: 'back',
    title: 'Back to tokens',
    onClick: () => setView('list'),
  }));
  const addHead = h('div', { class: 'modal-head token-drawer-head' }, [
    backBtn.el,
    h('h2', { text: 'Add custom token' }),
  ]);

  const mintField = track(Field({
    label: 'Token mint address',
    placeholder: 'Paste the mint address',
    hint: 'We look it up on the Thru network before anything is saved.',
    onInput: () => {
      // Editing the address invalidates any lookup, in flight or finished.
      attempt += 1;
      lookup = null;
      symbolField.setError('');
      mintField.setError('');
      setStep(STEP.IDLE);
    },
    onEnter: () => { void checkMint(); },
  }));

  const pasteBtn = track(Button({
    label: 'Paste from clipboard',
    variant: 'text',
    size: 'sm',
    iconName: 'copy',
    full: false,
    onClick: async () => {
      try {
        const text = (await navigator.clipboard.readText()).trim();
        if (!text) return;
        mintField.value = text;
        attempt += 1;
        lookup = null;
        setStep(STEP.IDLE);
        await checkMint();
      } catch {
        mintField.setError('Clipboard access was denied. Paste the address into the field.');
      }
    },
  }));

  // Verified preview card — everything here came from the chain.
  const previewAvatar = h('div', { class: 'token-row-avatar' }, h('span', { text: '?' }));
  const previewSymbol = h('span', { class: 'add-token-preview-symbol', text: '' });
  const previewBadge = h('span', { class: 'add-token-verified' }, [icon('check', 11), h('span', { text: 'Verified on chain' })]);
  const previewDecimals = h('span', { class: 'add-token-stat-value', text: '—' });
  const previewSupply = h('span', { class: 'add-token-stat-value', text: '—' });
  const previewMint = h('span', { class: 'add-token-stat-value mono', text: '—' });
  const preview = h('div', { class: 'add-token-preview hidden' }, [
    h('div', { class: 'add-token-preview-head' }, [
      previewAvatar,
      h('div', { class: 'add-token-preview-title' }, [previewSymbol, previewBadge]),
    ]),
    h('dl', { class: 'add-token-stats' }, [
      h('div', {}, [h('dt', { text: 'Decimals' }), h('dd', {}, previewDecimals)]),
      h('div', {}, [h('dt', { text: 'Supply' }), h('dd', {}, previewSupply)]),
      h('div', {}, [h('dt', { text: 'Mint' }), h('dd', {}, previewMint)]),
    ]),
  ]);

  const symbolField = track(Field({
    label: 'Symbol',
    maxLength: 12,
    placeholder: 'e.g. LAB',
    hint: 'This mint has no ticker on chain — choose how it appears in your list.',
  }));
  symbolField.el.classList.add('hidden');

  const scamNote = h('p', { class: 'add-token-note hidden' }, [
    icon('warning', 13),
    h('span', { text: 'Anyone can create a token with any name. Only add tokens you trust.' }),
  ]);

  const findBtn = track(Button({
    label: 'Find token',
    variant: 'primary',
    onClick: () => checkMint(),
  }));
  const addBtn = track(Button({
    label: 'Add token',
    variant: 'primary',
    busyLabel: 'Adding…',
    onClick: () => submitAdd(),
  }));
  addBtn.el.classList.add('hidden');
  const cancelBtn = track(Button({ label: 'Cancel', variant: 'text', onClick: () => setView('list') }));

  const addView = h('div', { class: 'token-view hidden' }, [
    addHead,
    mintField.el,
    h('div', { class: 'add-token-tools' }, [pasteBtn.el]),
    preview,
    symbolField.el,
    scamNote,
    h('div', { class: 'add-token-actions' }, [findBtn.el, addBtn.el, cancelBtn.el]),
  ]);

  function setStep(next) {
    step = next;
    const verified = next === STEP.VERIFIED || next === STEP.SAVING;
    preview.classList.toggle('hidden', !verified);
    scamNote.classList.toggle('hidden', !verified);
    symbolField.el.classList.toggle('hidden', !(verified && lookup && !lookup.ticker));
    findBtn.el.classList.toggle('hidden', verified);
    addBtn.el.classList.toggle('hidden', !verified);
    findBtn.el.disabled = next === STEP.CHECKING;
    findBtn.setBusy?.(next === STEP.CHECKING);
    addBtn.setBusy?.(next === STEP.SAVING);
    cancelBtn.el.disabled = next === STEP.SAVING;
    backBtn.update?.({ disabled: next === STEP.SAVING });
  }

  function resetAdd() {
    attempt += 1;
    lookup = null;
    mintField.value = '';
    symbolField.value = '';
    mintField.setError('');
    symbolField.setError('');
    setStep(STEP.IDLE);
  }

  function findExisting(mint) {
    return (data.tokens || []).find((t) => t.mintAddress === mint) || null;
  }

  async function checkMint() {
    const mint = mintField.value.trim();
    if (step === STEP.CHECKING || step === STEP.SAVING) return;
    if (!mint) {
      mintField.setError('Paste a mint address first.');
      return;
    }
    if (typeof onReadMint !== 'function') return;
    mintField.setError('');

    const existing = findExisting(mint);
    if (existing) {
      mintField.setError(existing.hidden
        ? 'This token is already saved but hidden.'
        : 'This token is already in your list.');
      return;
    }

    const mine = ++attempt;
    setStep(STEP.CHECKING);
    try {
      const info = await onReadMint(mint);
      if (sheet.closed || mine !== attempt) return; // the address changed, or the drawer closed
      if (!info || info.exists === false) {
        mintField.setError('No token mint exists at that address on this network.');
        setStep(STEP.IDLE);
        return;
      }
      const decimals = Number(info.decimals);
      if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
        mintField.setError('This mint reports a decimals value the wallet cannot use safely.');
        setStep(STEP.IDLE);
        return;
      }
      lookup = { mint, ticker: String(info.ticker || '').trim(), decimals, supply: info.supply ?? null };
      previewSymbol.textContent = lookup.ticker || 'Unnamed token';
      previewAvatar.replaceChildren(h('span', { text: (lookup.ticker || '?').slice(0, 3).toUpperCase() }));
      previewDecimals.textContent = String(decimals);
      previewSupply.textContent = lookup.supply == null ? '—' : String(lookup.supply);
      previewMint.textContent = shortMint(mint);
      symbolField.value = lookup.ticker;
      setStep(STEP.VERIFIED);
    } catch (error) {
      if (sheet.closed || mine !== attempt) return;
      mintField.setError(error?.message || 'Could not read that address from the chain.');
      setStep(STEP.IDLE);
    }
  }

  async function submitAdd() {
    if (step !== STEP.VERIFIED || !lookup || typeof onImportToken !== 'function') return;
    const symbol = (lookup.ticker || symbolField.value).trim();
    symbolField.setError('');
    if (!symbol) {
      symbolField.setError('Enter a symbol for this token.');
      return;
    }
    const added = lookup;
    setStep(STEP.SAVING);
    sheet.setDismissible(false);

    try {
      await onImportToken({
        mintAddress: added.mint,
        symbol,
        name: symbol,
        decimals: added.decimals,
      });
    } catch (error) {
      if (sheet.closed) return;
      sheet.setDismissible(true);
      setStep(STEP.VERIFIED);
      mintField.setError(error?.message || 'Could not save that token.');
      return;
    }

    // The token IS saved from here on. A failed reload must not be reported as a failed add;
    // the host already surfaces its own load error, and the next load picks the token up.
    try {
      await onChanged?.();
    } catch {
      // host reports its own errors
    }
    if (sheet.closed) return;
    sheet.setDismissible(true);

    highlightMint = added.mint;
    resetAdd();
    setView('list');
    toast({
      tone: 'success',
      title: `${symbol} added`,
      message: 'It now appears in your token list.',
    });
  }

  // ============================================================================================
  // VIEW SWITCH
  // ============================================================================================
  function setView(next) {
    if (sheet.closed || next === view) return;
    if (step === STEP.SAVING) return; // never abandon a save mid-flight
    view = next;
    listView.classList.toggle('hidden', next !== 'list');
    addView.classList.toggle('hidden', next !== 'add');
    sheet.card.classList.toggle('is-adding', next === 'add');
    if (next === 'add') {
      resetAdd();
      requestAnimationFrame(() => mintField.focus());
    } else {
      renderList();
      requestAnimationFrame(() => searchField.focus());
    }
  }

  // ============================================================================================
  // ASSEMBLE + OPEN
  // ============================================================================================
  sheet.card.appendChild(listView);
  sheet.card.appendChild(addView);

  renderList();
  // The drawer's job is browsing tokens — put the caret in the search, not on Close.
  sheet.open({ onOpen: () => searchField.focus() });

  return {
    el: sheet.el,
    /**
     * Push a fresh snapshot (balances changed / import succeeded). Keys that are absent keep
     * their previous value, so a partial snapshot can never blank the token list.
     */
    update(next = {}) {
      if (sheet.closed) return;
      data = { ...data, ...next };
      if (view === 'list') renderList();
    },
    destroy() {
      close();
    },
  };
}
