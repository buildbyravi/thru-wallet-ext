// Swap route UI — first product surface of the shipped swap capability (2026-10-26 ship
// decision; graduated 2026-10-25 on dated live evidence:
// scripts/defi-evidence/2026-10-25-live-swap-probe.json — pool init, add-liquidity and swap
// all vmError 0 on betanet, CPMM quote math matched the wallet's unit-for-unit).
//
// Flow, all contract-checked wires (contract v17/v18):
//   load:   dex.listPools (auth none) + token.getBalances + token.list
//   review: dex.quote({ poolId, inputAssetId, outputAssetId, inputAmountUnits, slippageBps })
//   bind:   dex.prepareSwap({ quoteId, clientRequestId }) → review, incl. bindingHash+intentId
//   sign:   intent.submit({ intentId, bindingHash, acknowledgements, password }) (auth signing)
//   settle: intent.get polling — a signature string alone is not proof of inclusion.
//
// Tone rules enforced here: no vocabulary from the program layer in user copy (the quarantine
// test greps for it outside the backend), no innerHTML, no parseFloat. "Swap" is the user word.

import { h, disposer } from '../../kit/dom.js';
import { icon } from '../../kit/icon.js';
import { Button } from '../../kit/button.js';
import { Field } from '../../kit/field.js';
import { PageHeader, Banner } from '../../kit/feedback.js';
import * as bridge from '../bridge.js';
import { requirePassword } from '../../domain/password-prompt.js';
import { parseTokenAmount, formatTokenAmount, truncateAddress } from '../../../shared/format.js';

