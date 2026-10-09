// Domain route — the wallet's primary-name screen (2026-10-09, owner-directed UX slice).
//
// A first-class screen behind the dashboard's Domain tile, in the same family as
// Send/Receive/History. What it does:
//   - shows the verified primary name for the active account on the active network
//     (re-verified against the chain on every mount by the backend)
//   - lets you LINK a name you own: you type the name + root registrar, the backend resolves
//     the domain account and only stores the link when its owner field IS your active
//     address — a name someone else owns is refused, never displayed
//   - lets you unlink, and look up ANY name honestly (exists / owner / records / registered)
//
// Nothing on this screen signs or writes to the chain (name.register/setRecord stay gated
// behind FLAGS.NAME_SERVICE until the live probe verifies the recovered wire formats). The
// chain has no reverse index, so "your name" always begins as user input the wallet then
// proves — that asymmetry is stated plainly on the empty state, not hidden.
import { h, disposer } from '../../kit/dom.js';
import { icon } from '../../kit/icon.js';
import { PageHeader, Banner, Spinner } from '../../kit/feedback.js';
import { Field } from '../../kit/field.js';
import { toast } from '../../kit/toast.js';
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

export function NameRoute({ back }) {
  const d = disposer();
  const owned = [];
  let account = null;
  let network = null;
  let primary = null;
  let destroyed = false;

  function track(c) { owned.push(c); return c; }

  const banner = Banner({ tone: 'error' });
  const body = h('div', { class: 'stack stack-4' }, Spinner({ label: 'Loading' }).el);
  const header = PageHeader({ title: 'Domain', onBack: () => back() });
  const el = h('section', { class: 'screen' }, [header.el, banner.el, body]);

  function clearBody() {
    for (const c of owned) c.destroy?.();
    owned.length = 0;
    while (body.firstChild) body.removeChild(body.firstChild);
  }

  function networkEyebrow() {
    return h('div', { class: 'eyebrow', text: `Network: ${network?.label || network?.id || 'loading…'}` });
  }

  function detailRow(label, value, mono = true) {
    return h('div', { class: 'detail-row' }, [
      h('div', { class: 'detail-val', text: label }),
      h('div', { class: mono ? 'detail-val mono' : 'detail-val', text: value }),
    ]);
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
        detailRow('Linked account', truncateMiddle(account?.address)),
        detailRow('Domain address', truncateMiddle(primary.domainAddress)),
        detailRow('Root registrar', truncateMiddle(primary.rootAddress)),
        detailRow('Verified on-chain', formatVerifiedAt(primary.verifiedAt), false),
      ]),
      h('div', { class: 'row-flex' }, [
        h('span', { class: 'hint', text: 'Ownership is re-checked against the chain every time this screen opens. If the owner changes, this badge disappears.' }),
      ]),
      h('div', { class: 'screen-actions' }, [
        track(h('button', {
          type: 'button', class: 'btn secondary',
        }, [icon('refresh', 14), h('span', { text: ' Re-verify' })])),
        track(h('button', {
          type: 'button', class: 'btn secondary',
        }, [icon('trash', 14), h('span', { text: ' Unlink' })])),
      ]),
    ]);
    body.appendChild(card);
    const [reverifyBtn, unlinkBtn] = owned.slice(-2);
    d.on(reverifyBtn, 'click', () => { void load(); });
    d.on(unlinkBtn, 'click', async () => {
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
    const resultBox = h('div', { class: 'notice', text: '' });
    resultBox.classList.add('hidden');
    const lookupBtn = h('button', { type: 'button', class: 'btn secondary' }, [icon('search', 14), h('span', { text: ' Look up on-chain' })]);
    d.on(lookupBtn, 'click', async () => {
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
    body.appendChild(h('div', { class: 'stack stack-2' }, [
      h('div', { class: 'eyebrow', text: 'Look up any name' }),
      nameField.el,
      rootField.el,
      lookupBtn,
      resultBox,
    ]));
  }

  function renderUnlinked() {
    clearBody();
    let manualRootVisible = false;
    const nameField = track(Field({
      label: 'Your name',
      placeholder: 'e.g. alice',
      autocomplete: 'off',
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
    d.on(linkBtn, 'click', async () => {
      const name = nameField.value?.trim?.() ?? '';
      const rootAddress = manualRootVisible ? rootField.value?.trim?.() ?? '' : '';
      if (!name) {
        nameField.setError('required');
        return;
      }
      linkBtn.disabled = true;
      banner.set('');
      try {
        primary = await bridge.send('name.linkPrimary', { name, rootAddress });
        toast(`'${primary.name}' verified — you own it.`);
        clearBody();
        renderLinked();
        renderLookupBox();
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
      h('div', { class: 'notice', text: 'Link a name you own on Thru and it shows here and on your identity. Just the name: the wallet finds the chain\u2019s canonical root by itself and proves the domain account\u2019s owner equals your active address before anything is stored.' }),
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
      primary = null; // unreadable right now — empty state with explanation, not a lie
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
