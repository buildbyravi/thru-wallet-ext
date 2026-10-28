// Domain route — ENS-style name screen on /name (rebuilt 2026-10-24, owner-directed).
//
// Availability is checked in the background (debounced; typing never blocks):
//   supported `.thru` registrar → one registration path, selected from live registrar facts.
//   no supported `.thru` registrar → explain the network limitation; `.id` is resolution-only.
// The official paid registry is used when it is the only live `.thru` route; the deployed
// custom registrar is preferred when present. No root-authority `.id` mint is offered here.
//
// Writes use the current name.* handlers and wallet signing/auth boundary. They bind the
// selected account/network and surface only the confirmation evidence returned by the chain.
import { h, disposer } from '../../kit/dom.js';
import { icon } from '../../kit/icon.js';
import { PageHeader, Banner } from '../../kit/feedback.js';
import { Field } from '../../kit/field.js';
import { Sheet } from '../../kit/sheet.js';
import { toast } from '../../kit/toast.js';
import { TxReviewCard } from '../../domain/tx-review/review-card.js';
import {
  submitReviewedReview, classifyReviewError, discardReview,
} from '../../domain/tx-review/confirm.js';
import * as bridge from '../bridge.js';
import { formatTokenAmount } from '../../../shared/format.js';
import { NATIVE_TOKEN } from '../../../shared/tokens.js';
import { availableThruProviders } from './name-providers.js';

function truncateMiddle(value, chars = 10) {
  const s = String(value ?? '');
  return s.length <= chars * 2 + 2 ? s : `${s.slice(0, chars)}…${s.slice(-chars)}`;
}

function formatVerifiedAt(ms) {
  if (!ms) return 'unknown';
  try {
    return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return 'unknown';
  }
}

// Lease times are u64 "chain time". Localize only when they plausibly read as unix
// seconds, and label the unit either way — never silently reinterpret an unknown clock.
function formatChainTime(u64String) {
  try {
    const seconds = BigInt(u64String);
    if (seconds >= 1_500_000_000n && seconds < 10_000_000_000n) {
      const text = new Date(Number(seconds) * 1000)
        .toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
      return text;
    }
    return `${seconds} (chain time, seconds)`;
  } catch {
    return String(u64String ?? '');
  }
}

