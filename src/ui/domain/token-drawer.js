// Token drawer: mutually exclusive asset list, mint details, and verified import views.
// The shared Sheet owns keyboard trapping, dismissals, focus restoration and teardown.

import { h } from '../kit/dom.js';
import { icon } from '../kit/icon.js';
import { Button, IconButton } from '../kit/button.js';
import { Field } from '../kit/field.js';
import { Sheet } from '../kit/sheet.js';
import { toast } from '../kit/toast.js';
import { AssetRow } from './token-row.js';
import { formatTokenAmount, shortAddress } from '../../shared/format.js';
import { isVerifiedTokenBalance } from '../../shared/tokens.js';

const NATIVE_ROW = Symbol('native asset row');
const STEP = Object.freeze({ IDLE: 'idle', CHECKING: 'checking', VERIFIED: 'verified', SAVING: 'saving' });

function shortMint(mint) {
  // Shared truncation (src/shared/format.js) — the drawer, Activity and the review card must
  // shorten the same mint the same way.
  return shortAddress(mint, { head: 6, tail: 6 });
}

/**
 * @param {Object} props
 *   assets        { nativeText, nativeUsd, tokens, stale, tokenState } snapshot to render
 *   networkLabel  network label for the rows (e.g. 'Betanet')
 *   onReadMint    async (mintAddress) => mint info; powers the on-chain lookup
 *   onReadDetails async cached read used only by the detail view
 *   onSetVisibility async (mintAddress, hidden) updates local asset visibility
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
  onReadDetails = onReadMint,
  onSetVisibility,
  onImportToken,
  onChanged,
  onClose,
} = {}) {
  const rows = new Map();
  let view = 'list';
  let step = STEP.IDLE;
  let lookup = null;
  let attempt = 0;
  let highlightMint = null;
  let showHidden = false;
  let selection = null;
  let listScrollTop = 0;
  let mintDetails = null;
  let visibilityPending = false;
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
      if (view === 'detail' && !visibilityPending) setView('list');
      else if (view === 'add' && step !== STEP.SAVING) setView('list');
      else if (view === 'list') sheet.close();
    },
  });
  const { track } = sheet;
  sheet.card.classList.add('is-listing');
  sheet.cleanup(() => {
    attempt += 1; // invalidate any in-flight lookup
    for (const { row } of rows.values()) row.destroy();
    rows.clear();
  });
  const close = () => sheet.close();

  // ============================================================================================
  // LIST VIEW
  // ============================================================================================
  function closeButton() {
    const button = h('button', { type: 'button', class: 'icon-btn icon-btn-ghost token-drawer-close', 'aria-label': 'Close' },
      h('img', { src: 'icons/rabby-close.svg', alt: '', width: 16, height: 16 }));
    sheet.d.on(button, 'click', () => { if (!visibilityPending) close(); });
    return button;
  }
  const searchField = track(Field({
    label: 'Search',
    placeholder: 'Symbol, name, or mint address',
    onInput: () => {
      listScroll.scrollTop = 0;
      renderList();
    },
  }));

  const listHost = h('div', { class: 'token-ledger' });
  const emptyHint = h('p', { class: 'token-drawer-empty', role: 'status' });
  const listScroll = h('div', { class: 'token-list-scroll' }, [listHost, emptyHint]);

  function matchesQuery(query, { symbol, name, mintAddress }) {
    if (!query) return true;
    return [symbol, name, mintAddress]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(query));
  }

  function tokenBalance(token) {
    const state = data.tokenState?.get(token.mintAddress);
    if (!isVerifiedTokenBalance(state)) return null;
    const symbol = state.symbol || token.symbol || 'TOKEN';
    if (state.tokenAccountExists === false || state.amountUnits === '0') return `0 ${symbol}`;
    return `${formatTokenAmount(BigInt(state.amountUnits), state.decimals)} ${symbol}`;
  }

  function renderList() {
    const query = searchField.value.trim().toLowerCase();
    const visible = new Map();
    const native = { symbol: 'THRU', name: 'Thru Native Token' };
    if (!showHidden && matchesQuery(query, native)) visible.set(NATIVE_ROW, native);
    for (const token of data.tokens || []) {
      if (Boolean(token.hidden) === showHidden && matchesQuery(query, token)) visible.set(token.mintAddress, token);
    }

    // Remove only rows no longer in view. Balance-only refreshes keep the elements,
    // listeners, focused item, and scroll anchor where the user left them.
    for (const [key, { row }] of rows) {
      if (visible.has(key)) continue;
      row.destroy();
      rows.delete(key);
    }
    let index = 0;
    for (const [key, token] of visible) {
      const isNative = key === NATIVE_ROW;
      const balanceState = isNative ? null : data.tokenState?.get(key);
      const balanceText = isNative ? data.nativeText : tokenBalance(token);
      const stale = isNative ? data.stale : Boolean(balanceState?.stale);
      const balanceNote = balanceState?.stale ? 'Cached' : balanceState?.error ? 'Unavailable' : null;
      const usdValue = isNative ? data.nativeUsd : null;
      let entry = rows.get(key);
      // An identity/display change is rare. Rebuild only the affected row, not its neighbours.
      if (!entry || entry.token.symbol !== token.symbol || entry.token.imageUrl !== token.imageUrl) {
        entry?.row.destroy();
        entry = { token };
        entry.row = AssetRow({
          symbol: token.symbol,
          name: token.name,
          mintAddress: token.mintAddress,
          imageUrl: token.imageUrl,
          network: networkLabel,
          isNative,
          balanceText,
          stale,
          balanceNote,
          usdValue,
          onClick: () => openDetails(entry.token),
        });
        rows.set(key, entry);
      } else {
        entry.token = token;
        entry.row.setBalance(balanceText, stale, usdValue, balanceNote);
      }
      const position = listHost.childNodes[index++] || null;
      if (entry.row.el !== position) listHost.insertBefore(entry.row.el, position);
    }

    const empty = visible.size === 0;
    const hint = !empty ? '' : query ? 'No matching tokens. Try a symbol, name, or mint address.'
      : showHidden ? 'No hidden tokens.' : 'No tokens to display.';
    if (emptyHint.textContent !== hint) emptyHint.textContent = hint;

    if (highlightMint) {
      const item = rows.get(highlightMint)?.row.el;
      item?.classList.add('just-added');
      item?.scrollIntoView?.({ block: 'nearest' });
      highlightMint = null;
    }
  }

  const addTokenBtn = track(IconButton({
    title: 'Add custom token',
    iconName: 'plus',
    variant: 'icon-btn-ghost',
    onClick: () => setView('add'),
  }));
  const hiddenBtn = h('button', {
    type: 'button',
    class: 'icon-btn icon-btn-ghost',
    title: 'Hidden tokens',
    'aria-label': 'Hidden tokens',
    'aria-pressed': 'false',
  }, icon('eyeOff', 16));
  function setHiddenMode(next) {
    showHidden = next;
    hiddenBtn.setAttribute('aria-pressed', String(showHidden));
    listTitle.textContent = showHidden ? 'Hidden tokens' : 'Tokens';
  }
  sheet.d.on(hiddenBtn, 'click', () => {
    setHiddenMode(!showHidden);
    listScroll.scrollTop = 0;
    renderList();
  });
  const listTitle = h('h2', { text: 'Tokens' });
  const listHead = h('div', { class: 'modal-head token-drawer-head' }, [
    h('span', { class: 'modal-icon' }, icon('coins', 18)),
    listTitle,
    h('div', { class: 'token-drawer-toolbar' }, [hiddenBtn, addTokenBtn.el, closeButton()]),
  ]);

  const listView = h('div', { class: 'token-view' }, [
    listHead,
    searchField.el,
    listScroll,
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
      });
    } catch (error) {
      if (sheet.closed) return;
      sheet.setDismissible(true);
      setStep(STEP.VERIFIED);
      const safeMessages = {
        ALREADY_EXISTS: 'That token is already in your token list.',
        ACCOUNT_MISSING: 'No token mint exists at that address on this network.',
        UNSUPPORTED: 'That address is not a supported token mint.',
        CONTEXT_CHANGED: 'The active network changed. Find the token again.',
        RPC_UNAVAILABLE: 'Could not verify the token mint right now. Try again.',
        INVALID_INPUT: 'Enter a valid token mint address.',
      };
      mintField.setError(safeMessages[error?.code] || 'Could not save that token.');
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

    // A just-added mint belongs in the visible list, not under a previous Hidden/search filter.
    setHiddenMode(false);
    searchField.value = '';
    highlightMint = added.mint;
    resetAdd();
    setView('list');
    toast({
      tone: 'success',
      title: `${symbol} added`,
      message: rows.has(added.mint) ? 'It now appears in your token list.' : 'Token saved. Refresh Assets to update the list.',
    });
  }

  // ============================================================================================
  // DETAIL VIEW — one read for the selected mint, zero RPCs for list rows.
  const detailsBack = track(IconButton({ iconName: 'back', title: 'Back to tokens', onClick: () => setView('list') }));
  const detailsTitle = h('h2', { text: 'Token details' });
  const balanceValue = h('strong');
  const detailFreshness = h('p', { class: 'hint', role: 'status' });
  const mintFacts = h('dl', { class: 'token-detail-card token-mint-facts' });
  const detailStatus = h('p', { class: 'hint', role: 'status' });
  const retryBtn = track(Button({ label: 'Retry details', variant: 'secondary', onClick: () => loadDetails() }));
  const visibilityBtn = h('button', { type: 'button', class: 'btn secondary' });
  const visibilityNote = h('p', { class: 'hint' });
  const detailView = h('div', { class: 'token-view hidden' }, [
    h('header', { class: 'modal-head token-drawer-head' }, [detailsBack.el, detailsTitle, closeButton()]),
    h('section', { class: 'token-detail-card' }, [h('h3', { text: 'My balance' }), balanceValue, detailFreshness]),
    mintFacts, detailStatus, retryBtn.el, visibilityBtn, visibilityNote,
  ]);

  function currentSelection() {
    return data.tokens?.find((token) => token.mintAddress === selection?.mintAddress) || selection;
  }

  function renderDetails() {
    const token = currentSelection();
    if (!token) return;
    const mint = token.mintAddress;
    detailsTitle.textContent = mintDetails?.ticker || token.symbol || token.name || 'Token details';
    balanceValue.textContent = (mint ? tokenBalance(token) : data.nativeText) || 'Balance unavailable';
    detailFreshness.textContent = (mint ? data.tokenState?.get(mint)?.stale : data.stale) ? 'Cached · may be out of date' : '';
    const facts = [['Network', networkLabel]];
    if (mint) facts.push(['Mint address', mint]);
    if (mintDetails?.exists) {
      const { decimals, supply, hasFreezeAuthority } = mintDetails;
      if (Number.isInteger(decimals) && decimals >= 0 && decimals <= 18) {
        facts.push(['Decimals', String(decimals)]);
        if (supply != null && /^\d+$/.test(String(supply))) {
          facts.push(['Total supply', formatTokenAmount(BigInt(supply), decimals)]);
        }
      }
      if (typeof hasFreezeAuthority === 'boolean') facts.push(['Freeze authority', hasFreezeAuthority ? 'Present' : 'None']);
    }
    mintFacts.replaceChildren(...facts.flatMap(([term, value]) => [h('dt', { text: term }), h('dd', { text: value })]));
    visibilityBtn.classList.toggle('hidden', !mint || !onSetVisibility);
    visibilityBtn.textContent = token.hidden ? 'Show in Assets' : 'Remove from Assets';
    visibilityNote.textContent = mint && onSetVisibility
      ? 'This only changes what Assets shows. It does not move funds or delete the token.' : '';
  }

  async function loadDetails() {
    const mint = selection?.mintAddress;
    const id = ++attempt;
    retryBtn.el.classList.add('hidden');
    if (!mint || !onReadDetails) return;
    detailStatus.textContent = 'Checking mint details…';
    try {
      const verified = await onReadDetails(mint);
      if (sheet.closed || view !== 'detail' || id !== attempt) return;
      mintDetails = verified?.exists ? verified : null;
      detailStatus.textContent = mintDetails ? '' : 'Mint details unavailable.';
      retryBtn.el.classList.toggle('hidden', Boolean(mintDetails));
      renderDetails();
    } catch {
      if (sheet.closed || view !== 'detail' || id !== attempt) return;
      detailStatus.textContent = 'Mint details could not be loaded.';
      retryBtn.el.classList.remove('hidden');
    }
  }

  function openDetails(token) {
    selection = token;
    mintDetails = null;
    detailStatus.textContent = '';
    setView('detail');
    loadDetails();
  }

  sheet.d.on(visibilityBtn, 'click', async () => {
    const token = currentSelection();
    if (!token?.mintAddress || !onSetVisibility || visibilityPending) return;
    const hidden = !token.hidden;
    visibilityPending = true;
    visibilityBtn.disabled = true;
    sheet.setDismissible(false);
    try {
      await onSetVisibility(token.mintAddress, hidden);
      if (sheet.closed) return;
      data = { ...data, tokens: (data.tokens || []).map((row) => row.mintAddress === token.mintAddress
        ? { ...row, hidden } : row) };
      visibilityPending = false;
      setView('list');
    } catch {
      if (!sheet.closed) visibilityNote.textContent = 'Could not update token visibility. Try again.';
    } finally {
      visibilityPending = false;
      visibilityBtn.disabled = false;
      if (!sheet.closed) sheet.setDismissible(true);
    }
  });

  // VIEW SWITCH
  // ============================================================================================
  function setView(next) {
    if (sheet.closed || next === view) return;
    if (step === STEP.SAVING || visibilityPending) return; // never abandon a save mid-flight
    const fromDetail = view === 'detail';
    if (view === 'list') listScrollTop = listScroll.scrollTop;
    attempt += 1;
    view = next;
    listView.classList.toggle('hidden', next !== 'list');
    addView.classList.toggle('hidden', next !== 'add');
    detailView.classList.toggle('hidden', next !== 'detail');
    sheet.card.classList.toggle('is-adding', next === 'add');
    sheet.card.classList.toggle('is-listing', next === 'list');
    if (next === 'add') {
      resetAdd();
      requestAnimationFrame(() => mintField.focus());
    } else if (next === 'detail') {
      renderDetails();
      requestAnimationFrame(() => { if (!sheet.closed && view === 'detail') detailsBack.el.focus(); });
    } else {
      const imported = Boolean(highlightMint);
      renderList();
      const origin = fromDetail ? rows.get(selection?.mintAddress ?? NATIVE_ROW)?.row.el : null;
      if (!imported) listScroll.scrollTop = listScrollTop;
      requestAnimationFrame(() => {
        if (!sheet.closed && view === 'list') {
          const row = origin?.isConnected ? origin : null;
          (row ?? searchField.control).focus({ preventScroll: true });
          row?.scrollIntoView?.({ block: 'nearest' });
        }
      });
    }
  }

  // ============================================================================================
  // ASSEMBLE + OPEN
  // ============================================================================================
  sheet.card.appendChild(listView);
  sheet.card.appendChild(addView);
  sheet.card.appendChild(detailView);

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
      else if (view === 'detail') renderDetails();
    },
    destroy() {
      close();
    },
  };
}
