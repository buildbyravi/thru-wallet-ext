// Receive: one captured account/network pair for the displayed, copied and encoded address.
import { h, disposer } from '../../kit/dom.js';
import { icon } from '../../kit/icon.js';
import { CopyButton } from '../../kit/button.js';
import { PageHeader, Banner, Spinner } from '../../kit/feedback.js';
import { AccountAvatar } from '../../domain/account-avatar.js';
import { renderQR } from '../../../popup/qr.js';
import { explorerAddressUrl } from '../../../shared/format.js';
import * as bridge from '../bridge.js';

export function ReceiveRoute({ back }) {
  const d = disposer();
  const banner = Banner();
  const body = h('div', { class: 'stack stack-3' });
  const header = PageHeader({ title: 'Receive', onBack: () => back() });
  const el = h('section', { class: 'screen' }, [header.el, banner.el, body]);
  let copy;
  let revision = 0;

  function clear() {
    copy?.destroy();
    copy = null;
    body.replaceChildren();
    banner.clear();
  }

  function render(account, network) {
    const { address } = account;
    const name = account.label || 'Account';
    const networkName = network.label || network.id;
    const canvas = h('canvas', { role: 'img', 'aria-label': `Receive address QR code for ${name} on ${networkName}` });
    let qrTile;
    try {
      renderQR(canvas, address);
      qrTile = h('div', { class: 'receive-qr' }, canvas);
    } catch {
      banner.set('Could not render the QR code. Copy the address below instead.', 'warning');
    }

    const copyStatus = h('p', { class: 'receive-copy-status hint', role: 'status' });
    copy = CopyButton({
      title: 'Copy address',
      getValue: address,
      onResult: (error) => {
        copyStatus.textContent = error ? 'Could not copy. Select the address to copy it manually.' : 'Address copied';
      },
    });
    const registration = h('p', { class: 'notice warning hidden', role: 'status' });
    const explorer = explorerAddressUrl(network, address);

    body.replaceChildren(...[
      h('div', { class: 'receive-network' }, [icon('globe', 16), h('span', { text: `Receiving on ${networkName}` })]),
      registration,
      qrTile,
      h('div', { class: 'row-flex center' }, [
        AccountAvatar({ address, imported: account.keyring?.type === 'privateKey' }),
        h('div', { class: 'row-title', text: name }),
      ]),
      h('div', { class: 'stack stack-1' }, [
        h('div', { class: 'receive-address' }, [h('code', { text: address }), copy.el]),
        copyStatus,
      ]),
      h('p', { class: 'hint center', text: `Use this address for native THRU on ${networkName}. Check the network before sending.` }),
      explorer ? h('a', {
        class: 'btn secondary', href: explorer, target: '_blank', rel: 'noopener noreferrer',
      }, [icon('external', 14), h('span', { text: 'View on explorer' })]) : null,
    ].filter(Boolean));
    return registration;
  }

  async function load() {
    const current = ++revision;
    clear();
    body.appendChild(Spinner({ label: 'Loading receive address' }).el);
    try {
      const [account, network] = await Promise.all([
        bridge.send('account.getActive'),
        bridge.send('network.getActive'),
      ]);
      if (current !== revision) return;
      if (!account?.address || !network?.id) throw new Error('Could not load the active account and network.');
      const registration = render(account, network);
      // Chain state is advisory and must never hold the address or QR behind RPC.
      void bridge.send('tx.getAccountInfo', { address: account.address }).then((info) => {
        if (current !== revision || info?.exists !== false) return;
        registration.textContent = 'This account is not registered yet and cannot receive native THRU until it is registered.';
        registration.classList.remove('hidden');
      }).catch(() => {});
    } catch (error) {
      if (current !== revision) return;
      clear();
      banner.set(error.message || 'Could not load your receive address.', 'error');
    }
  }

  d.add(bridge.onEvents({ accountsChanged: load, networkChanged: load }));
  load();
  return {
    el,
    destroy() {
      ++revision;
      d.dispose();
      clear();
      header.destroy();
      banner.destroy();
    },
  };
}