export function NameRoute({ back }) {
  const d = disposer();
  let bodyDisposer = disposer();
  const owned = [];
  let account = null;
  let network = null;
  let primary = null;
  let loadSeq = 0;
  let activeTab = 'register';
  let draft = { name: '', years: 1, quote: null };
  let reviewSheet = null;
  let submissionInFlight = false;
  const mutationControls = new Set();
  const transactionControls = new Set();
  const providerReads = new Map();
  const mintReads = new Map();
  let destroyed = false;
  const abortController = new AbortController();

  function track(c) {
    if (c) owned.push(c);
    return c;
  }

  function setListMutationLocked(locked = submissionInFlight) {
    for (const control of mutationControls) control.disabled = locked;
  }

  function readProviderFacts(networkId) {
    const key = networkId || 'unknown-network';
    if (!providerReads.has(key)) {
      const promise = Promise.allSettled([
        bridge.send('name.getRegistry'),
        bridge.send('name.getCustomRegistrar'),
      ]);
      providerReads.set(key, promise);
      // Do not pin failed reads: a user may retry after the node comes back.
      promise.then((results) => {
        if (providerReads.get(key) === promise && results.some((result) => result.status === 'rejected')) providerReads.delete(key);
      });
    }
    return providerReads.get(key);
  }

  function readMintInfo(networkId, mintAddress) {
    const key = `${networkId || 'unknown-network'}:${mintAddress}`;
    if (!mintReads.has(key)) {
      const promise = bridge.send('token.readMint', { mintAddress }).catch(() => null);
      mintReads.set(key, promise);
      promise.then((info) => { if (mintReads.get(key) === promise && !info) mintReads.delete(key); });
    }
    return mintReads.get(key);
  }

  const banner = Banner({ tone: 'error' });
  // Hard rule 15 (2026-10-26): shell paints with its eyebrow + a checking card; the
  // reads that fill it in (network, account, chain offerings) all arrive in parallel.
  const body = h('div', { class: 'stack stack-4' }, [
    h('div', { class: 'eyebrow', text: 'Network: —' }),
    h('div', { class: 'stack stack-2' }, [
      h('div', { class: 'eyebrow', text: 'Name' }),
      h('div', { class: 'hint', text: 'Checking .thru registration…' }),
    ]),
  ]);
  const header = PageHeader({ title: 'Domain', onBack: () => back() });
  const el = h('section', { class: 'screen' }, [header.el, banner.el, body]);

  function clearBody() {
    reviewSheet?.destroy();
    reviewSheet = null;
    bodyDisposer.dispose();
    bodyDisposer = disposer();
    mutationControls.clear();
    transactionControls.clear();
    for (const c of owned) c.destroy?.();
    owned.length = 0;
    while (body.firstChild) body.removeChild(body.firstChild);
  }

  function networkEyebrow() {
    return h('div', { class: 'eyebrow', text: `Network: ${network?.label || network?.id || 'loading…'}` });
  }

  // --------------------------------------------------------------------------
  function renderDomains(host) {
    const ctx = { expectedNetworkId: network?.id, expectedAccountAddress: account?.address };
    let rows = disposer();
    let alive = true;
    let seq = 0;
    let snapshot = null;
    let busy = false;
    bodyDisposer.add(() => { alive = false; seq++; rows.dispose(); });
    const current = () => alive && !destroyed && host.isConnected;
    const list = h('div', { class: 'stack stack-3 name-domain-list' });
    const status = h('div', { class: 'hint', role: 'status', text: 'Loading saved domains…' });
    const refresh = h('button', { type: 'button', class: 'btn text', text: 'Refresh ownership' });
    const input = track(Field({ label: 'Import domain', placeholder: 'yourname.thru',
      autocomplete: 'off', maxLength: 69, hint: 'Add a .thru domain you own.' }));
    const add = h('button', { type: 'button', class: 'btn secondary', text: 'Import domain' });
    host.appendChild(h('p', { class: 'hint', text: 'Domains saved in this wallet. Import names registered elsewhere.' }));
    host.appendChild(list);
    host.appendChild(status);
    host.appendChild(refresh);
    host.appendChild(h('div', { class: 'name-entry stack stack-2' }, [input.el, add]));
    add.disabled = refresh.disabled = !ctx.expectedNetworkId || !ctx.expectedAccountAddress;

    function paint() {
      rows.dispose();
      rows = disposer();
      while (list.firstChild) list.removeChild(list.firstChild);
      if (!snapshot) return;
      primary = snapshot.items.find(item => item.isPrimary) ?? null;
      if (!snapshot.items.length) {
        list.appendChild(h('div', { class: 'name-empty stack stack-2' }, [
          h('div', { class: 'row-title', text: 'No tracked domains yet' }),
          h('div', { class: 'hint', text: 'Register a name or import one you already own.' }),
        ]));
      }
      for (const item of snapshot.items) {
        const verified = !item.stale && item.status === 'owned';
        const label = item.rootName ? `${item.name}.${item.rootName}` : item.name;
        const stateLabel = item.stale ? 'Ownership not verified'
          : item.status === 'owned' ? 'Verified ownership'
            : item.status === 'not-owned' ? 'No longer owned by this account' : 'Not found on this network';
        const select = h('button', { type: 'button', class: 'btn secondary', text: item.isPrimary ? 'Unlink' : 'Make primary',
          disabled: busy || (!item.isPrimary && !verified) });
        const renew = h('button', { type: 'button', class: 'btn secondary', text: 'Renew', disabled: busy || !verified || item.rootName !== 'thru' });
        const remove = h('button', { type: 'button', class: 'btn secondary', text: 'Remove', disabled: busy || item.isPrimary });
        const card = h('div', { class: 'name-entry stack stack-2' }, [
          h('div', { class: 'row-flex name-domain-heading' }, [
            icon('globe', 16), h('span', { class: 'row-title name-domain-title', text: label }),
            item.isPrimary ? h('span', { class: 'tag-native', text: 'Primary' }) : null,
          ]),
          h('div', { class: `hint${verified ? ' name-status-ok' : ''}`, text: stateLabel }),
          item.verifiedAt ? h('div', { class: 'hint', text: `Last verified ${formatVerifiedAt(item.verifiedAt)}` }) : null,
          h('div', { class: 'name-domain-actions' }, [select, renew, remove]),
        ]);
        list.appendChild(card);
        rows.on(select, 'click', () => {
          if (select.disabled) return;
          void action(item.isPrimary ? 'name.unlinkPrimary' : 'name.setPrimaryDomain', { domainAddress: item.domainAddress });
        });
        rows.on(remove, 'click', () => {
          if (!remove.disabled) void action('name.untrackDomain', { domainAddress: item.domainAddress });
        });
        rows.on(renew, 'click', () => {
          if (renew.disabled) return;
          draft = { name: item.name, rootAddress: item.rootAddress, years: 1, quote: null };
          activeTab = 'register';
          render();
        });
      }
    }

    async function refreshList() {
      if (!current() || !ctx.expectedNetworkId || !ctx.expectedAccountAddress) return;
      const attempt = ++seq;
      let liveArrived = false;
      status.textContent = 'Checking ownership…';
      if (snapshot) {
        snapshot = { ...snapshot, items: snapshot.items.map(item => ({ ...item, stale: true })) };
        paint();
      }
      const accept = result => result?.networkId === ctx.expectedNetworkId
        && result?.accountAddress === ctx.expectedAccountAddress && Array.isArray(result.items);
      void bridge.send('name.getCachedDomains', ctx).then(result => {
        if (!current() || attempt !== seq || liveArrived || !accept(result)) return;
        snapshot = result;
        paint();
      }).catch(() => {});
      try {
        const result = await bridge.send('name.listDomains', ctx);
        if (!current() || attempt !== seq || !accept(result)) return;
        liveArrived = true;
        snapshot = result;
        paint();
        status.textContent = result.items.some(item => item.stale) ? 'Some ownership checks are unavailable. Refresh to try again.' : '';
      } catch (err) {
        if (!current() || attempt !== seq) return;
        status.textContent = err?.code === 'DOMAIN_CONTEXT_CHANGED'
          ? 'Account or network changed. Reopen this screen.' : 'Ownership check unavailable. Saved domains are shown when available.';
      }
    }

    async function action(method, params) {
      if (busy || !current()) return;
      busy = true;
      add.disabled = refresh.disabled = true;
      input.control.disabled = true;
      paint();
      banner.set('');
      try {
        await bridge.send(method, { ...params, ...ctx });
        if (!current()) return;
        if (method === 'name.trackDomain') input.value = '';
        toast(method === 'name.trackDomain' ? 'Domain imported' : method === 'name.untrackDomain' ? 'Removed from this wallet' : 'Primary name updated');
        await refreshList();
      } catch (err) {
        if (current()) banner.set(err?.message || 'Could not update this domain.');
      } finally {
        if (current()) {
          busy = false;
          add.disabled = refresh.disabled = false;
          input.control.disabled = false;
          paint();
        }
      }
    }
    bodyDisposer.on(refresh, 'click', () => { if (!busy) void refreshList(); });
    bodyDisposer.on(add, 'click', () => {
      if (add.disabled || busy) return;
      if (!input.value.trim()) { input.setError('Enter a domain name.'); return; }
      input.setError('');
      void action('name.trackDomain', { name: input.value });
    });
    bodyDisposer.on(input.control, 'keydown', event => { if (event.key === 'Enter') add.click(); });
    void refreshList();
  }

  // --------------------------------------------------------------------------
  // THE search card — the whole product typed into one field, ENS-style.
  async function renderSearchCard(host, entry = draft, renewOnly = false) {
    const card = h('div', { class: 'name-entry stack stack-2' });
    const signingAbort = new AbortController();
    bodyDisposer.add(() => signingAbort.abort());
    host.appendChild(card);

    // Hard rule 15 (2026-10-26): the whole card — search field, stepper, price, CTA —
    // paints immediately against provider-neutral text while the two `.thru` registrar
    // reads run in parallel below. `.id` roots are not queried for minting.
    // A slow network never leaves a naked Loading card: it sees the shell and the status
    // line honestly says the offering is still being checked.
    const readsPromise = readProviderFacts(network?.id);

    // -- pieces -------------------------------------------------------------------
    // Paint the whole card BEFORE registrar reads resolve; never show a blocking spinner.
    const statusLine = h('div', { class: 'name-status hint', role: 'status', 'aria-live': 'polite', text: 'Checking .thru registration…' });
    const searchField = track(Field({
      label: 'Name',
      placeholder: 'Search yourname.thru',
      autocomplete: 'off',
      maxLength: 64,
      hint: 'Enter a name without .thru.',
    }));
    searchField.value = entry.name;
    mutationControls.add(searchField.control);
    searchField.control.disabled = submissionInFlight;
    // The card is interactive before provider reads settle. Persist typing immediately so
    // adding/removing a sibling while the chain is slow cannot erase this entry's draft.
    bodyDisposer.on(searchField.control, 'input', () => {
      const draft = searchField.value?.trim?.() ?? '';
      if (draft !== entry.name) entry.completed = false;
      entry.name = draft;
    });
    const nameRuleHint = searchField.el.querySelector('.hint');
    const cardInner = h('div', { class: 'stack stack-3' }, [searchField.el, statusLine]);
    card.appendChild(cardInner);

    // The rest of this flow's computation happens against settled reads, so hydrate now.
    const [registryRes, customRes] = await readsPromise;
    if (destroyed || !card.isConnected) return;

    const registry = registryRes.status === 'fulfilled'
      ? registryRes.value
      : { supported: false, reason: registryRes.reason?.message || 'registry read failed' };
    const registryUp = Boolean(registry?.supported && registry?.registry
      && String(registry.registry.rootName || '').toLowerCase() === 'thru');

    const custom = customRes.status === 'fulfilled'
      ? customRes.value
      : { supported: false, reason: customRes.reason?.message || 'custom registrar read failed' };
    const customUp = Boolean(custom?.supported && custom.rootMatchesNameService
      && String(custom.rootName || '').toLowerCase() === 'thru');
    const providers = availableThruProviders({
      registry: registryUp ? registry : null,
      custom: customUp ? custom : null,
    });
    const providerRoots = {
      registry: registryUp ? registry.registry.rootRegistrar : null,
      custom: customUp ? custom.root : null,
    };
    const requestedProvider = entry.provider || (providers.includes('custom') ? 'custom' : providers[0] ?? null);
    const preferredProvider = providers.includes(requestedProvider) ? requestedProvider : (providers[0] ?? null);
    const pinnedProvider = entry.rootAddress
      ? (providerRoots[requestedProvider] === entry.rootAddress
        ? requestedProvider
        : providers.find((kind) => providerRoots[kind] === entry.rootAddress) ?? null)
      : null;
    const provider = entry.rootAddress ? pinnedProvider : preferredProvider;
    const rootUnsupported = Boolean(entry.rootAddress && !pinnedProvider);
    const tld = provider ? 'thru' : null;

    if (renewOnly && !provider) {
      statusLine.textContent = 'Renewal is unavailable for this domain on the selected network.';
      cardInner.appendChild(h('button', { type: 'button', class: 'btn primary', text: 'Renewal unavailable', disabled: true }));
      return;
    }

    let decimals = null;
    let symbol = null;
    if (provider === 'registry') {
      const mintInfo = await readMintInfo(network?.id, registry.registry.tokenMint);
      if (destroyed || !card.isConnected) return;
      const dd = Number(mintInfo?.decimals);
      if (Number.isInteger(dd) && dd >= 0 && dd <= 18) decimals = dd;
      if (mintInfo?.ticker?.trim?.()) symbol = mintInfo.ticker.trim();
    }
    const fmt = (raw) => (decimals == null
      ? `${raw} base units of payment mint ${truncateMiddle(registry?.registry?.tokenMint || '', 6)}`
      : `${formatTokenAmount(String(raw), decimals)} ${symbol || `payment mint ${truncateMiddle(registry.registry.tokenMint, 6)}`}`);

    // The mint suffix is fixed; chain facts decide only whether a `.thru` registrar exists.
    if (provider) searchField.control.placeholder = 'Search yourname.thru';
    const updateNameRuleHint = () => {
      if (!nameRuleHint) return;
      nameRuleHint.textContent = provider === 'registry'
        ? '1–64 characters. Use English letters, numbers or symbols; no spaces or dots.'
        : provider === 'custom'
          ? '3–32 lowercase letters, numbers or hyphens. Start and end with a letter or number.'
          : 'Enter a name without .thru.';
    };
    updateNameRuleHint();
    statusLine.textContent = provider ? '' : '.thru registration is unavailable on this network.';

    const minusBtn = h('button', { type: 'button', class: 'btn secondary name-step-btn', text: '-', 'aria-label': 'Decrease registration period' });
    const yearsLabel = h('span', { class: 'name-years mono', text: '1 year' });
    const plusBtn = h('button', { type: 'button', class: 'btn secondary name-step-btn', text: '+', 'aria-label': 'Increase registration period' });
    mutationControls.add(minusBtn);
    mutationControls.add(plusBtn);
    minusBtn.disabled = submissionInFlight;
    plusBtn.disabled = submissionInFlight;
    const yearsStepper = h('div', { class: 'name-stepper row-flex hidden' }, [
      h('span', { class: 'hint', text: renewOnly ? 'Renewal period' : 'Registration period' }),
      h('div', { class: 'row-flex' }, [minusBtn, yearsLabel, plusBtn]),
    ]);

    const priceLine = h('div', { class: 'name-price hint hidden' });
    const balanceLine = h('div', { class: 'name-balance hint hidden' });
    const ctaBtn = h('button', { type: 'button', class: 'btn primary hidden' }, [h('span', { text: 'Review registration' })]);
    const ctaLabel = () => ctaBtn.querySelector('span');
    const linkBtn = h('button', { type: 'button', class: 'btn secondary hidden' }, [h('span', { text: 'Set as primary' })]);
    transactionControls.add(ctaBtn);
    mutationControls.add(linkBtn);

    let years = Math.min(10, Math.max(1, Number(entry.years) || 1));
    // kind: 'available'|'taken'|'mine'|'claimable' (official registry) or the
    // corresponding custom-registrar states.
    let leaseState = null;
    let payment = null;     // name.getPaymentBalance read (refreshing with each check)
    let nativeBalance = null; // current THRU balance for the custom registrar quote
    let checkSeq = 0;
    let checkTimer = null;
    bodyDisposer.add(() => { clearTimeout(checkTimer); checkSeq++; });
    yearsLabel.textContent = years === 1 ? '1 year' : `${years} years`;

    function pricePerYear() { return BigInt(registry.registry.pricePerYear); }
    function baseCost() { return pricePerYear() * BigInt(years); }
    // Custom registrar fee: native base units, read from the on-chain config (raw BigInt).
    function customPricePerYear() { return BigInt(custom.feePerYear); }
    function customBaseCost() { return customPricePerYear() * BigInt(years); }

    function setYears(delta) {
      years = Math.min(10, Math.max(1, years + delta));
      entry.years = years;
      yearsLabel.textContent = years === 1 ? '1 year' : `${years} years`;
      armForState(leaseState);
    }
    bodyDisposer.on(minusBtn, 'click', () => setYears(-1));
    bodyDisposer.on(plusBtn, 'click', () => setYears(+1));

    function hideActions() {
      yearsStepper.classList.add('hidden');
      priceLine.classList.add('hidden');
      balanceLine.classList.add('hidden');
      ctaBtn.classList.add('hidden');
      linkBtn.classList.add('hidden');
      reviewSheet?.close();
      ctaBtn.disabled = false;
      entry.quote = null;
    }

    function setStatus(markup, tone) {
      statusLine.textContent = markup;
      statusLine.className = `name-status hint ${tone ? `name-status-${tone}` : ''}`.trim();
    }

    // Arm price/action affordances for the current leaseState (also re-run on year change).
    function armForState(state) {
      if (!state) return;
      hideActions();
      if (entry.completed || entry.outcomeUnknown) return;
      if (renewOnly && state.kind !== 'mine' && state.kind !== 'custom-mine') return;
      // Configured price is a quote, not evidence of the amount ultimately charged.
      if (state.kind === 'custom-available') {
        yearsStepper.classList.remove('hidden');
        const cost = customBaseCost();
        entry.quote = { assetId: `${network?.id || 'active'}:${NATIVE_TOKEN.symbol}`, ticker: NATIVE_TOKEN.symbol, decimals: NATIVE_TOKEN.decimals, raw: cost };
        priceLine.classList.remove('hidden');
        priceLine.textContent = `Registration quote: ${formatTokenAmount(cost, NATIVE_TOKEN.decimals)} ${NATIVE_TOKEN.symbol}`;
        balanceLine.classList.remove('hidden');
        if (nativeBalance?.exists && nativeBalance.balance != null) {
          const have = BigInt(nativeBalance.balance);
          const staleTag = nativeBalance.stale ? ' (cached)' : '';
          balanceLine.textContent = `Balance: ${formatTokenAmount(have, NATIVE_TOKEN.decimals)} ${NATIVE_TOKEN.symbol}${staleTag}${have < cost ? ' · Insufficient balance' : ''}`;
          ctaBtn.disabled = have < cost;
        } else if (nativeBalance && !nativeBalance.exists && !nativeBalance.stale) {
          balanceLine.textContent = 'This account needs activation before registration.';
          ctaBtn.disabled = true;
        } else if (nativeBalance === null) {
          balanceLine.textContent = 'Checking balance…';
          ctaBtn.disabled = true;
        } else {
          balanceLine.textContent = 'Balance unavailable. Refresh to try again.';
          ctaBtn.disabled = true;
        }
        ctaBtn.classList.remove('hidden');
        ctaLabel().textContent = 'Review registration';
        return;
      }
      if (state.kind === 'custom-mine') {
        yearsStepper.classList.remove('hidden');
        const cost = BigInt(custom.feePerYear || '1000') * BigInt(entry.years || 1);
        entry.quote = { assetId: `${network?.id || 'active'}:${NATIVE_TOKEN.symbol}`, ticker: NATIVE_TOKEN.symbol, decimals: NATIVE_TOKEN.decimals, raw: cost };
        priceLine.classList.remove('hidden');
        priceLine.textContent = `Renewal quote: ${formatTokenAmount(cost, NATIVE_TOKEN.decimals)} ${NATIVE_TOKEN.symbol}`;
        balanceLine.classList.remove('hidden');
        if (nativeBalance?.exists && nativeBalance.balance != null) {
          const have = BigInt(nativeBalance.balance);
          const staleTag = nativeBalance.stale ? ' (cached)' : '';
          balanceLine.textContent = `Balance: ${formatTokenAmount(have, NATIVE_TOKEN.decimals)} ${NATIVE_TOKEN.symbol}${staleTag}${have < cost ? ' · Insufficient balance' : ''}`;
          ctaBtn.disabled = have < cost;
        } else if (nativeBalance && !nativeBalance.exists && !nativeBalance.stale) {
          balanceLine.textContent = 'This account needs activation before renewal.';
          ctaBtn.disabled = true;
        } else if (nativeBalance === null) {
          balanceLine.textContent = 'Checking balance…';
          ctaBtn.disabled = true;
        } else {
          balanceLine.textContent = 'Balance unavailable. Refresh to try again.';
          ctaBtn.disabled = true;
        }
        ctaBtn.classList.remove('hidden');
        ctaLabel().textContent = 'Review renewal';
        if (!(primary?.name === state.name)) linkBtn.classList.remove('hidden');
        return;
      }
      const purchasable = state.kind === 'available' || state.kind === 'claimable';
      const renewable = state.kind === 'mine';
      if (!purchasable && !renewable) return;
      if (!registryUp) return; // nothing to sell here — status line already said so

      yearsStepper.classList.remove('hidden');
      priceLine.classList.remove('hidden');
      if (decimals == null) {
        priceLine.textContent = 'Price unavailable. Refresh to try again.';
        return;
      }
      const cost = fmt(String(baseCost()));
      entry.quote = { assetId: registry.registry.tokenMint, ticker: symbol || `payment mint ${truncateMiddle(registry.registry.tokenMint, 6)}`, decimals, raw: baseCost() };
      priceLine.textContent = `${renewable ? 'Renewal' : 'Registration'} quote: ${cost}`;
      if (payment?.exists && payment.amount != null) {
        balanceLine.classList.remove('hidden');
        const bal = BigInt(payment.amount);
        balanceLine.textContent = `Balance: ${fmt(String(bal))}${bal < baseCost() ? ' · Insufficient balance' : ''}`;
        ctaBtn.disabled = bal < baseCost();
      } else {
        balanceLine.classList.remove('hidden');
        balanceLine.textContent = payment?.supported
          ? 'Add the payment token to this account to continue.'
          : 'Balance unavailable. Refresh to try again.';
        ctaBtn.disabled = true;
      }
      ctaBtn.classList.remove('hidden');
      ctaLabel().textContent = state.kind === 'mine'
        ? 'Review renewal'
        : state.kind === 'claimable'
          ? 'Review claim'
          : 'Review registration';
      if (state.kind === 'mine' && !(primary?.name === state.name)) {
        linkBtn.classList.remove('hidden');
      }
    }

    async function fetchNativeBalance(mySeq) {
      let addr = account?.address;
      if (!addr) {
        const acc = await bridge.send('account.getActive').catch(() => null);
        if (acc?.address) {
          account = acc;
          addr = acc.address;
        }
      }
      if (!addr) return null;
      try {
        const cached = await bridge.send('tx.getCachedBalances', { addresses: [addr] }).catch(() => null);
        if (cached?.[addr] && cached[addr].balance != null) {
          nativeBalance = cached[addr];
          if (leaseState) armForState(leaseState);
        }
      } catch { /* best effort */ }
      try {
        const balances = await bridge.send('tx.getBalances', { addresses: [addr] }).catch(() => null);
        if (destroyed || !statusLine.isConnected || mySeq !== checkSeq) return null;
        if (balances?.[addr] && balances[addr].balance != null) {
          nativeBalance = balances[addr];
          if (leaseState) armForState(leaseState);
        } else if (!nativeBalance) {
          const info = await bridge.send('tx.getAccountInfo', { address: addr }).catch(() => null);
          if (destroyed || !statusLine.isConnected || mySeq !== checkSeq) return null;
          if (info && info.exists != null) {
            nativeBalance = { balance: String(info.balance ?? '0'), exists: Boolean(info.exists), stale: false };
            if (leaseState) armForState(leaseState);
          }
        }
      } catch { /* best effort */ }
      return nativeBalance;
    }

    // Custom registrar mode (v25): lease PDA + domain existence, fee from on-chain config.
    async function customCheck(name) {
      const mySeq = ++checkSeq;
      setStatus('Checking availability…', '');
      try {
        const res = await bridge.send('name.checkCustomLease', { name });
        if (destroyed || !statusLine.isConnected || mySeq !== checkSeq) return; // stale
        if (!res?.supported) throw new Error(res?.reason || 'custom registrar reads unsupported on this network');
        if (res.labelProblem) {
          leaseState = null;
          hideActions();
          setStatus('Use 3–32 lowercase letters, numbers or hyphens, with no hyphen at either end.', 'bad');
          return;
        }
        if (res.readError) throw new Error(res.readError);
        if (res.leaseExists && res.leaseParseError) {
          leaseState = null;
          hideActions();
          setStatus('Availability unavailable. Refresh to try again.', 'warn');
          return;
        }
        if (res.leaseExists) {
          const mine = Boolean(res.lease?.owner && account?.address && res.lease.owner === account.address);
          if (mine) {
            leaseState = { kind: 'custom-mine', name, lease: res.lease, rootAddress: res.root };
            setStatus(`Owned by you · Expires ${formatChainTime(res.lease.expiresAtSeconds)}`, 'ok');
            armForState(leaseState);
            await fetchNativeBalance(mySeq);
            if (destroyed || !statusLine.isConnected || mySeq !== checkSeq) return;
            armForState(leaseState);
            return;
          } else if (res.expiredHint) {
            leaseState = null;
            hideActions();
            setStatus('Expired registration. Reclaiming this domain is not supported yet.', 'warn');
          } else {
            leaseState = { kind: 'custom-taken', name, lease: res.lease };
            hideActions();
            setStatus('Already registered', 'bad');
          }
        } else if (res.domainExists) {
          leaseState = { kind: 'custom-taken', name };
          hideActions();
          setStatus('Already registered', 'bad');
        } else {
          nativeBalance = null;
          leaseState = { kind: 'custom-available', name, rootAddress: res.root };
          setStatus('Available', 'ok');
          armForState(leaseState);
          await fetchNativeBalance(mySeq);
          if (destroyed || !statusLine.isConnected || mySeq !== checkSeq) return;
          armForState(leaseState);
          return;
        }
        armForState(leaseState);
      } catch (err) {
        if (destroyed || !statusLine.isConnected || mySeq !== checkSeq) return;
        leaseState = null;
        hideActions();
        setStatus('Availability unavailable. Refresh to try again.', 'warn');
      }
    }

    async function backgroundCheck(name) {
      if (rootUnsupported) {
        hideActions();
        setStatus('This domain does not support registration or renewal here.', 'warn');
        return;
      }
      if (!provider) {
        hideActions();
        setStatus('.thru registration is unavailable on this network.', 'warn');
        return;
      }
      if (provider === 'custom') return customCheck(name);
      const mySeq = ++checkSeq;
      setStatus('Checking availability…', '');
      try {
        const res = await bridge.send('name.checkLease', { name });
        if (destroyed || !statusLine.isConnected || mySeq !== checkSeq) return; // stale
        if (!res?.supported) throw new Error(res?.reason || 'registry reads unsupported on this network');
        if (registryUp) {
          payment = await bridge.send('name.getPaymentBalance').catch(() => null);
          if (destroyed || !statusLine.isConnected || mySeq !== checkSeq) return;
        }

        if (res.leaseParseError || (res.leaseExists && !res.lease)) {
          leaseState = null;
          hideActions();
          setStatus('Availability unavailable. Refresh to try again.', 'warn');
          return;
        }

        const mine = Boolean(res.lease && account?.address && res.lease.owner === account.address);
        if (mine) {
          leaseState = { kind: 'mine', name, lease: res.lease };
          setStatus(`Owned by you · Expires ${formatChainTime(res.lease.endTime)}`, 'ok');
        } else if (res.lease && res.lease.expiredHint === false) {
          leaseState = { kind: 'taken', name, lease: res.lease };
          setStatus(renewOnly ? 'Only the current owner can renew this domain.' : 'Already registered', 'bad');
        } else if (res.lease) {
          leaseState = { kind: 'claimable', name, lease: res.lease };
          setStatus(renewOnly ? 'This domain cannot be renewed by this account.' : 'Available to claim · Previous registration expired', renewOnly ? 'warn' : 'ok');
        } else if (res.domainExists) {
          leaseState = null;
          hideActions();
          setStatus(renewOnly ? 'This domain has no renewable lease with this registrar.' : 'Already registered', 'bad');
        } else {
          leaseState = { kind: 'available', name };
          setStatus(renewOnly ? 'No registration to renew. Search this name under Register.' : 'Available', renewOnly ? 'warn' : 'ok');
        }
        armForState(leaseState);
      } catch (err) {
        if (destroyed || !statusLine.isConnected || mySeq !== checkSeq) return;
        leaseState = null;
        hideActions();
        setStatus('Availability unavailable. Refresh to try again.', 'warn');
      }
    }

    function currentTld() {
      return provider === 'registry' ? registry.registry.rootName
        : provider === 'custom' ? custom.rootName
          : tld;
    }

    const queueCheck = () => {
      const name = searchField.value?.trim?.() ?? '';
      if (name !== entry.name) entry.completed = false;
      entry.outcomeUnknown = false;
      entry.recheckRequired = false;
      entry.name = name;
      clearTimeout(checkTimer);
      // Invalidate an older request immediately, including the debounce window.
      checkSeq++;
      leaseState = null;
      hideActions();
      if (name.length === 0) { setStatus('', ''); return; }
      if (name.length > 64 || name.includes('.')) {
        setStatus(name.length > 64 ? 'Use no more than 64 characters.' : 'Enter a name without .thru or dots.', 'bad');
        return;
      }
      if (provider === 'custom' && name !== name.toLowerCase()) {
        setStatus('Use lowercase letters, numbers and hyphens.', 'bad');
        return;
      }
      if (provider === 'registry' && !name.split('').every((ch) => ch.charCodeAt(0) >= 33 && ch.charCodeAt(0) <= 126)) {
        setStatus('Use English letters, numbers or symbols, without spaces.', 'bad');
        return;
      }
      setStatus('', '');
      checkTimer = setTimeout(() => { void backgroundCheck(name); }, 450);
    };
    bodyDisposer.on(searchField.control, 'input', queueCheck);
    bodyDisposer.on(searchField.control, 'keydown', (e) => {
      if (e.key === 'Enter' && leaseState && !ctaBtn.classList.contains('hidden')) ctaBtn.click();
    });

    bodyDisposer.on(ctaBtn, 'click', () => {
      if (destroyed || submissionInFlight || ctaBtn.disabled || reviewSheet) return;
      banner.set('');
      if (entry.recheckRequired) {
        entry.recheckRequired = false;
        entry.outcomeUnknown = false;
        ctaBtn.disabled = true;
        queueCheck();
        return;
      }
      if (!leaseState || !entry.quote || !account?.address || !network?.id) return;
      const state = leaseState;
      const customRegister = state.kind === 'custom-available';
      const customRenew = state.kind === 'custom-mine';
      const isCustom = customRegister || customRenew;
      if (!isCustom && !registryUp) return;

      // The SAME review pipeline the Send route uses. The domain decoders decide what the
      // sheet renders; this route only chooses the operation kind.
      const kind = customRegister ? 'domain-register'
        : (state.kind === 'mine' || customRenew) ? 'domain-renew'
          : state.kind === 'claimable' ? 'domain-claim' : 'domain-purchase';
      const title = (kind === 'domain-renew' || customRenew) ? 'Confirm renewal'
        : kind === 'domain-claim' ? 'Confirm expired claim'
          : kind === 'domain-purchase' ? 'Confirm purchase' : 'Confirm registration';
      const reviewedYears = years;
      const params = { name: state.name, years: reviewedYears, ...(isCustom ? { via: 'custom' } : {}) };

      void (async () => {
        setStatus('Preparing review…', '');
        let prepared;
        try {
          prepared = await bridge.send('tx.prepareReview', { kind, params });
        } catch (error) {
          if (destroyed || !card.isConnected) return;
          setStatus('', '');
          banner.set(error?.message || 'The review could not be prepared.');
          return;
        }
        if (destroyed || !card.isConnected) return;
        setStatus('', '');
        if (!prepared?.supported) {
          banner.set('This wallet has no decoder for that transaction, so it cannot be signed.');
          return;
        }

        const sheet = Sheet({ label: title, className: 'name-confirm-sheet', onClose: () => {
          if (reviewSheet === sheet) reviewSheet = null;
        } });
        reviewSheet = sheet;

        // The card fires onChange from its own constructor, so the button it gates must
        // exist first. Every confirmability decision stays inside the card: this route never
        // re-derives validation from the review envelope itself.
        let confirm = null;
        const reviewCard = sheet.track(TxReviewCard({
          review: prepared.review,
          onChange: ({ canConfirm }) => confirm?.el && (confirm.el.disabled = !canConfirm),
        }));
        sheet.card.appendChild(reviewCard.el);

        const cancel = sheet.track({
          el: h('button', { type: 'button', class: 'btn secondary', text: 'Cancel' }),
          destroy: () => {},
        });
        confirm = sheet.track({
          el: h('button', {
            type: 'button',
            class: 'btn primary',
            text: prepared.review.operation.confirmLabel || 'Confirm and sign',
            disabled: !reviewCard.canConfirm(),
          }),
          destroy: () => {},
        });
<<<<<<< HEAD
        sheet.d.on(reviewCard.el, 'change', () => {
          confirm.el.disabled = !reviewCard.canConfirm();
        });
=======
>>>>>>> origin/arena/0439c226-thru-wallet-ext

        sheet.d.on(cancel.el, 'click', () => {
          discardReview(prepared.reviewId);
          sheet.close();
        });
        sheet.d.on(confirm.el, 'click', () => {
          if (sheet.closed || destroyed || !card.isConnected || submissionInFlight) return;
          const acknowledgements = reviewCard.acknowledgements;
          // Close the review trap before opening password authentication or submitting.
          sheet.close();
          void submitReviewed(prepared, acknowledgements, kind, state.name);
        });

        sheet.card.appendChild(h('div', { class: 'screen-actions' }, [confirm.el, cancel.el]));
        sheet.open();
      })();
    });

    async function submitReviewed(prepared, acknowledgements, kind, nameText) {
      submissionInFlight = true;
      setListMutationLocked(true);
      for (const control of transactionControls) control.disabled = true;
      const opName = kind === 'domain-renew' ? 'Renewal' : 'Registration';
      setStatus(`Submitting ${opName.toLowerCase()} transaction…`, '');
      banner.set(`Submitting ${opName.toLowerCase()} for ${nameText}.${currentTld()} to Thru L1… Waiting for confirmation.`, 'info');
      const review = prepared.review;
      try {
        const outcome = await submitReviewedReview({
          review,
          acknowledgements,
          signal: abortController.signal,
          passwordTitle: 'Confirm transaction',
          passwordBody: `Enter your password to sign for ${nameText}.${currentTld()}.`,
          confirmLabel: 'Confirm and sign',
        });
        if (destroyed || !card.isConnected) return;
        if (outcome.status === 'cancelled') {
          setStatus('Transaction cancelled', '');
          banner.set('');
          return;
        }
        toast('Transaction confirmed');
        banner.set(`${nameText}.${currentTld()} · ${opName} confirmed on-chain!`, 'ok');
        setStatus(`${nameText}.${currentTld()} · ${opName} confirmed`, 'ok');
        ctaBtn.classList.add('hidden');
        entry.completed = true;
        entry.quote = null;
        // Do NOT automatically set primary domain per user rule
      } catch (err) {
        if (destroyed || !card.isConnected) return;
        const classified = classifyReviewError(err);
        if (classified.kind === 'uncertain') {
          setStatus('Confirmation unavailable. Check the outcome before trying again.', 'warn');
          entry.outcomeUnknown = true;
          entry.recheckRequired = true;
          leaseState = null;
          ctaBtn.classList.remove('hidden');
          ctaLabel().textContent = 'Check outcome';
        } else if (classified.kind === 'stale') {
          banner.set('Transaction details changed. Review the updated details before signing.');
          leaseState = null;
          await load();
        } else {
          banner.set(classified.message);
          setStatus(classified.message, 'bad');
        }
      } finally {
        submissionInFlight = false;
        setListMutationLocked(false);
        for (const control of transactionControls) control.disabled = false;
      }
    }


    bodyDisposer.on(linkBtn, 'click', async () => {
      banner.set('');
      const linkable = leaseState?.kind === 'mine' || leaseState?.kind === 'custom-mine';
      if (!linkable) return;
      linkBtn.disabled = true;
      try {
        const ctx = { expectedNetworkId: network.id, expectedAccountAddress: account.address };
        const imported = await bridge.send('name.trackDomain', { name: leaseState.name, ...ctx });
        if (destroyed || !card.isConnected) return;
        const linked = await bridge.send('name.setPrimaryDomain', { domainAddress: imported.domainAddress, ...ctx });
        if (destroyed || !card.isConnected) return;
        primary = linked;
        toast('Primary name updated');
        await load();
      } catch (err) {
        banner.set(err?.message || 'Could not verify that name on-chain.');
        linkBtn.disabled = false;
      }
    });

    // Hydrate in place; the `.thru` registrar is selected from verified network facts.
    const additions = [
      yearsStepper,
      priceLine,
      balanceLine,
      ctaBtn,
      linkBtn,
    ];
    for (const node of additions) cardInner.appendChild(node);

    // Kick off the initial availability read immediately when a name was pre-filled.
    if (searchField.value?.trim?.()) void backgroundCheck(searchField.value.trim());
  }

  // --------------------------------------------------------------------------
  function render() {
    clearBody();
    body.appendChild(networkEyebrow());
    const tabs = h('div', { class: 'name-tabs', role: 'tablist', 'aria-label': 'Domain sections' });
    const panel = h('div', { class: 'name-tab-content stack stack-3', role: 'tabpanel', 'aria-labelledby': `domain-tab-${activeTab}` });
    const tabButtons = [];
    for (const [key, label] of [['register', 'Register'], ['domains', 'My Domains']]) {
      const tab = h('button', {
        type: 'button', class: `name-tab${activeTab === key ? ' selected' : ''}`,
        id: `domain-tab-${key}`, role: 'tab',
        'aria-selected': activeTab === key ? 'true' : 'false',
        tabindex: activeTab === key ? '0' : '-1', text: label,
      });
      mutationControls.add(tab);
      tab.disabled = submissionInFlight;
      tabButtons.push(tab);
      bodyDisposer.on(tab, 'click', () => {
        if (activeTab === key) return;
        activeTab = key;
        render();
      });
      tabs.appendChild(tab);
    }
    bodyDisposer.on(tabs, 'keydown', (event) => {
      if (submissionInFlight) return;
      const current = tabButtons.indexOf(event.target);
      if (current < 0 || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const next = (current + (event.key === 'ArrowRight' ? 1 : tabButtons.length - 1)) % tabButtons.length;
      activeTab = ['register', 'domains'][next];
      render();
      body.querySelectorAll('.name-tab')[next]?.focus();
    });
    body.appendChild(tabs);
    body.appendChild(panel);

    if (activeTab === 'register') {
      panel.appendChild(h('div', { class: 'hint', text: 'Your name on Thru. Find, register or renew a .thru domain.' }));
      void renderSearchCard(panel, draft);
      const refresh = h('button', { type: 'button', class: 'btn text', text: 'Refresh availability' });
      mutationControls.add(refresh);
      refresh.disabled = submissionInFlight;
      bodyDisposer.on(refresh, 'click', () => {
        providerReads.clear();
        mintReads.clear();
        render();
      });
      panel.appendChild(refresh);
      return;
    }

    if (activeTab === 'domains') {
      renderDomains(panel);
      return;
    }

  }

  async function load() {
    if (destroyed) return;
    const attempt = ++loadSeq;
    const previousAddress = account?.address;
    const previousNetwork = network?.id;
    reviewSheet?.close();
    providerReads.clear();
    mintReads.clear();
    try {
      const [nextNetwork, nextAccount] = await Promise.all([
        bridge.send('network.getActive'), bridge.send('account.getActive'),
      ]);
      if (destroyed || attempt !== loadSeq) return;
      network = nextNetwork;
      account = nextAccount;
      if ((previousAddress && previousAddress !== account.address) || (previousNetwork && previousNetwork !== network.id)) {
        draft = { name: '', years: 1, quote: null };
        primary = null;
      }
      render();
    } catch (err) {
      if (destroyed || attempt !== loadSeq) return;
      banner.set(err?.message || 'Could not read the selected account and network.');
      return;
    }
    if (activeTab === 'domains') return; // this view owns its cached/live hydration
    try {
      const result = await bridge.send('name.getCachedDomains', {
        expectedNetworkId: network.id, expectedAccountAddress: account.address,
      });
      if (destroyed || attempt !== loadSeq || activeTab === 'domains') return;
      primary = result.items.find(item => item.isPrimary) ?? null;
      render();
    } catch { /* no cache: keep the immediately painted route */ }
  }

  d.add(bridge.onEvents({ networkChanged: () => { void load(); }, accountsChanged: () => { void load(); } }));
  render();
  void load();

  return {
    el,
    destroy() {
      destroyed = true;
      abortController.abort();
      clearBody();
      header.destroy();
      banner.destroy();
      d.dispose();
    },
  };
}
