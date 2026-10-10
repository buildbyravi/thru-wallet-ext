// Domain route — the wallet's primary-name screen (2026-10-09, owner-directed UX slice).
//
// A first-class screen behind the dashboard's Domain tile, in the same family as
// Send/Receive/History. What it does:
//   - shows the verified primary name for the active account on the active network
//     (re-verified against the chain on every mount by the backend)
//   - lets you LINK a name you own: root registrar is auto-discovered from proven
//     on-chain candidate roots (discoverDefaultRoot in name-service), so a user only
//     enters their name. The backend resolves the domain account and stores the link
//     ONLY when its owner field IS your active address — a name someone else owns is
//     refused with NOT_NAME_OWNER.
//   - copyable addresses, re-verify, unlink, and look up ANY name honestly.
//
// Extensions 2026-10-10 (owner-directed): registrar leases — REGISTER (paid purchase),
// RENEW, and CLAIM-expired — against the chain's .thru registry. Registry state is read
// live (name.getRegistry) and every price/owner/expiry line is parsed from chain bytes;
// when the registry is absent or unreadable the section says so instead of quoting.
// Writes are self-signed for the active account only and go through the same password
// re-auth gate as Send. The gated onewire name.register/setRecord formats stay off.
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
// Never coerced silently: out-of-range or unreadable input returns the raw string.
function formatUnits(rawString, decimals) {
  try {
    const value = BigInt(rawString);
    const scale = BigInt(10) ** BigInt(decimals);
    const whole = value / scale;
    const frac = (value % scale).toString().padStart(Number(decimals), '0').replace(/0+$/, '');
    return frac ? `${whole}.${frac}` : `${whole}`;
  } catch {
    return String(rawString);
  }
}

