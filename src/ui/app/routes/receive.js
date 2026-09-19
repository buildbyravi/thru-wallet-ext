// Receive route — address, QR, and explorer link.
//
// Replaces screens/receive.js. Same information, three fixes:
//   - the address was interpolated into innerHTML; it is now a text node
//   - explorerAddressUrl returns '' on a network with no explorer (localnet), so the link is
//     omitted rather than rendered dead
//   - the network is named explicitly. An address is only meaningful on the chain it is on, and
//     "which network is this for" is the question a receive screen must answer.
//   - the QR renders raised in the Thru palette (qr.js); the canvas carries an accessible name
//   - a second, hidden CopyButton sat dead in the DOM ("for keyboard users" — but .hidden is
//     display:none, so it reached nobody). Removed entirely later, when the address box
//     itself became the copy affordance (click copies, box confirms inline).

import { h, disposer } from '../../kit/dom.js';
import { icon } from '../../kit/icon.js';
import { PageHeader, Banner, Spinner } from '../../kit/feedback.js';
import { AccountAvatar } from '../../domain/account-avatar.js';
import { renderQR } from '../../../popup/qr.js';
import * as bridge from '../bridge.js';

export function ReceiveRoute({ back }) {
  const d = disposer();
  const owned = [];
  let account = null;
  let network = null;

  function track(c) { owned.push(c); return c; }

  const banner = Banner({ tone: 'error' });
  const body = h('div', { class: 'stack stack-4' }, Spinner({ label: 'Loading' }).el);
  let copyTimer = null;
  let removeAddressCopy = null;
  const header = PageHeader({ title: 'Receive', onBack: () => back() });
  const el = h('section', { class: 'screen' }, [header.el, banner.el, body]);

  function clearBody() {
    if (copyTimer) { clearTimeout(copyTimer); copyTimer = null; }
    if (removeAddressCopy) { removeAddressCopy(); removeAddressCopy = null; }
    for (const c of owned) c.destroy?.();
    owned.length = 0;
    while (body.firstChild) body.removeChild(body.firstChild);
  }

  function render() {
    clearBody();

    const canvas = h('canvas', {
      width: 200,
      height: 200,
      role: 'img',
      'aria-label': 'QR code of your receive address',
    });
    body.appendChild(h('div', { class: 'qr-container' }, canvas));

    // Canvas drawing only — no network fetch, no third-party image.
    try {
      renderQR(canvas, account.address);
    } catch (error) {
      banner.set('Could not render the QR code. The address below is still correct.', 'warning');
    }

    body.appendChild(h('div', { class: 'row-flex center' }, [
      AccountAvatar({ address: account.address, imported: account.keyring?.type === 'privateKey' }),
      h('div', {}, [
        h('div', { class: 'row-title center', text: account.label || 'Account' }),
        h('div', { class: 'hint center', text: account.keyring?.label || '' }),
      ]),
    ]));

    body.appendChild(h('p', { class: 'muted center', text:
      `Send only THRU on ${network?.label || 'this network'} to this address.` }));

    // Full address, never truncated — and the address box IS the copy affordance:
    // click/tap/Enter copies it and the box confirms inline ("Copied") for ~1s
    // before returning to the address. One surface for the one thing an address
    // is for, instead of address + separate button duplicating each other.
    const addrText = h('span', { class: 'copy-address-text', text: account.address });
    const addressBox = h('button', {
      type: 'button',
      class: 'monospace-block copy-address',
      'aria-label': `Copy address: ${account.address}`,
    }, [addrText, icon('copy', 14)]);
    body.appendChild(addressBox);

    // Raw listeners are bound to the box's own lifetime (clearBody), not the route's —
    // a re-rendered box that outlives its listener would be a detached-listener leak.
    const onAddressClick = async () => {
      try {
        await navigator.clipboard.writeText(account.address);
      } catch {
        banner.set('Could not copy — clipboard permission denied.');
        return;
      }
      addrText.textContent = 'Copied';
      addressBox.setAttribute('aria-label', 'Address copied to clipboard');
      addressBox.classList.add('copied');
      if (copyTimer) clearTimeout(copyTimer);
      copyTimer = setTimeout(() => {
        addrText.textContent = account.address;
        addressBox.setAttribute('aria-label', `Copy address: ${account.address}`);
        addressBox.classList.remove('copied');
      }, 1100);
    };
    addressBox.addEventListener('click', onAddressClick);
    removeAddressCopy = () => addressBox.removeEventListener('click', onAddressClick);

    const actions = [];

    // '' when the network declares no explorer, in which case no link is shown at all.
    const explorer = network?.explorerUrl ? `${network.explorerUrl}/account/${account.address}` : '';
    if (explorer) {
      actions.push(h('a', {
        class: 'btn secondary',
        href: explorer,
        target: '_blank',
        rel: 'noopener noreferrer',
      }, [icon('external', 14), h('span', { text: 'View on explorer' })]));
    }

    body.appendChild(h('div', { class: 'stack stack-2' }, actions));
  }

  async function load() {
    banner.clear();
    try {
      const [active, net] = await Promise.all([
        bridge.send('account.getActive'),
        bridge.send('network.getActive'),
      ]);
      account = active;
      network = net;
      render();
    } catch (error) {
      clearBody();
      banner.set(error.message || 'Could not load your address.');
    }
  }

  load();
  d.add(bridge.onEvent('accountsChanged', () => load()));

  return {
    el,
    destroy() {
      if (copyTimer) clearTimeout(copyTimer);
      if (removeAddressCopy) removeAddressCopy();
      for (const c of owned) c.destroy?.();
      owned.length = 0;
      header.destroy();
      banner.destroy();
      d.dispose();
    },
  };
}
