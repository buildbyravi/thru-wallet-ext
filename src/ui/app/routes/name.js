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
  let primaryLoaded = false;
  let primaryReadError = null;
  let activeTab = 'register';
  let draft = { name: '', years: 1, quote: null };
  let reviewSheet = null;
  let submissionInFlight = false;
  const mutationControls = new Set();
  const transactionControls = new Set();
  const providerReads = new Map();
  const mintReads = new Map();
  let destroyed = false;

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
  // Compact linked-name banner (ENS "manager" corner): only when a primary link
  // exists. The hero below stays the search field either way.
  function renderLinkedBadge(host = body) {
    const card = h('div', { class: 'stack stack-2' }, [
      h('div', { class: 'row-flex' }, [
        icon('globe', 16),
        h('span', { class: 'row-title', text: primary.name }),
        h('span', { class: 'tag-native', text: 'Primary' }),
      ]),
      h('div', { class: 'detail-row' }, [
        h('div', { class: 'detail-val', text: primary.stale ? 'Saved name · check unavailable' : 'Verified ownership' }),
        h('div', { class: 'detail-val', text: formatVerifiedAt(primary.verifiedAt) }),
      ]),
      h('div', { class: 'hint', text: `Account ${truncateMiddle(account?.address || '', 8)}` }),
      h('div', { class: 'screen-actions' }, [
        track(h('button', { type: 'button', class: 'btn secondary' }, [icon('refresh', 14), h('span', { text: ' Refresh' })])),
        track(h('button', { type: 'button', class: 'btn secondary danger-hover' }, [icon('trash', 14), h('span', { text: ' Unlink' })])),
      ]),
    ]);
    host.appendChild(card);
    const [reverifyBtn, unlinkBtn] = owned.slice(-2);
    bodyDisposer.on(reverifyBtn, 'click', () => { void load(); });
    bodyDisposer.on(unlinkBtn, 'click', async () => {
      unlinkBtn.disabled = true;
      try {
        await bridge.send('name.unlinkPrimary');
        toast('Name unlinked from this wallet.');
        primary = null;
        await load();
      } catch (err) {
        banner.set(err?.message || 'Could not unlink.');
        unlinkBtn.disabled = false;
      }
    });
  }

  // --------------------------------------------------------------------------
  // THE search card — the whole product typed into one field, ENS-style.
  async function renderSearchCard(host, entry = draft) {
    const card = h('div', { class: 'name-entry stack stack-2' });
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
    const preferredProvider = providers.includes(entry.provider) ? entry.provider : (providers[0] ?? null);
    const pinnedProvider = entry.rootAddress
      ? (providerRoots[entry.provider] === entry.rootAddress
        ? entry.provider
        : providers.find((kind) => providerRoots[kind] === entry.rootAddress) ?? null)
      : null;
    const provider = entry.rootAddress ? pinnedProvider : preferredProvider;
    const rootUnsupported = Boolean(entry.rootAddress && !pinnedProvider);
    const tld = provider ? 'thru' : null;

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
      h('span', { class: 'hint', text: 'Registration period' }),
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
      // Configured price is a quote, not evidence of the amount ultimately charged.
      if (state.kind === 'custom-available') {
        yearsStepper.classList.remove('hidden');
        const cost = customBaseCost();
        entry.quote = { assetId: `${network?.id || 'active'}:${NATIVE_TOKEN.symbol}`, ticker: NATIVE_TOKEN.symbol, decimals: NATIVE_TOKEN.decimals, raw: cost };
        priceLine.classList.remove('hidden');
        priceLine.textContent = `Registration quote: ${formatTokenAmount(cost, NATIVE_TOKEN.decimals)} ${NATIVE_TOKEN.symbol}`;
        balanceLine.classList.remove('hidden');
        if (nativeBalance?.exists && !nativeBalance.stale && nativeBalance.balance != null) {
          const have = BigInt(nativeBalance.balance);
          balanceLine.textContent = `Balance: ${formatTokenAmount(have, NATIVE_TOKEN.decimals)} ${NATIVE_TOKEN.symbol}${have < cost ? ' · Insufficient balance' : ''}`;
          ctaBtn.disabled = have < cost;
        } else if (nativeBalance && !nativeBalance.exists && !nativeBalance.stale) {
          balanceLine.textContent = 'This account needs activation before registration.';
        } else {
          balanceLine.textContent = 'Balance unavailable. Refresh to try again.';
          ctaBtn.disabled = true;
        }
        ctaBtn.classList.remove('hidden');
        ctaLabel().textContent = 'Review registration';
        return;
      }
      if (state.kind === 'custom-mine') {
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
          if (account?.address) {
            const balances = await bridge.send('tx.getBalances', { addresses: [account.address] }).catch(() => null);
            if (destroyed || !statusLine.isConnected || mySeq !== checkSeq) return;
            nativeBalance = balances?.[account.address] ?? null;
          }
          setStatus('Available', 'ok');
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
          setStatus('Already registered', 'bad');
        } else if (res.lease) {
          leaseState = { kind: 'claimable', name, lease: res.lease };
          setStatus('Available to claim · Previous registration expired', 'ok');
        } else if (res.domainExists) {
          leaseState = null;
          hideActions();
          setStatus('Already registered', 'bad');
        } else {
          leaseState = { kind: 'available', name };
          setStatus('Available', 'ok');
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
      if (!customRegister && !registryUp) return;

      // The SAME review pipeline the Send route uses. The domain decoders decide what the
      // sheet renders; this route only chooses the operation kind.
      const kind = customRegister ? 'domain-register'
        : state.kind === 'mine' ? 'domain-renew'
          : state.kind === 'claimable' ? 'domain-claim' : 'domain-purchase';
      const title = kind === 'domain-renew' ? 'Confirm renewal'
        : kind === 'domain-claim' ? 'Confirm expired claim'
          : kind === 'domain-purchase' ? 'Confirm purchase' : 'Confirm registration';
      const reviewedYears = years;
      const params = { name: state.name, years: reviewedYears, ...(customRegister ? { via: 'custom' } : {}) };

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

        const reviewCard = sheet.track(TxReviewCard({ review: prepared.review }));
        sheet.card.appendChild(reviewCard.el);

        const cancel = sheet.track({
          el: h('button', { type: 'button', class: 'btn secondary', text: 'Cancel' }),
          destroy: () => {},
        });
        let confirm = null;
        confirm = sheet.track({
          el: h('button', {
            type: 'button',
            class: 'btn primary',
            text: prepared.review.operation.confirmLabel || 'Confirm and sign',
            disabled: !reviewCard.canConfirm(),
          }),
          destroy: () => {},
        });
        // The card's acknowledgements gate the confirm control; the sheet owns the listener
        // so it is removed on close even if the sheet closes while a prompt is open.
        sheet.d.on(reviewCard.el, 'change', () => {
          confirm.el.disabled = !reviewCard.canConfirm();
        });

        sheet.d.on(cancel.el, 'click', () => {
          discardReview(prepared.reviewId);
          sheet.close();
        });
        sheet.d.on(confirm.el, 'click', () => {
          if (sheet.closed || destroyed || !card.isConnected || submissionInFlight) return;
          const acknowledgements = reviewCard.acknowledgements;
          // Close the review trap before opening password authentication. All signed values
          // come from this prepared review, never from a subsequently edited form.
          sheet.close();
          void submitReviewed(prepared, acknowledgements, kind, state.name);
        });

        sheet.card.appendChild(h('div', { class: 'screen-actions' }, [confirm.el, cancel.el]));
        sheet.open();
      })();
    });

    async function submitReviewed(prepared, acknowledgements, kind, nameText) {
      submissionInFlight = true;
      setListMutationLocked();
      for (const control of transactionControls) control.disabled = true;
      setStatus('Preparing transaction…', '');
      const review = prepared.review;
      const customRegister = kind === 'domain-register';
      try {
        const outcome = await submitReviewedReview({
          review,
          acknowledgements,
          passwordTitle: 'Confirm transaction',
          passwordBody: `Enter your password to sign for ${nameText}.${currentTld()}.`,
          confirmLabel: 'Confirm and sign',
        });
        if (destroyed || !card.isConnected) return;
        if (outcome.status === 'cancelled') { setStatus('Transaction cancelled', ''); return; }
        toast('Transaction confirmed');
        setStatus(`${nameText}.${currentTld()} · ${kind === 'domain-renew' ? 'Renewal' : 'Registration'} confirmed`, 'ok');
        ctaBtn.classList.add('hidden');
        entry.completed = true;
        entry.quote = null;
        if (kind !== 'domain-renew') {
          // Best-effort primary-name link; a failed link must not masquerade as a failed
          // registration — the search card remains the single source of truth afterwards.
          try {
            const rootForLink = customRegister ? custom.root : registry.registry.rootRegistrar;
            const linked = await bridge.send('name.linkPrimary', { name: nameText, rootAddress: rootForLink });
            if (destroyed || !card.isConnected) return;
            primary = linked;
            toast('Primary name updated');
          } catch { /* registration itself is done */ }
        }
      } catch (err) {
        if (destroyed || !card.isConnected) return;
        const classified = classifyReviewError(err);
        if (classified.kind === 'uncertain') {
          setStatus('Confirmation pending. Check the outcome before trying again.', 'warn');
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
          banner.set(err?.message || 'Transaction failed. Please try again.');
          setStatus('Transaction failed. Check availability before trying again.', 'bad');
          entry.recheckRequired = true;
          leaseState = null;
          ctaBtn.classList.remove('hidden');
          ctaLabel().textContent = 'Check again';
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
        const rootForLink = leaseState?.kind === 'custom-mine'
          ? custom.root
          : registryUp
            ? registry.registry.rootRegistrar
            : leaseState.rootAddress || '';
        primary = await bridge.send('name.linkPrimary', { name: leaseState.name, rootAddress: rootForLink });
        toast(`'${leaseState.name}' verified — linked to active account.`);
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

    // Kick off the initial availability read when a linked name was pre-filled.
    if (searchField.value?.trim?.()) queueCheck();
  }

  // --------------------------------------------------------------------------
  function render() {
    clearBody();
    body.appendChild(networkEyebrow());
    const tabs = h('div', { class: 'name-tabs', role: 'tablist', 'aria-label': 'Domain sections' });
    const panel = h('div', { class: 'name-tab-content stack stack-3', role: 'tabpanel', 'aria-labelledby': `domain-tab-${activeTab}` });
    const tabButtons = [];
    for (const [key, label] of [['register', 'Register'], ['domains', 'My Domains'], ['renew', 'Renew']]) {
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
      activeTab = ['register', 'domains', 'renew'][next];
      render();
      body.querySelectorAll('.name-tab')[next]?.focus();
    });
    body.appendChild(tabs);
    body.appendChild(panel);

    if (activeTab === 'register') {
      panel.appendChild(h('div', { class: 'hint', text: 'Your name on Thru. Find and register a .thru domain.' }));
      void renderSearchCard(panel);
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
      panel.appendChild(h('div', { class: 'hint', text: 'Link your .thru domain to use it as your wallet address.' }));
      if (!primaryLoaded) {
        panel.appendChild(h('div', { class: 'name-empty', role: 'status', text: 'Checking your primary name…' }));
      } else if (primaryReadError) {
        panel.appendChild(h('div', { class: 'name-empty name-status-warn', role: 'status', text: 'Your primary name could not be checked. Try again shortly.' }));
      } else if (primary?.name) {
        renderLinkedBadge(panel);
      } else {
        panel.appendChild(h('div', { class: 'name-empty stack stack-2' }, [
          h('div', { class: 'row-title', text: 'No domains linked yet' }),
          h('div', { class: 'hint', text: 'Search for a domain you own in Register to link it.' }),
        ]));
      }
      return;
    }

    panel.appendChild(h('div', { class: 'name-renew-intro stack stack-2' }, [
      h('div', { class: 'row-title', text: 'Keep your name' }),
      h('div', { class: 'hint', text: 'Extend your registration period to maintain ownership.' }),
    ]));
    if (primary?.name) {
      const linked = h('button', { type: 'button', class: 'btn secondary', text: `Check linked name: ${primary.name}` });
      bodyDisposer.on(linked, 'click', () => {
        draft = { name: primary.name, rootAddress: primary.rootAddress, years: 1, provider: 'registry', quote: null };
        activeTab = 'register';
        render();
      });
      panel.appendChild(linked);
    }
    const renewField = track(Field({
      label: 'Domain name',
      placeholder: 'yourname',
      autocomplete: 'off',
      maxLength: 64,
      hint: 'Renewal is available for eligible paid-registry domains only.',
    }));
    const checkRenew = h('button', { type: 'button', class: 'btn primary', text: 'Check renewal eligibility' });
    bodyDisposer.on(checkRenew, 'click', () => {
      const name = renewField.value.trim();
      if (!name) { banner.set('Enter one base name to check.'); renewField.control.focus(); return; }
      banner.set('');
      draft = { name, years: 1, provider: 'registry', quote: null };
      activeTab = 'register';
      render();
    });
    panel.appendChild(h('div', { class: 'stack stack-2' }, [renewField.el, checkRenew]));
  }

  async function load() {
    if (destroyed) return;
    providerReads.clear();
    mintReads.clear();
    try {
      network = await bridge.send('network.getActive');
      account = await bridge.send('account.getActive');
    } catch (err) {
      primaryLoaded = true;
      primaryReadError = err?.message || 'account or network could not be read';
      banner.set(err?.message || 'Could not read the selected account and network.');
      if (!destroyed) render();
      return;
    }
    // Re-verification happens INSIDE the backend read: a stored link whose owner changed
    // on chain comes back as null rather than a stale badge.
    try {
      primary = await bridge.send('name.getPrimary');
      primaryReadError = null;
    } catch (err) {
      primary = null;
      primaryReadError = err?.message || 'name lookup failed';
    }
    primaryLoaded = true;
    if (!destroyed) render();
  }

  render();
  void load();

  return {
    el,
    destroy() {
      destroyed = true;
      clearBody();
      header.destroy();
      banner.destroy();
      d.dispose();
    },
  };
}