// Lease times are u64 "chain time". Localize only when they plausibly read as unix
// seconds, and label the unit either way — never silently reinterpret an unknown clock.
function formatChainTime(u64String) {
  try {
    const seconds = BigInt(u64String);
    if (seconds >= 1_500_000_000n && seconds < 10_000_000_000n) {
      return `${new Date(Number(seconds) * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} (chain time, seconds)`;
    }
    return `${seconds} (chain time, seconds)`;
  } catch {
    return String(u64String);
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

  function detailRow(label, value, fullValue) {
    const children = [
      h('div', { class: 'detail-val', text: label }),
      h('div', { class: 'detail-val mono', text: value }),
    ];
    if (fullValue) {
      const copy = track(CopyButton({ getValue: () => fullValue, title: `Copy ${label}` }));
      children.push(copy.el);
    }
    return h('div', { class: 'detail-row' }, children);
  }

  function renderLinked() {
    const card = h('div', { class: 'stack stack-2' }, [
      networkEyebrow(),
      h('div', { class: 'row-flex' }, [
        icon('globe', 18),
        h('span', { class: 'row-title', text: primary.name }),
        h('span', { class: 'tag-native', text: 'verified' }),
      ]),
      h('div', { class: 'detail-table' }, [
        detailRow('Linked account', truncateMiddle(account?.address), account?.address),
        detailRow('Domain address', truncateMiddle(primary.domainAddress), primary.domainAddress),
        detailRow('Root registrar', truncateMiddle(primary.rootAddress), primary.rootAddress),
        h('div', { class: 'detail-row' }, [
          h('div', { class: 'detail-val', text: 'Verified on-chain' }),
          h('div', { class: 'detail-val', text: formatVerifiedAt(primary.verifiedAt) }),
        ]),
      ]),
      h('div', { class: 'row-flex' }, [
        h('span', { class: 'hint', text: 'Ownership is re-checked against the chain every time this screen opens. If the owner changes, this badge disappears.' }),
      ]),
      h('div', { class: 'screen-actions' }, [
        track(h('button', {
          type: 'button', class: 'btn secondary',
        }, [icon('refresh', 14), h('span', { text: ' Re-verify' })])),
        track(h('button', {
          type: 'button', class: 'btn secondary danger-hover',
        }, [icon('trash', 14), h('span', { text: ' Unlink' })])),
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
        renderUnlinked();
      } catch (err) {
        banner.set(err?.message || 'Could not unlink.');
        unlinkBtn.disabled = false;
      }
    });
  }

  function renderLookupBox() {
    const nameField = track(Field({
      label: 'Name to look up',
      placeholder: 'alice or sub.alice',
      autocomplete: 'off',
      onEnter: () => lookupBtn.click(),
    }));
    const rootField = track(Field({
      label: 'Root registrar (optional — canonical root is auto-discovered)',
      placeholder: 'ta… — leave empty to use the chain\u2019s canonical root',
      autocomplete: 'off',
      value: primary?.rootAddress ?? '',
      onEnter: () => lookupBtn.click(),
    }));
    const resultBox = h('div', { class: 'notice hidden', text: '' });
    const lookupBtn = h('button', { type: 'button', class: 'btn secondary' }, [icon('search', 14), h('span', { text: ' Look up on-chain' })]);
    bodyDisposer.on(lookupBtn, 'click', async () => {
      const name = nameField.value?.trim?.() ?? '';
      const rootAddress = rootField.value?.trim?.() ?? '';
      if (!name) {
        resultBox.classList.remove('hidden');
        resultBox.textContent = 'A name is required.';
        return;
      }
      lookupBtn.disabled = true;
      try {
        const res = await bridge.send('name.lookup', { name, rootAddress });
        resultBox.classList.remove('hidden');
        if (!res?.leaf?.exists) {
          resultBox.textContent = `'${name}' does not exist under root ${truncateMiddle(res?.rootAddress)} on ${network?.label || network?.id}. It may still be claimable.`;
        } else if (res.leaf.domain) {
          const dm = res.leaf.domain;
          resultBox.textContent = `'${name}' exists — owner ${truncateMiddle(dm.owner)} · ${dm.records?.length ?? 0} record(s) · registered ${formatVerifiedAt(Number(dm.registeredAt) || null)}`;
        } else {
          resultBox.textContent = `'${name}' exists on-chain but its record could not be read (${res.leaf.decodeError || 'unknown format'}).`;
        }
      } catch (err) {
        resultBox.classList.remove('hidden');
        resultBox.textContent = err?.message || 'Lookup failed.';
      } finally {
        lookupBtn.disabled = false;
      }
    });

    const lookupSection = h('details', { class: 'name-accordion stack stack-2' }, [
      h('summary', { class: 'hint', text: '🔍 Look up any name on-chain' }),
      h('div', { class: 'name-accordion-body stack stack-2' }, [
        nameField.el,
        rootField.el,
        lookupBtn,
        resultBox,
      ]),
    ]);
    body.appendChild(lookupSection);
  }

  // ---- Registrar leases: register (paid purchase) / renew / claim-expired ----------
  // The section is only as good as the chain says: name.getRegistry decides whether a
  // quoting UI may exist at all on this network, and name.checkLease decides WHICH of
  // the three writes the button may arm. All price/owner/expiry figures below come from
  // parsed chain bytes (registry config + lease account + mint account) — nothing is
  // hard-coded, and a read that cannot be parsed collapses to an honest notice.
  async function renderRegisterSection() {
    const section = h('details', { class: 'name-accordion stack stack-2' }, [
      h('summary', { class: 'hint', text: '📋 Register or renew a .thru lease' }),
    ]);
    const accBody = h('div', { class: 'name-accordion-body stack stack-2' },
      h('div', { class: 'hint', text: 'Reading the chain registry…' }));
    section.appendChild(accBody);
    body.appendChild(section);

    let registry;
    try {
      registry = await bridge.send('name.getRegistry');
    } catch (err) {
      registry = { supported: false, reason: err?.message || 'registry read failed' };
    }
    if (destroyed || !accBody.isConnected) return;
    while (accBody.firstChild) accBody.removeChild(accBody.firstChild);

    if (!registry?.supported || !registry?.registry) {
      accBody.appendChild(h('div', { class: 'notice', text: `Registration is unavailable on this network: ${registry?.reason || 'registry state unreadable'}.` }));
      return;
    }

    // Formatting depth comes from the payment mint's own account (token.readMint). If the
    // mint cannot be read, amounts render as base units and SAY so — decimals are never
    // guessed into a price line.
    const mintInfo = await bridge.send('token.readMint', { mint: registry.registry.tokenMint }).catch(() => null);
    const payment = await bridge.send('name.getPaymentBalance').catch(() => null);
    if (destroyed || !accBody.isConnected) return;

    const decimals = Number(mintInfo?.decimals);
    const canFormat = Number.isInteger(decimals) && decimals >= 0 && decimals <= 30;
    const symbol = mintInfo?.symbol?.trim?.() || 'payment-mint base units';
    const fmt = (raw) => (canFormat ? `${formatUnits(raw, decimals)} ${symbol}` : `${raw} base units of the payment mint`);
    const pricePerYear = BigInt(registry.registry.pricePerYear);

    const nameField = track(Field({ label: 'Name (no dots)', placeholder: 'alice', autocomplete: 'off', onInput: () => resetCheck() }));
    const yearsField = track(Field({ label: 'Years', placeholder: '1', autocomplete: 'off', onInput: () => resetCheck() }));
    const checkLine = h('div', { class: 'hint' });
    const actionBtn = h('button', { type: 'button', class: 'btn primary' }, [icon('globe', 14), h('span')]);
    const actionLabel = () => actionBtn.querySelector('span');

    let pending = null; // { method, label } — armed ONLY by a fresh checkLease read
    function resetCheck() {
      pending = null;
      actionLabel().textContent = ' Check availability';
      checkLine.textContent = 'Enter a name and check it on-chain before anything is signed.';
    }
    function costLine(nameOrMine, years) {
      const cost = pricePerYear * BigInt(years);
      const balance = payment?.exists && payment.amount != null ? BigInt(payment.amount) : null;
      let line = `${nameOrMine} ${years}y → ${fmt(String(cost))}.`;
      if (balance != null) {
        line += ` Balance: ${fmt(String(balance))}${balance < cost ? ' — not enough for this price' : ''}.`;
      } else if (payment?.exists === false) {
        line += ' No payment-token account found for this mint (payments use the registry mint from the chain config).';
      }
      return { line, affordable: balance == null || balance >= cost };
    }
    function yearsValue() {
      const n = Number(String(yearsField.value ?? '').trim());
      return Number.isInteger(n) && n >= 1 && n <= 100 ? n : null;
    }
    async function writeWithPassword(method, name, years) {
      const sendChecked = (extra = {}) => bridge.send(method, { name, years, ...extra });
      const prefs = await bridge.send('settings.get').catch(() => null);
      if (prefs?.requirePasswordForSigning === false) return sendChecked();
      const verb = method === 'name.purchase' ? 'lease purchase' : method === 'name.renewLease' ? 'lease renewal' : 'expired-lease claim';
      return requirePassword({
        title: method === 'name.purchase' ? 'Confirm registration' : method === 'name.renewLease' ? 'Confirm renewal' : 'Confirm claim',
        body: `Re-enter your password to sign and broadcast this ${verb}.`,
        confirmLabel: 'Sign & broadcast',
        verify: (password) => sendChecked({ password }),
      });
    }

    bodyDisposer.on(actionBtn, 'click', async () => {
      banner.set('');
      const name = nameField.value?.trim?.() ?? '';
      if (!name) { nameField.setError('a name is required'); return; }
      const years = yearsValue();
      if (years == null) { yearsField.setError('whole years, 1–100'); return; }
      actionBtn.disabled = true;

      if (!pending) {
        // Phase 1 — fresh on-chain truth decides what the button MAY arm.
        checkLine.textContent = 'Checking the lease account on-chain…';
        try {
          const res = await bridge.send('name.checkLease', { name });
          if (!res?.supported) throw new Error(res?.reason || 'registry reads unsupported on this network');
          const mine = Boolean(res.lease && account?.address && res.lease.owner === account.address);
          if (mine) {
            const { line, affordable } = costLine(`'${name}' is yours — lease ends ${formatChainTime(res.lease.endTime)}. Renewal:`, years);
            checkLine.textContent = line;
            if (affordable) { pending = { method: 'name.renewLease' }; actionLabel().textContent = ' Renew lease'; }
          } else if (res.lease && res.lease.expiredHint === false) {
            checkLine.textContent = `'${name}' is leased by ${truncateMiddle(res.lease.owner)} until ${formatChainTime(res.lease.endTime)} — it is not available.`;
          } else {
            const isClaim = Boolean(res.lease); // expired for someone else
            const { line, affordable } = costLine(`'${name}' is ${isClaim ? 'claimable (previous lease expired)' : 'unregistered'}. ${isClaim ? 'Claim' : 'Registration'}:`, years);
            checkLine.textContent = line;
            if (affordable) {
              pending = { method: isClaim ? 'name.claimExpired' : 'name.purchase' };
              actionLabel().textContent = isClaim ? ' Claim & register' : ' Register';
            }
          }
        } catch (err) {
          checkLine.textContent = err?.message || 'Lease check failed.';
        } finally {
          actionBtn.disabled = false;
        }
        return;
      }

      // Phase 2 — the armed write. Cancel in the password sheet returns null: nothing signed.
      try {
        const result = await writeWithPassword(pending.method, name, years);
        if (!result) { actionBtn.disabled = false; return; }
        toast(`Submitted: ${truncateMiddle(result.signature, 8)}`);
        if (pending.method !== 'name.renewLease') {
          // Best-effort primary-name link; a failed link must not masquerade as a failed registration.
          try {
            primary = await bridge.send('name.linkPrimary', { name, rootAddress: registry.registry.rootRegistrar });
            toast(`'${name}' linked as your primary name.`);
          } catch { /* registration itself is done; the link card above stays available */ }
        }
        await load();
      } catch (err) {
        banner.set(err?.message || 'The write did not go through.');
        actionBtn.disabled = false;
      }
    });

    resetCheck();
    accBody.appendChild(h('div', { class: 'stack stack-2' }, [
      h('div', { class: 'hint', text: `Registry price (from chain config): ${fmt(registry.registry.pricePerYear)} per year · mint ${truncateMiddle(registry.registry.tokenMint)}.` }),
      nameField.el,
      yearsField.el,
      checkLine,
      actionBtn,
    ]));
  }

  function renderUnlinked() {
    clearBody();
    let manualRootVisible = false;
    const nameField = track(Field({
      label: 'Your domain name',
      placeholder: 'e.g. alice',
      autocomplete: 'off',
      hint: 'Letters, numbers, and hyphens (min 3 characters)',
      onEnter: () => linkBtn.click(),
    }));
    // Root is auto-discovered from the pinned candidates, proven on-chain (sdk pins cannot
    // reconstruct it — 2026-10-09 derivation audit). Only if NO candidate parses does the
    // chain force the user to name one — that is what the hidden field is for.
    const rootField = track(Field({
      label: 'Root registrar address',
      placeholder: 'ta… — only needed because no canonical root was found on this network',
      autocomplete: 'off',
      onEnter: () => linkBtn.click(),
    }));
    rootField.el.classList.add('hidden');
    function showManualRoot() {
      manualRootVisible = true;
      rootField.el.classList.remove('hidden');
    }
    const linkBtn = h('button', { type: 'button', class: 'btn primary' }, [icon('globe', 14), h('span', { text: ' Verify on-chain & link' })]);
    bodyDisposer.on(linkBtn, 'click', async () => {
      const name = nameField.value?.trim?.() ?? '';
      const rootAddress = manualRootVisible ? rootField.value?.trim?.() ?? '' : '';
      if (!name) {
        nameField.setError('a name is required');
        return;
      }
      linkBtn.disabled = true;
      banner.set('');
      try {
        primary = await bridge.send('name.linkPrimary', { name, rootAddress });
        toast(`'${primary.name}' verified — linked to active account.`);
        render();
      } catch (err) {
        if (err?.code === 'NAME_ROOT_UNKNOWN' && !manualRootVisible) {
          banner.set(`${err.message || 'No canonical root was found on this network.'} Enter the root registrar your name was minted under.`);
          showManualRoot();
          rootField.focus();
        } else {
          banner.set(err?.message || 'Could not verify that name on-chain.');
        }
      } finally {
        linkBtn.disabled = false;
      }
    });
    body.appendChild(h('div', { class: 'stack stack-2' }, [
      networkEyebrow(),
      h('div', { class: 'notice', text: 'Link a name you own on Thru. Just the name: the wallet finds the chain\u2019s canonical root by itself and proves the domain account\u2019s owner equals your active address before anything is stored.' }),
      nameField.el,
      rootField.el,
      linkBtn,
    ]));
    renderLookupBox();
  }

  function render() {
    clearBody();
    if (primary?.name) {
      renderLinked();
      renderLookupBox();
    } else {
      renderUnlinked();
    }
    // Available on both linked/unlinked bodies: the lease marketplace is network reality,
    // independent of whether a primary name is already recorded locally.
    void renderRegisterSection();
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
    // Re-verification happens INSIDE the backend read: a stored link whose owner changed on
    // chain comes back as null rather than a stale badge.
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
