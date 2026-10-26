// Domain route — ENS-style name screen on /name (rebuilt 2026-10-24, owner-directed).
//
// ONE search field is the entire product, like app.ens.domains: you type a name, the
// extension checks the chain in the BACKGROUND (debounced — typing never blocks), and
// the result drives the card:
//   .thru registry present → paid flow: years stepper (1–10) + chain price + Register/Renew/Claim
//   registry absent, root present → FREE flow (owner-directed, 2026-10-24): the name-service
//     program registers a label under the canonical root with fee 0n and NO payment token —
//     first-party: txn_tools.rs build_name_service_register_subdomain carries no token
//     accounts and NAME_SERVICE_PROGRAM_FEE = 0. Register CTA = name.register (self-signed).
//   neither present → the card says so plainly — nothing clickable is fabricated.
// Network suffix (.thru from the registry config / .id or other from the parsed root) comes
// from the chain, never hardcoded.
//
// Writes are self-signed for the active account only (authority = fee payer, proven in
// the first-party CLI) and are password-gated like Send; not signing = nothing broadcast.
import { h, disposer } from '../../kit/dom.js';
import { icon } from '../../kit/icon.js';
import { PageHeader, Banner, Spinner } from '../../kit/feedback.js';
import { Field } from '../../kit/field.js';
import { CopyButton } from '../../kit/button.js';
import { toast } from '../../kit/toast.js';
import { requirePassword } from '../../domain/password-prompt.js';
import * as bridge from '../bridge.js';

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