export function SwapRoute({ navigate, back }) {
  const d = disposer();
  const owned = [];
  let account = null;
  let network = null;
  let destroyed = false;

  let pools = [];              // dex.listPools items: { poolId, mintOne, mintTwo, swapFeeBps, … }
  let tokens = [];             // token.list records (known mints incl. imports)
  let balanceMap = new Map();  // mintAddress -> getBalances row
  let symbolDecimals = new Map(); // mintAddress -> { symbol, decimals } chain-verified

  function track(c) { owned.push(c); return c; }

  const banner = Banner({ tone: 'error' });
  // Hard rule 15 (2026-10-26): first paint is the full form skeleton; every value is a labelled
  // placeholder so the popup never dims to a lone spinner waiting on a chain read.
  const body = h('div', { class: 'stack stack-4' });
  const header = PageHeader({ title: 'Swap', onBack: () => back() });
  const el = h('section', { class: 'screen' }, [header.el, banner.el, body]);
  renderShellist();

  function clearBody() {
    for (const c of owned) c.destroy?.();
    owned.length = 0;
    while (body.firstChild) body.removeChild(body.firstChild);
  }

  /** Skeletal first paint: nothing here implies a balance or a tradable pool. */
  function renderShellist() {
    clearBody();
    const ph = (label) => h('select', { class: 'swap-select', disabled: true }, [
      h('option', { text: `${label} — checking…` }),
    ]);
    body.appendChild(h('div', { class: 'swap-field stack stack-2' }, [
      h('span', { class: 'eyebrow', text: 'From' }), ph('From'), h('p', { class: 'hint', text: 'Checking balances…' }),
    ]));
    body.appendChild(h('div', { class: 'swap-field stack stack-2' }, [
      h('span', { class: 'eyebrow', text: 'To' }), ph('To'), h('p', { class: 'hint', text: 'Checking pools…' }),
    ]));
  }

  function friendlyReason(error) {
    const code = error && error.code;
    if (code === 'SWAP_CAPABILITY_DISABLED') {
      return 'Swaps are not available on this network right now.';
    }
    if (code === 'FEATURE_DISABLED' || code === 'DEFI_DISABLED') {
      return 'Swaps are switched off in this build.';
    }
    if (code === 'ACCOUNT_MISSING' || code === 'NO_ACTIVE_ACCOUNT') {
      return 'Unlock the wallet first.';
    }
    if (code === 'QUOTE_EXPIRED') return 'That quote expired. Re-quote to continue.';
    return (error && error.message) || 'Something failed while loading swaps.';
  }

  async function load({ notice = null } = {}) {
    header.setTitle('Swap');
    banner.clear();

    // Hard rule 15 (2026-10-26): paint immediately from local state. Cached balances/token
    // registry are storage reads and cost well under a paint frame; pool discovery is a chain
    // read and so always hydrates. Tokens we know render instantly, live pools refill below.
    let cachedBal = null;
    try {
      const [acc, net, bal, cached, list] = await Promise.all([
        bridge.send('account.getActive'),
        bridge.send('network.getActive'),
        bridge.send('token.getBalances').catch((e) => e),           // live may fail fast; cache follows
        bridge.send('token.getCachedBalances'),
        bridge.send('token.list'),
      ]);
      account = acc;
      network = net;
      if (bal && !bal.code && bal.balances) {                        // a real payload has balances
        balanceMap = new Map((bal.balances || []).map((r) => [r.mintAddress, r]));
      }
      cachedBal = bal?.balances ? null : cached;                     // live already won ⇒ no stale paint
      tokens = Array.isArray(list) ? list : (list && list.tokens) || [];
      symbolDecimals = new Map(tokens.map((t) => [t.mintAddress, {
        symbol: (t.symbol || 'TOKEN').trim() || 'TOKEN',
        decimals: Number.isInteger(t.decimals) ? t.decimals : 9,
      }]));

      if (cachedBal?.balances?.length && balanceMap.size === 0) {
        // Chain read for balances failed/empty: paint the cached snapshot with a stale label.
        balanceMap = new Map((cachedBal.balances || []).map((r) => [r.mintAddress, r]));
        banner.set('Balances are last-known cached — chain is still answering.', 'warning');
      }

      // The pool list is chain-fresh; it comes last and hydrates the form. Auto-discovery:
      // list only pairs that can actually settle — listPools derives pool
      // addresses from the wallet's known mints, so a mint the wallet does not know yet can
      // never appear in a pair. Adopt any pool-mint we see (chain-verified serverside) before
      // rendering — new tokens from pools thus show up without the user pasting addresses.
      const poolsRes = await bridge.send('dex.listPools', { limit: 50 }).catch((e) => ({ supported: false, reason: e?.message || 'rpc-error' }));
      pools = (poolsRes && poolsRes.supported && Array.isArray(poolsRes.items)) ? poolsRes.items : [];
      if (pools.length) {
        const unknown = [...new Set(pools.flatMap((p) => [p.mintOne, p.mintTwo]).filter(Boolean))]
          .filter((m) => !symbolDecimals.has(m));
        if (unknown.length) {
          const adopted = await bridge.send('token.discover', {
            address: account.address,
            candidateMints: unknown,
          }).catch(() => null);
          if (adopted?.adopted?.length) {
            const again = await bridge.send('token.list').catch(() => ([]));
            tokens = Array.isArray(again) ? again : (again && again.tokens) || [];
            symbolDecimals = new Map(tokens.map((t) => [t.mintAddress, {
              symbol: (t.symbol || 'TOKEN').trim() || 'TOKEN',
              decimals: Number.isInteger(t.decimals) ? t.decimals : 9,
            }]));
            const balAgain = await bridge.send('token.getBalances').catch(() => null);
            if (balAgain) {
              balanceMap = new Map(((balAgain && balAgain.balances) || []).map((r) => [r.mintAddress, r]));
            }
          }
        }
      }
      if (notice) banner.set(notice, 'warning');
      if (!pools.length) renderEmpty(poolsRes);
      else renderForm();
    } catch (error) {
      // Hard rule 15: never a spinner forever — local cache may still be renderable.
      try {
        const cached = await bridge.send('token.getCachedBalances', { address: account?.address });
        if (cached?.balances?.length) paintCachedShell(cached.balances, friendlyReason(error));
        else mountError('Swap unavailable', friendlyReason(error));
      } catch {
        mountError('Swap unavailable', friendlyReason(error));
      }
    }
  }

  /**
   * Rule-15 cold-start paint when the chain is unreachable: the last verified token rows the
   * wallet cached, marked stale, with swap controls explicitly disabled and the real reason
   * shown. Being able to see your assets on a dead network is spotless even when execution
   * certainly cannot proceed.
   */
  function paintCachedShell(rows, reason) {
    clearBody();
    body.appendChild(h('div', { class: 'notice' }, [
      icon('warning', 16),
      h('span', { text: `Chain connection slow or unreachable. Showing cached balances — swap is disabled until the network answers. (${reason || 'offline'})` }),
    ]));
    const list = h('div', { class: 'detail-table' });
    for (const row of rows) {
      if (!row?.mintAddress) continue;
      list.appendChild(h('div', { class: 'detail-row' }, [
        h('span', { class: 'eyebrow', text: row.symbol || 'TOKEN' }),
        h('span', { class: 'detail-val mono', text: row.tokenAccountExists === false || row.amountUnits == null
          ? 'unknown'
          : formatTokenAmount(BigInt(String(row.amountUnits)), Number.isInteger(row.decimals) ? row.decimals : 9) }),
      ]));
    }
    body.appendChild(list);
  }

  function mountError(title, message) {
    clearBody();
    body.appendChild(h('div', { class: 'empty-state' }, [
      h('div', { class: 'empty-state-icon' }, icon('warning', 20)),
      h('p', { class: 'empty-state-title', text: title }),
      h('p', { class: 'hint center', text: message || '' }),
    ]));
  }

  /** A mint that the wallet knows together with pool connectivity is swappable. */
  function mintMeta(mint) {
    const known = symbolDecimals.get(mint);
    if (known) return known;
    const balRow = balanceMap.get(mint);
    return {
      symbol: (balRow && balRow.symbol) ? balRow.symbol : `${mint.slice(0, 6)}…`,
      decimals: (balRow && Number.isInteger(balRow.decimals)) ? balRow.decimals : 9,
    };
  }

  function balanceUnitsOf(mint) {
    const row = balanceMap.get(mint);
    if (!row || row.tokenAccountExists !== true || row.amountUnits == null) return 0n;
    try { return BigInt(String(row.amountUnits)); } catch { return 0n; }
  }

  // ------------------------------------------------------------------ empty state

  function renderEmpty(poolsRes) {
    clearBody();
    const note = poolsRes && poolsRes.supported === false
      ? 'Pool discovery is not available on this network.'
      : 'No pools found between the tokens this wallet knows. Pools form between pairs of token mints — import the other mint of a pair to swap against it.';
    body.appendChild(h('div', { class: 'notice' }, [
      icon('warning', 16),
      h('span', { text: note }),
    ]));

    const input = track(Field({
      label: 'Token mint address',
      placeholder: 'ta…',
      autocomplete: 'off',
      spellcheck: false,
      onInput: () => {
        importBtn.update({ disabled: !/^ta[A-Za-z0-9_-]{20,}$/.test(String(input.value || '').trim()) });
      },
    }));
    const importBtn = track(Button({
      label: 'Import token',
      kind: 'primary',
      wide: true,
      disabled: true,
      onClick: async () => {
        banner.clear();
        importBtn.setBusy(true);
        importBtn.update({ disabled: true });
        try {
          const mintAddress = String(input.value || '').trim();
          const mintInfo = await bridge.send('token.readMint', { mintAddress });
          if (!mintInfo?.exists) throw new Error('The chain has no token mint at that address.');
          if (!Number.isInteger(mintInfo.decimals) || mintInfo.decimals < 0 || mintInfo.decimals > 18) {
            throw new Error('The chain did not report a usable denomination for that mint.');
          }
          const symbol = String(mintInfo.ticker || '').trim() || 'TOKEN';
          const name = symbol;
          await bridge.send('token.import', { mintAddress, symbol, name, decimals: mintInfo.decimals });
          await load({ notice: `${symbol} imported.` });
        } catch (error) {
          banner.set(error.message || 'Import failed.');
        } finally {
          importBtn.setBusy(false);
        }
      },
    }));

    body.appendChild(input.el);
    body.appendChild(h('div', { class: 'screen-actions' }, [importBtn.el]));
  }

  // ------------------------------------------------------------------ main form

  function renderForm() {
    clearBody();

    // Swappable mints = mints that appear in some discovered pool. A mint with no pool can
    // never be quoted, so it is omitted rather than failing at submit time.
    const poolMints = [...new Set(pools.flatMap((p) => [p.mintOne, p.mintTwo]).filter(Boolean))];
    const poolFor = (a, b) => pools.find((p) =>
      (p.mintOne === a && p.mintTwo === b) || (p.mintOne === b && p.mintTwo === a));
    const partnerMints = (mint) => {
      const out = [];
      for (const p of pools) {
        if (p.mintOne === mint && p.mintTwo) out.push(p.mintTwo);
        else if (p.mintTwo === mint && p.mintOne) out.push(p.mintOne);
      }
      return [...new Set(out)];
    };

    const sorted = [...poolMints].sort((a, b) => {
      const balA = balanceUnitsOf(a); const balB = balanceUnitsOf(b);
      if (balA !== balB) return balB > balA ? 1 : -1;
      return mintMeta(a).symbol.localeCompare(mintMeta(b).symbol);
    });

    const fromSelect = h('select', { class: 'swap-select', 'aria-label': 'Swap from token' });
    const toSelect = h('select', { class: 'swap-select', 'aria-label': 'Swap to token' });
    const balanceLine = h('p', { class: 'hint' });

    const amountInput = track(Field({
      label: 'Amount in',
      placeholder: '0.0',
      inputMode: 'decimal',
      autocomplete: 'off',
      spellcheck: false,
      onInput: () => syncEnabled(),
    }));

    const quoteBox = h('div', { class: 'detail-table hidden' });
    const reviewBtn = track(Button({
      label: 'Review swap',
      kind: 'primary',
      wide: true,
      disabled: true,
      onClick: () => doReview(),
    }));

    function syncFromOptions() {
      const prev = fromSelect.value;
      fromSelect.replaceChildren();
      for (const m of sorted) {
        const meta = mintMeta(m);
        fromSelect.appendChild(h('option', {
          value: m,
          text: `${meta.symbol} · ${formatTokenAmount(balanceUnitsOf(m), meta.decimals)} ${meta.symbol}`,
        }));
      }
      if (sorted.includes(prev)) fromSelect.value = prev;
      const withBalance = sorted.find((m) => balanceUnitsOf(m) > 0n);
      if (withBalance && !sorted.includes(prev)) fromSelect.value = withBalance;
    }

    function syncToOptions() {
      const from = fromSelect.value;
      const partners = partnerMints(from);
      const prev = toSelect.value;
      toSelect.replaceChildren();
      for (const m of partners) {
        toSelect.appendChild(h('option', { value: m, text: mintMeta(m).symbol }));
      }
      if (partners.length && !partners.includes(prev)) toSelect.value = partners[0];
      else if (partners.includes(prev)) toSelect.value = prev;

      const meta = mintMeta(from);
      balanceLine.textContent = `Available: ${formatTokenAmount(balanceUnitsOf(from), meta.decimals)} ${meta.symbol}`;
      syncEnabled();
    }

    function syncEnabled() {
      const from = fromSelect.value;
      const to = toSelect.value;
      const hasPool = Boolean(from && to && from !== to && poolFor(from, to));
      const hasAmount = String(amountInput.value || '').trim() !== '';
      reviewBtn.update({ disabled: !(hasPool && hasAmount) });
      quoteBox.classList.add('hidden');
    }

    d.on(fromSelect, 'change', syncToOptions);
    d.on(toSelect, 'change', syncEnabled);

    syncFromOptions();
    syncToOptions();

    body.appendChild(h('div', { class: 'swap-field stack stack-2' }, [
      h('span', { class: 'eyebrow', text: 'From' }),
      fromSelect,
      balanceLine,
    ]));
    body.appendChild(h('div', { class: 'swap-field stack stack-2' }, [
      h('span', { class: 'eyebrow', text: 'To' }),
      toSelect,
    ]));
    body.appendChild(amountInput.el);
    body.appendChild(quoteBox);
    body.appendChild(h('div', { class: 'screen-actions' }, [reviewBtn.el]));

    async function doReview() {
      const fromMint = fromSelect.value;
      const toMint = toSelect.value;
      const pool = poolFor(fromMint, toMint);
      if (!pool || !account?.address) return;
      banner.clear();

      const inMeta = mintMeta(fromMint);
      let amountUnits;
      try {
        amountUnits = parseTokenAmount(amountInput.value, inMeta.decimals);
      } catch (error) {
        banner.set(error.message);
        return;
      }
      const balance = balanceUnitsOf(fromMint);
      if (amountUnits > balance) {
        banner.set(`Amount exceeds the ${inMeta.symbol} balance.`, 'warning');
        return;
      }

      reviewBtn.setBusy(true);
      reviewBtn.update({ disabled: true });
      try {
        const quote = await bridge.send('dex.quote', {
          address: account.address,
          poolId: pool.poolId,
          inputAssetId: fromMint,
          outputAssetId: toMint,
          inputAmountUnits: amountUnits.toString(),
          slippageBps: 50,
        });
        if (!quote || quote.supported === false || !quote.quoteId) {
          const reason = quote && typeof quote.reason === 'string' ? quote.reason : null;
          banner.set(reason === 'insufficient-liquidity'
            ? 'This pair does not have enough depth for that amount right now.'
            : reason === 'pool-not-found'
              ? 'That pool is not readable right now.'
              : 'No quote was produced for this pair.', 'warning');
          return;
        }
        showQuote({ pool, quote, fromMint, toMint, inMeta, outMeta: mintMeta(toMint), amountUnits });
      } catch (error) {
        banner.set(friendlyReason(error));
      } finally {
        reviewBtn.setBusy(false);
        syncEnabled();
      }
    }

    function showQuote(ctx) {
      const { pool, quote, fromMint, toMint, inMeta, outMeta } = ctx;
      quoteBox.classList.remove('hidden');
      quoteBox.replaceChildren();
      quoteBox.appendChild(h('div', { class: 'detail-row' }, [
        h('span', { class: 'eyebrow', text: 'You pay' }),
        h('span', { class: 'detail-val mono', text: `${formatTokenAmount(ctx.amountUnits, inMeta.decimals)} ${inMeta.symbol}` }),
      ]));
      quoteBox.appendChild(h('div', { class: 'detail-row' }, [
        h('span', { class: 'eyebrow', text: 'You receive (quoted)' }),
        h('span', { class: 'detail-val mono', text: `${formatTokenAmount(BigInt(String(quote.output.amountUnits)), outMeta.decimals)} ${outMeta.symbol}` }),
      ]));
      quoteBox.appendChild(h('div', { class: 'detail-row' }, [
        h('span', { class: 'eyebrow', text: 'Price impact' }),
        h('span', { class: 'detail-val mono', text: `${(Number(quote.priceImpactBps) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%` }),
      ]));
      quoteBox.appendChild(h('div', { class: 'detail-row' }, [
        h('span', { class: 'eyebrow', text: 'Pool fee' }),
        h('span', { class: 'detail-val mono', text: `${formatTokenAmount(BigInt(String(quote.feeTotal.lpFeeUnits)), inMeta.decimals)} ${inMeta.symbol}` }),
      ]));
      quoteBox.appendChild(h('div', { class: 'detail-row' }, [
        h('span', { class: 'eyebrow', text: 'Quote expires' }),
        h('span', { class: 'detail-val mono', text: new Date(quote.expiresAt).toLocaleTimeString() }),
      ]));
      body.appendChild(h('p', { class: 'hint', text:
        'A quote is a live reserve read. Confirming prepares a signed review; execution stays '
        + 'bounded by your slippage on-chain.' }));

      reviewBtn.update({ label: 'Prepare & sign', disabled: false });
      // Re-target the primary action to the sign step; review state must be fresh.
      reviewBtn.update({ onClick: () => doPrepareAndSign(ctx) });
      quoteBox.scrollIntoView({ block: 'nearest' });
    }

    async function doPrepareAndSign(ctx) {
      reviewBtn.setBusy(true);
      reviewBtn.update({ disabled: true });
      banner.clear();
      const clientRequestId = `swap_ui_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      try {
        const review = await bridge.send('dex.prepareSwap', {
          quoteId: ctx.quote.quoteId,
          clientRequestId,
        });
        if (!review?.intentId || !review?.bindingHash) {
          banner.set('The review came back without a binding. Prepare again.', 'warning');
          return;
        }
        const prefs = await bridge.send('settings.get').catch(() => null);
        const doSubmit = (extra = {}) => bridge.send('intent.submit', {
          intentId: review.intentId,
          bindingHash: review.bindingHash,
          acknowledgements: ['swap-price-moves'],
          ...(extra.password ? { password: extra.password } : {}),
        });
        const result = prefs?.requirePasswordForSigning === false
          ? await doSubmit()
          : await requirePassword({
            title: 'Confirm swap',
            body: review.reviewAscii || 'Re-enter your password to sign and broadcast this swap.',
            confirmLabel: 'Sign & swap',
            verify: (password) => doSubmit({ password }),
          });
        if (!result) return;
        await renderSubmitted(review, result);
      } catch (error) {
        banner.set(friendlyReason(error));
        if (error?.code === 'QUOTE_EXPIRED') quoteBox.classList.add('hidden');
      } finally {
        if (!destroyed) {
          reviewBtn.setBusy(false);
          syncEnabled();
        }
      }
    }

    async function renderSubmitted(review, submitted) {
      clearBody();
      header.setTitle('Swap submitted');
      body.appendChild(h('div', { class: 'notice' }, [
        icon('check', 16),
        h('span', { text: 'Intent broadcast to the chain. Waiting for settlement.' }),
      ]));
      if (submitted?.signature) {
        body.appendChild(h('div', { class: 'detail-table' }, [
          h('div', { class: 'detail-row' }, [
            h('span', { class: 'eyebrow', text: 'Signature' }),
            h('div', { class: 'detail-val mono', text: submitted.signature, style: { wordBreak: 'break-all' } }),
          ]),
        ]));
      }
      const pollLine = h('p', { class: 'hint', text: 'Polling for the on-chain outcome…' });
      body.appendChild(pollLine);

      const doneBtn = track(Button({
        label: 'Done',
        kind: 'primary',
        wide: true,
        disabled: true,
        onClick: () => navigate('/dashboard'),
      }));
      body.appendChild(h('div', { class: 'screen-actions' }, [doneBtn.el]));

      // Blocks land in a few ms (owner, 2026-10-26), so poll tightly with a bounded ceiling.
      const poolId = review?.facts?.poolId;
      for (let i = 0; i < 12 && !destroyed; i += 1) {
        await new Promise((r) => setTimeout(r, 750));
        const cur = await bridge.send('intent.get', { intentId: review.intentId }).catch(() => null);
        const status = cur && (cur.status || (cur.intent && cur.intent.status));
        if (status === 'settled') {
          pollLine.textContent = 'Settled on-chain.';
          banner.set('Swap settled.', 'info');
          break;
        }
        if (status === 'failed' || status === 'rejected' || status === 'expired') {
          pollLine.textContent = `Intent ended: ${status}.`;
          banner.set(`Swap did not settle (${status}). Check Activity for the final record.`, 'warning');
          break;
        }
        if (i === 11) pollLine.textContent = 'Still settling — check Activity for the outcome.';
      }
      if (poolId) {
        // Nothing extra: Activity is the ledger of record.
      }
      if (!destroyed) doneBtn.update({ disabled: false });
    }
  }

  load();
  return {
    el,
    destroy() {
      destroyed = true;
      for (const c of owned) c.destroy?.();
      owned.length = 0;
      header.destroy();
      banner.destroy();
      d.dispose();
    },
  };
}
