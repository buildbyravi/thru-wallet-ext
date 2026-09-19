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
//     display:none, so it reached nobody). Removed; the wide copy button is the affordance.

import { h, disposer } from '../../kit/dom.js';
import { icon } from '../../kit/icon.js';
import { Button } from '../../kit/button.js';
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
  const header = PageHeader({ title: 'Receive', onBack: () => back() });
  const el = h('section', { class: 'screen' }, [header.el, banner.el, body]);

  function clearBody() {
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

    // Full address, never truncated: this is the value being copied. The
    // .monospace-block class already breaks anywhere — no per-instance styles.
    body.appendChild(h('div', { class: 'monospace-block', text: account.address }));

    const copyWide = track(Button({
      label: 'Copy address',
      variant: 'secondary',
      iconName: 'copy',
      onClick: async () => {
        try {
          await navigator.clipboard.writeText(account.address);
          copyWide.update({ label: 'Copied' });
          setTimeout(() => copyWide.update({ label: 'Copy address' }), 1200);
        } catch {
          banner.set('Could not copy — clipboard permission denied.');
        }
      },
    }));

    const actions = [copyWide.el];

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
      for (const c of owned) c.destroy?.();
      owned.length = 0;
      header.destroy();
      banner.destroy();
      d.dispose();
    },
  };
}