// A raw token amount string → "12.5" form using the mint's on-chain decimals.
// Never coerced silently: unreadable input returns the raw string plainly.
function formatUnits(rawString, decimals) {
  try {
    const value = BigInt(rawString);
    const scale = BigInt(10) ** BigInt(decimals);
    const whole = value / scale;
    const frac = (value % scale).toString().padStart(Number(decimals), '0').replace(/0+$/, '');
    return frac ? `${whole}.${frac}` : `${whole}`;
  } catch {
    return String(rawString ?? '');
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
      return `${text} (chain time, seconds)`;
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
  let destroyed = false;

  function track(c) {
    if (c) owned.push(c);
    return c;
  }

  const banner = Banner({ tone: 'error' });
  const body = h('div', { class: 'stack stack-4' }, Spinner({ label: 'Loading' }).el);
  const header = PageHeader({ title: 'Domain', onBack: () => back() });
  const el = h('section', { class: 'screen' }, [header.el, banner.el, body]);

  function clearBody() {
    bodyDisposer.dispose();
    bodyDisposer = disposer();
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
  function renderLinkedBadge() {
    const card = h('div', { class: 'stack stack-2' }, [
      h('div', { class: 'row-flex' }, [
        icon('globe', 16),
        h('span', { class: 'row-title', text: primary.name }),
        h('span', { class: 'tag-native', text: 'your name' }),
      ]),
      h('div', { class: 'detail-row' }, [
        h('div', { class: 'detail-val', text: 'Verified on-chain' }),
        h('div', { class: 'detail-val', text: formatVerifiedAt(primary.verifiedAt) }),
      ]),
      h('div', { class: 'screen-actions' }, [
        track(h('button', { type: 'button', class: 'btn secondary' }, [icon('refresh', 14), h('span', { text: ' Re-verify' })])),
        track(h('button', { type: 'button', class: 'btn secondary danger-hover' }, [icon('trash', 14), h('span', { text: ' Unlink' })])),
      ]),
    ]);
    body.appendChild(card);
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
  async function renderSearchCard() {
    const card = h('div', { class: 'stack stack-2' });
    body.appendChild(card);

    // Read the chain's offering up-front: the official paid .thru registry, the canonical
    // name-service root (free registration on networks without the paid registry), and the
    // custom registrar (v25). These three reads are INDEPENDENT — with ms blocks each still
    // costs a background round trip, and serializing them tripled the perceived load time
    // (owner report 2026-10-26), so they run in parallel. Absence in any one is reported
    // honestly, never hidden.
    const [registryRes, canonicalRootRes, customRes] = await Promise.allSettled([
      bridge.send('name.getRegistry'),
      bridge.send('name.getCanonicalRoot'),
      bridge.send('name.getCustomRegistrar'),
    ]);
    if (destroyed || !card.isConnected) return;

    const registry = registryRes.status === 'fulfilled'
      ? registryRes.value
      : { supported: false, reason: registryRes.reason?.message || 'registry read failed' };
    const registryUp = Boolean(registry?.supported && registry?.registry);

    const custom = customRes.status === 'fulfilled'
      ? customRes.value
      : { supported: false, reason: customRes.reason?.message || 'custom registrar read failed' };
    const customUp = Boolean(custom?.supported && custom.rootMatchesNameService);

    let canonRoot = canonicalRootRes.status === 'fulfilled'
      ? canonicalRootRes.value
      : { supported: false, reason: canonicalRootRes.reason?.message || 'root discovery failed' };
    // Depends on custom; only consulted when the paid registry is absent.
    if (!registryUp && customUp && canonRoot?.supported && canonRoot.rootName === custom.rootName) {
      try {
        const alt = await bridge.send('name.getCanonicalRoot', { root: 'id' }).catch(() => null);
        if (alt?.supported) canonRoot = alt;
      } catch { /* honest: primary canonical root read stands */ }
      if (destroyed || !card.isConnected) return;
    }
    const freeRootUp = Boolean(canonRoot?.supported);

    // Provider model: exactly one active provider drives the check + write. The chain's
    // offer can be:.thru paid registry OR custom registrar OR the free canonical root.
    // Default order: official registry → custom registrar → free root.
    const providers = [];
    if (registryUp) providers.push('registry');
    if (customUp) providers.push('custom');
    if (!registryUp && freeRootUp) providers.push('free');
    let provider = providers[0] ?? null;

    // Chain-derived TLD label: the registry config's root name wins; else the parsed root's.
    const tld = provider === 'registry'
      ? (registry.registry.rootName || 'thru')
      : provider === 'custom'
        ? (custom.rootName || 'thru')
        : provider === 'free'
          ? (canonRoot.rootName || '…')
          : null;

    let decimals = null;
    let symbol = 'payment-mint base units';
    if (registryUp) {
      const mintInfo = await bridge.send('token.readMint', { mint: registry.registry.tokenMint }).catch(() => null);
      if (destroyed || !card.isConnected) return;
      const dd = Number(mintInfo?.decimals);
      if (Number.isInteger(dd) && dd >= 0 && dd <= 30) decimals = dd;
      if (mintInfo?.symbol?.trim?.()) symbol = mintInfo.symbol.trim();
    }
    const fmt = (raw) => (decimals == null ? `${raw} base units of the payment mint` : `${formatUnits(raw, decimals)} ${symbol}`);

    // -- pieces -------------------------------------------------------------------
    const statusLine = h('div', { class: 'name-status hint', text: 'Type a name — the extension checks the chain as you type.' });

    const minusBtn = h('button', { type: 'button', class: 'btn secondary name-step-btn', text: '–' });
    const yearsLabel = h('span', { class: 'name-years mono', text: '1 year' });
    const plusBtn = h('button', { type: 'button', class: 'btn secondary name-step-btn', text: '+' });
    const yearsStepper = h('div', { class: 'name-stepper row-flex hidden' }, [
      h('span', { class: 'hint', text: 'Years' }),
      h('div', { class: 'row-flex' }, [minusBtn, yearsLabel, plusBtn]),
    ]);

    const priceLine = h('div', { class: 'name-price hint hidden' });
    const balanceLine = h('div', { class: 'name-balance hint hidden' });
    const ctaBtn = h('button', { type: 'button', class: 'btn primary hidden' }, [h('span', { text: 'Register' })]);
    const ctaLabel = () => ctaBtn.querySelector('span');
    const linkBtn = h('button', { type: 'button', class: 'btn secondary hidden' }, [h('span', { text: 'Link as my name' })]);

    const searchField = track(Field({
      label: 'Name',
      placeholder: tld ? `Search .${tld} — e.g. alice` : 'Search a name — e.g. alice',
      autocomplete: 'off',
      maxLength: 64,
      hint: 'Lowercase letters, numbers, hyphens.',
    }));

    // Provider toggle: visible only when the chain actually offers more than one route
    // (e.g. Betanet today: custom .thru registrar + free .id canonical root).
    let providerRow = null;
    if (providers.length > 1) {
      const btnFor = (kind) => {
        const cfgFor = kind === 'registry'
          ? { suffix: registry.registry.rootName, note: 'paid lease' }
          : kind === 'custom'
            ? { suffix: custom.rootName, note: `${custom.feePerYear} base units/yr` }
            : { suffix: canonRoot.rootName, note: 'free (0n)' };
        const b = h('button', {
          type: 'button',
          class: `provider-pill${provider === kind ? ' selected' : ''}`,
          'data-provider': kind,
        }, [h('span', { text: `.${cfgFor.suffix}` }), h('span', { class: 'hint', text: cfgFor.note })]);
        bodyDisposer.on(b, 'click', () => {
          if (provider === kind) return;
          provider = kind;
          providerRow.querySelectorAll('.provider-pill').forEach((x) => x.classList.toggle('selected', x === b));
          // Re-arm the whole card for the new provider's root, name rules and price quote.
          const newTld = kind === 'registry' ? registry.registry.rootName : kind === 'custom' ? custom.rootName : canonRoot.rootName;
          searchField.control.placeholder = `Search .${newTld} — e.g. alice`;
          leaseState = null;
          hideActions();
          queueCheck();
        });
        return b;
      };
      providerRow = h('div', { class: 'name-provider-row row-flex' }, providers.map(btnFor));
    }

    // Pre-fill with the linked name so an owner lands on their own identity, ENS-style.
    if (primary?.name) {
      searchField.value = primary.name;
    }

    let years = 1;
    // kind: 'available'|'taken'|'mine'|'claimable' (registry mode) — plus
    // 'free-available'|'free-taken'|'free-mine' in free-root mode (no lease, no price).
    let leaseState = null;
    let payment = null;     // name.getPaymentBalance read (refreshing with each check)
    let checkSeq = 0;
    let checkTimer = null;

    function pricePerYear() { return BigInt(registry.registry.pricePerYear); }
    function baseCost() { return pricePerYear() * BigInt(years); }
    // Custom registrar fee: native base units, read from the on-chain config (raw BigInt).
    function customPricePerYear() { return BigInt(custom.feePerYear); }
    function customBaseCost() { return customPricePerYear() * BigInt(years); }

    function setYears(delta) {
      years = Math.min(10, Math.max(1, years + delta));
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
    }

    function setStatus(markup, tone) {
      statusLine.textContent = markup;
      statusLine.className = `name-status hint ${tone ? `name-status-${tone}` : ''}`.trim();
    }

    // Arm price/action affordances for the current leaseState (also re-run on year change).
    function armForState(state) {
      if (!state) return;
      hideActions();
      // Custom registrar mode (v25): years-priced lease in native base units, quoted from
      // the on-chain config. The fee is charged by the PROGRAM to the config treasury;
      // on Betanet's VM that debit is best-effort (unowned-EOA transfer refusal is
      // non-fatal in the program — dfd7316), which the quote line says plainly.
      if (state.kind === 'custom-available') {
        yearsStepper.classList.remove('hidden');
        const cost = customBaseCost();
        priceLine.classList.remove('hidden');
        priceLine.textContent = `${years === 1 ? '1 year' : `${years} years`} × ${custom.feePerYear} = ${cost} base units`;
        ctaBtn.classList.remove('hidden');
        ctaLabel().textContent = ` Register — ${cost} base units`;
        return;
      }
      if (state.kind === 'custom-mine') {
        if (!(primary?.name === state.name)) linkBtn.classList.remove('hidden');
        return;
      }
      // Free-root mode: no lease duration, no price — the name-service program's register
      // write carries fee 0n and no payment accounts (first-party txn_tools.rs, 2026-10-24).
      if (state.kind === 'free-available') {
        priceLine.classList.remove('hidden');
        priceLine.textContent = 'Free — 0n protocol fee.';
        ctaBtn.classList.remove('hidden');
        ctaLabel().textContent = ' Register — free';
        return;
      }
      if (state.kind === 'free-mine') {
        if (!(primary?.name === state.name)) linkBtn.classList.remove('hidden');
        return;
      }
      const purchasable = state.kind === 'available' || state.kind === 'claimable';
      const renewable = state.kind === 'mine';
      if (!purchasable && !renewable) return;
      if (!registryUp) return; // nothing to sell here — status line already said so

      yearsStepper.classList.remove('hidden');
      const cost = fmt(String(baseCost()));
      priceLine.classList.remove('hidden');
      priceLine.textContent = `${years === 1 ? '1 year' : `${years} years`} × ${fmt(registry.registry.pricePerYear)} = ${cost}`;
      if (payment?.exists && payment.amount != null) {
        balanceLine.classList.remove('hidden');
        const bal = BigInt(payment.amount);
        balanceLine.textContent = `Your balance: ${fmt(String(bal))}${bal < baseCost() ? ' — not enough for this price' : ''}`;
      }
      ctaBtn.classList.remove('hidden');
      ctaLabel().textContent = state.kind === 'mine'
        ? ` Renew — ${cost}`
        : state.kind === 'claimable'
          ? ` Claim & register — ${cost}`
          : ` Register — ${cost}`;
      if (state.kind === 'mine' && !(primary?.name === state.name)) {
        linkBtn.classList.remove('hidden');
      }
    }

    // Free-root mode (registry absent, canonical root present): resolve the name straight
    // from the name-service chain — owner truth comes from the parsed domain account.
    async function freeCheck(name) {
      const mySeq = ++checkSeq;
      setStatus(`Checking the chain for ${name}.${currentTld()}…`, '');
      try {
        const res = await bridge.send('name.lookup', { name, rootAddress: '' });
        if (destroyed || !statusLine.isConnected || mySeq !== checkSeq) return; // stale
        const owner = res?.leaf?.exists ? res.leaf.domain?.owner ?? null : null;
        if (!res?.leaf?.exists) {
          // Chain rule (live-verified 2026-10-24 on Betanet): register-subdomain reverts
          // with name-service error 3 unless the signer IS the root's authority. A
          // self-signed wallet can therefore register for free only under a root its own
          // key controls — a foreign closed root is honestly reported, never armed.
          const authority = canonRoot?.authority ?? null;
          if (authority && account?.address && authority !== account.address) {
            leaseState = null;
            hideActions();
            setStatus(`✓ ${name}.${currentTld()} is unregistered, but the .${currentTld()} root is closed: its authority ${truncateMiddle(authority)} ≠ your account — the chain reverts any other signer (error 3). Registration under ${currentTld()} is unavailable to you.`, 'warn');
          } else {
            leaseState = { kind: 'free-available', name, rootAddress: res.rootAddress };
            setStatus(`✓ ${name}.${currentTld()} is available — free to register on ${network?.label || 'this network'} (0n protocol fee, no payment token).`, 'ok');
          }
        } else if (res.leaf.decodeError) {
          leaseState = null;
          setStatus(`? ${name}.${currentTld()} exists but its account could not be decoded: ${res.leaf.decodeError}. Registration refused — the chain, not this screen, owns the name.`, 'warn');
        } else if (owner && account?.address && owner === account.address) {
          leaseState = { kind: 'free-mine', name, rootAddress: res.rootAddress };
          setStatus(`✓ ${name}.${currentTld()} is yours — registered on-chain to your active account.`, 'ok');
        } else {
          leaseState = { kind: 'free-taken', name, rootAddress: res.rootAddress };
          setStatus(`✕ ${name}.${currentTld()} is taken — owned by ${truncateMiddle(owner || 'unknown')}.`, 'bad');
        }
        armForState(leaseState);
      } catch (err) {
        if (destroyed || !statusLine.isConnected || mySeq !== checkSeq) return;
        leaseState = null;
        hideActions();
        setStatus(`? Could not check '${name}' on-chain: ${err?.message || err}. Type again to retry.`, 'warn');
      }
    }

    // Custom registrar mode (v25): lease PDA + domain existence, fee from on-chain config.
    async function customCheck(name) {
      const mySeq = ++checkSeq;
      setStatus(`Checking the chain for ${name}.${custom.rootName}…`, '');
      try {
        const res = await bridge.send('name.checkCustomLease', { name });
        if (destroyed || !statusLine.isConnected || mySeq !== checkSeq) return; // stale
        if (!res?.supported) throw new Error(res?.reason || 'custom registrar reads unsupported on this network');
        if (res.labelProblem) {
          leaseState = null;
          hideActions();
          setStatus(`✕ ${name}: ${res.labelProblem}.`, 'bad');
          return;
        }
        if (res.readError) throw new Error(res.readError);
        if (res.leaseExists && res.leaseParseError) {
          leaseState = null;
          hideActions();
          setStatus(`? ${name}.${custom.rootName} has a lease account that could not be decoded: ${res.leaseParseError}. Registration refused — the chain, not this screen, owns the name.`, 'warn');
          return;
        }
        if (res.leaseExists) {
          const mine = Boolean(res.lease?.owner && account?.address && res.lease.owner === account.address);
          if (mine) {
            leaseState = { kind: 'custom-mine', name, lease: res.lease, rootAddress: res.root };
            setStatus(`✓ ${name}.${custom.rootName} is yours — lease ends ${formatChainTime(res.lease.expiresAtSeconds)}.`, 'ok');
          } else if (res.expiredHint) {
            leaseState = null;
            hideActions();
            setStatus(`✕ ${name}.${custom.rootName} has an expired lease held by ${truncateMiddle(res.lease.owner)}. Claim/renew through the custom registrar is not yet available in the wallet (only Register is live-verified), so while the lease account exists nothing can register it.`, 'warn');
          } else {
            leaseState = { kind: 'custom-taken', name, lease: res.lease };
            hideActions();
            setStatus(`✕ ${name}.${custom.rootName} is taken — leased by ${truncateMiddle(res.lease.owner)} until ${formatChainTime(res.lease.expiresAtSeconds)}.`, 'bad');
          }
        } else if (res.domainExists) {
          leaseState = { kind: 'custom-taken', name };
          hideActions();
          setStatus(`✕ ${name}.${custom.rootName} exists as a name-service domain — registered by another authority. The custom registrar cannot register over it.`, 'bad');
        } else {
          leaseState = { kind: 'custom-available', name, rootAddress: res.root };
          setStatus(`✓ ${name}.${custom.rootName} is available.`, 'ok');
        }
        armForState(leaseState);
      } catch (err) {
        if (destroyed || !statusLine.isConnected || mySeq !== checkSeq) return;
        leaseState = null;
        hideActions();
        setStatus(`? Could not check '${name}' on-chain: ${err?.message || err}. Type again to retry.`, 'warn');
      }
    }

    async function backgroundCheck(name) {
      if (provider === 'custom') return customCheck(name);
      if (!registryUp && freeRootUp) return freeCheck(name);
      const mySeq = ++checkSeq;
      setStatus(`Checking the chain for ${name}.${currentTld()}…`, '');
      try {
        const res = await bridge.send('name.checkLease', { name });
        if (destroyed || !statusLine.isConnected || mySeq !== checkSeq) return; // stale
        if (!res?.supported) throw new Error(res?.reason || 'registry reads unsupported on this network');
        if (registryUp) {
          payment = await bridge.send('name.getPaymentBalance').catch(() => null);
          if (destroyed || !statusLine.isConnected || mySeq !== checkSeq) return;
        }

        const mine = Boolean(res.lease && account?.address && res.lease.owner === account.address);
        if (mine) {
          leaseState = { kind: 'mine', name, lease: res.lease };
          setStatus(`✓ ${name}.${currentTld()} is yours — lease ends ${formatChainTime(res.lease.endTime)}.`, 'ok');
        } else if (res.lease && res.lease.expiredHint === false) {
          leaseState = { kind: 'taken', name, lease: res.lease };
          setStatus(`✕ ${name}.${currentTld()} is taken — leased by ${truncateMiddle(res.lease.owner)} until ${formatChainTime(res.lease.endTime)}.`, 'bad');
        } else if (res.lease) {
          leaseState = { kind: 'claimable', name, lease: res.lease };
          setStatus(`✓ ${name}.${currentTld()} is claimable — the previous lease expired.`, 'ok');
        } else if (!registryUp) {
          leaseState = { kind: 'available-unpriced', name };
          setStatus(`? ${name}.${currentTld()} is unregistered on ${network?.label || network?.id}, but no name root is available here — registration is unavailable on this network: ${registry?.reason}; ${canonRoot?.reason || 'no canonical root'}.`, 'warn');
        } else {
          leaseState = { kind: 'available', name };
          setStatus(`✓ ${name}.${currentTld()} is available.`, 'ok');
        }
        armForState(leaseState);
      } catch (err) {
        if (destroyed || !statusLine.isConnected || mySeq !== checkSeq) return;
        leaseState = null;
        hideActions();
        setStatus(`? Could not check '${name}' on-chain: ${err?.message || err}. Type again to retry.`, 'warn');
      }
    }

    // The toggle changes the active root; status copy must name the CURRENT provider's TLD,
    // not the one that was default at mount.
    function currentTld() {
      return provider === 'registry' ? registry.registry.rootName
        : provider === 'custom' ? custom.rootName
          : provider === 'free' ? canonRoot?.rootName
            : tld;
    }

    const queueCheck = () => {
      const name = (searchField.value?.trim?.() ?? '').toLowerCase();
      clearTimeout(checkTimer);
      leaseState = null;
      hideActions();
      if (name.length === 0) { setStatus('Type a name — the extension checks the chain as you type.', ''); return; }
      if (name.length > 64 || name.includes('.')) {
        setStatus(name.length > 64 ? 'Names are 1–64 characters (chain rule).' : 'A single name — no dots.', 'bad');
        return;
      }
      const cur = currentTld();
      setStatus(cur ? `Waiting to check ${name}.${cur}…` : `Waiting to check ${name}…`, '');
      checkTimer = setTimeout(() => { void backgroundCheck(name); }, 450);
    };
    bodyDisposer.on(searchField.control, 'input', queueCheck);
    bodyDisposer.on(searchField.control, 'keydown', (e) => {
      if (e.key === 'Enter' && leaseState && !ctaBtn.classList.contains('hidden')) ctaBtn.click();
    });

    async function writeWithPassword(method, name, yrs, customRegister = false) {
      const isFreeRegister = method === 'name.register' && !customRegister;
      const sendChecked = (extra = {}) => bridge.send(method, customRegister
        ? { name, years: yrs, via: 'custom', ...extra }
        : isFreeRegister
          ? { name, parentAddress: canonRoot.rootAddress, ...extra }
          : { name, years: yrs, ...extra });
      const prefs = await bridge.send('settings.get').catch(() => null);
      if (prefs?.requirePasswordForSigning === false) return sendChecked();
      const noun = method === 'name.purchase' || isFreeRegister || customRegister ? 'registration' : method === 'name.renewLease' ? 'lease renewal' : 'expired-lease claim';
      return requirePassword({
        title: 'Confirm registration',
        body: `Re-enter your password to sign and broadcast this ${noun}.`,
        confirmLabel: 'Sign & broadcast',
        verify: (password) => sendChecked({ password }),
      });
    }

    bodyDisposer.on(ctaBtn, 'click', async () => {
      banner.set('');
      if (!leaseState) return;
      const state = leaseState;
      const freeRegister = state.kind === 'free-available';
      const customRegister = state.kind === 'custom-available';
      if (!freeRegister && !customRegister && !registryUp) return;
      const method = freeRegister || customRegister
        ? 'name.register'
        : state.kind === 'mine' ? 'name.renewLease' : state.kind === 'claimable' ? 'name.claimExpired' : 'name.purchase';
      ctaBtn.disabled = true;
      try {
        const result = await writeWithPassword(method, state.name, years, customRegister);
        if (!result) { ctaBtn.disabled = false; return; } // cancelled — nothing signed
        toast(`Submitted: ${truncateMiddle(result.signature, 8)}`);
        if (method !== 'name.renewLease') {
          // Best-effort primary-name link; a failed link must not masquerade as a failed
          // registration — the search card remains the single source of truth afterwards.
          try {
            const rootForLink = freeRegister
              ? state.rootAddress
              : customRegister
                ? custom.root
                : registry.registry.rootRegistrar;
            primary = await bridge.send('name.linkPrimary', { name: state.name, rootAddress: rootForLink });
            toast(`'${state.name}' linked as your primary name.`);
          } catch { /* registration itself is done */ }
        }
        await load();
      } catch (err) {
        banner.set(err?.message || 'The write did not go through.');
        ctaBtn.disabled = false;
      }
    });

    bodyDisposer.on(linkBtn, 'click', async () => {
      banner.set('');
      const linkable = leaseState?.kind === 'mine' || leaseState?.kind === 'free-mine' || leaseState?.kind === 'custom-mine';
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

    const footerHint = () => (provider === 'registry'
      ? `Price read from the on-chain registry config · tx fee 0n.`
      : provider === 'custom'
        ? `Fee is charged by the registrar program from its on-chain config · tx fee 0n.`
        : freeRootUp
          ? `Registered by the name-service program directly · free (0n fee).`
          : `Registration is unavailable on this network: ${registry?.reason || 'registry state unreadable'}; ${canonRoot?.reason || 'no canonical name root found'}.`);
    if (providerRow) bodyDisposer.on(providerRow, 'click', () => footerEl.textContent = footerHint());
    const footerEl = h('div', { class: 'hint', text: footerHint() });

    card.appendChild(h('div', { class: 'stack stack-2' }, [
      searchField.el,
      ...(providerRow ? [providerRow] : []),
      statusLine,
      yearsStepper,
      priceLine,
      balanceLine,
      ctaBtn,
      linkBtn,
      footerEl,
    ]));

    // Kick off the initial availability read when a linked name was pre-filled.
    if (searchField.value?.trim?.()) queueCheck();
  }

  // --------------------------------------------------------------------------
  function render() {
    clearBody();
    body.appendChild(networkEyebrow());
    if (primary?.name) renderLinkedBadge();
    void renderSearchCard();
  }

  async function load() {
    if (destroyed) return;
    try {
      network = await bridge.send('network.getActive');
      account = await bridge.send('account.getActive');
    } catch (err) {
      clearBody();
      body.appendChild(h('div', { class: 'notice', text: err?.message || 'Could not load.' }));
      return;
    }
    // Re-verification happens INSIDE the backend read: a stored link whose owner changed
    // on chain comes back as null rather than a stale badge.
    try {
      primary = await bridge.send('name.getPrimary');
    } catch {
      primary = null;
    }
    if (!destroyed) render();
  }

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
