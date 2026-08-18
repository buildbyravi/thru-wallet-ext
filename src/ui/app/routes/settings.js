// Settings route — including the network switcher.
//
// Exposes backend capability that has existed with no UI: network.list / setActive /
// upsertCustom / removeCustom, and system.setAutoLock. Until now the only way to change
// network was the legacy drawer, and custom RPC endpoints were unreachable entirely.
//
// The network section is deliberately first. Once mainnet exists, "which chain am I on" is the
// most consequential setting in the wallet.

import { h, disposer } from '../../kit/dom.js';
import { icon } from '../../kit/icon.js';
import { Button } from '../../kit/button.js';
import { Field } from '../../kit/field.js';
import { PageHeader, Banner, Spinner } from '../../kit/feedback.js';
import * as bridge from '../bridge.js';
import { AUTO_LOCK_CHOICES } from '../../../shared/autolock.js';

function SectionHeader(text) {
  return h('header', { class: 'list-group-header' }, h('span', { text }));
}

export function SettingsRoute({ navigate, back }) {
  const d = disposer();
  const owned = [];
  let networks = [];
  let activeNetworkId = null;

  const banner = Banner({ tone: 'error' });
  const body = h('div', { class: 'stack stack-5' }, Spinner({ label: 'Loading settings' }).el);
  const header = PageHeader({ title: 'Settings', onBack: () => back() });
  const el = h('section', { class: 'screen' }, [header.el, banner.el, body]);

  function track(c) { owned.push(c); return c; }
  function clearBody() {
    for (const c of owned) c.destroy?.();
    owned.length = 0;
    while (body.firstChild) body.removeChild(body.firstChild);
  }

  // ---- Network rows -------------------------------------------------------
  function networkRow(network) {
    const isActive = network.id === activeNetworkId;
    const isLive = network.isTestnet === false;

    const children = [
      h('span', { class: ['status-dot', isActive ? 'healthy' : 'muted'].filter(Boolean) }),
      h('span', { class: 'row-body' }, [
        h('span', { class: 'row-flex', style: { gap: '6px' } }, [
          h('span', { class: 'row-title', text: network.label || network.id }),
          isLive ? h('span', { class: 'tag-accent', text: 'live' }) : null,
          network.custom ? h('span', { class: 'badge', text: 'custom' }) : null,
        ]),
        h('span', { class: 'row-sub', text: network.rpcUrl || '—' }),
      ]),
    ];

    if (isActive) {
      children.push(h('span', { class: 'row-value' }, icon('check', 14)));
    }

    const row = h('button', {
      type: 'button',
      class: ['row', isActive ? 'active' : null].filter(Boolean),
      'aria-current': isActive ? 'true' : null,
    }, children);

    if (!isActive) {
      d.on(row, 'click', async () => {
        banner.clear();
        try {
          await bridge.send('network.setActive', { networkId: network.id });
          // Balances, tokens and pending transactions are all per-network, so the whole
          // wallet view changes. Going back to the dashboard makes that obvious rather than
          // leaving the user on a settings screen wondering whether it took effect.
          navigate('/dashboard');
        } catch (error) {
          banner.set(error.message || 'Could not switch network.');
        }
      });
    }

    const wrap = h('div', { class: 'row-flex' }, [row]);

    if (network.custom) {
      const removeBtn = h('button', {
        type: 'button',
        class: 'icon-btn icon-btn-ghost sm danger-hover',
        title: `Remove ${network.label || network.id}`,
        'aria-label': `Remove ${network.label || network.id}`,
      }, icon('trash', 13));
      d.on(removeBtn, 'click', async () => {
        banner.clear();
        try {
          await bridge.send('network.removeCustom', { networkId: network.id });
          load();
        } catch (error) {
          banner.set(error.message || 'Could not remove that network.');
        }
      });
      wrap.appendChild(removeBtn);
    }

    return wrap;
  }

  // ---- Add a custom RPC ---------------------------------------------------
  function renderAddCustom(hostEl) {
    const idField = track(Field({
      label: 'Network id',
      placeholder: 'my-devnet',
      hint: 'Letters, numbers and dashes. Cannot replace a built-in network.',
      maxLength: 32,
    }));
    const nameField = track(Field({ label: 'Display name', placeholder: 'My devnet', maxLength: 32 }));
    const rpcField = track(Field({ label: 'RPC URL', type: 'url', placeholder: 'http://127.0.0.1:8899' }));
    const explorerField = track(Field({
      label: 'Explorer URL (optional)',
      type: 'url',
      placeholder: 'https://…',
      hint: 'Leave empty and explorer links are hidden rather than broken.',
    }));

    const saveBtn = track(Button({
      label: 'Add network',
      variant: 'secondary',
      iconName: 'plus',
      onClick: async () => {
        banner.clear();
        const id = idField.value.trim();
        const rpcUrl = rpcField.value.trim();
        if (!id) { idField.setError('An id is required.'); return; }
        if (!rpcUrl) { rpcField.setError('An RPC URL is required.'); return; }
        try {
          await bridge.send('network.upsertCustom', {
            id,
            name: nameField.value.trim() || id,
            rpcUrl,
            explorerUrl: explorerField.value.trim(),
            environment: 'devnet',
          });
          load();
        } catch (error) {
          // The background validates the id and both URLs, so surface its message rather
          // than duplicating the rules here and letting the two drift apart.
          banner.set(error.message || 'Could not add that network.');
        }
      },
    }));

    const form = h('div', { class: ['stack', 'stack-3', 'hidden'] }, [
      idField.el, nameField.el, rpcField.el, explorerField.el, saveBtn.el,
    ]);

    const toggle = track(Button({
      label: 'Add custom network',
      variant: 'text',
      iconName: 'plus',
      onClick: () => {
        const hidden = form.classList.toggle('hidden');
        toggle.update({ label: hidden ? 'Add custom network' : 'Cancel' });
      },
    }));

    hostEl.appendChild(toggle.el);
    hostEl.appendChild(form);
  }

  // ---- Auto-lock ----------------------------------------------------------
  function renderAutoLock(hostEl, current) {
    const chips = AUTO_LOCK_CHOICES.map((minutes) => {
      const label = minutes === 0 ? 'Never' : minutes < 60 ? `${minutes} min` : `${minutes / 60} hr`;
      const chip = h('button', {
        type: 'button',
        class: ['chip-option', minutes === current ? 'selected' : null].filter(Boolean),
        text: label,
      });
      d.on(chip, 'click', async () => {
        banner.clear();
        try {
          await bridge.send('system.setAutoLock', { minutes });
          load();
        } catch (error) {
          banner.set(error.message || 'Could not change the auto-lock setting.');
        }
      });
      return chip;
    });

    hostEl.appendChild(h('p', { class: 'hint', text:
      'The wallet locks after this much inactivity. "Never" keeps it unlocked until the '
      + 'browser closes.' }));
    hostEl.appendChild(h('div', { class: 'row-flex wrap' }, chips));
  }

  async function load() {
    banner.clear();
    try {
      const [netList, active, autoLock] = await Promise.all([
        bridge.send('network.list'),
        bridge.send('network.getActive'),
        bridge.send('system.getAutoLock'),
      ]);
      networks = netList || [];
      activeNetworkId = active?.id || null;
      render(autoLock);
    } catch (error) {
      clearBody();
      banner.set(error.message || 'Could not load settings.');
    }
  }

  function render(autoLockMinutes) {
    clearBody();

    // ---- Networks ----
    const networkSection = h('section', { class: 'stack stack-2' }, [
      SectionHeader('Network'),
      h('div', { class: 'list' }, networks.map(networkRow)),
    ]);
    body.appendChild(networkSection);
    renderAddCustom(networkSection);

    // ---- Security ----
    const security = h('section', { class: 'stack stack-2' }, [SectionHeader('Auto-lock')]);
    body.appendChild(security);
    renderAutoLock(security, Number(autoLockMinutes));

    // ---- Accounts shortcut ----
    body.appendChild(h('section', { class: 'stack stack-2' }, [
      SectionHeader('Accounts'),
      track(Button({
        label: 'Manage accounts and recovery phrases',
        variant: 'secondary',
        iconName: 'wallet',
        onClick: () => navigate('/accounts'),
      })).el,
    ]));

    // ---- Danger ----
    body.appendChild(h('section', { class: 'stack stack-2' }, [
      SectionHeader('Danger zone'),
      track(Button({
        label: 'Reset wallet on this device',
        variant: 'danger',
        iconName: 'warning',
        onClick: () => navigate('/reset'),
      })).el,
    ]));

    // ---- About ----
    // Read from the manifest so it can never drift from the shipped version, unlike the
    // hardcoded 'v0.1.0' the legacy settings screen showed against a 1.2.0 manifest.
    let version = '—';
    try {
      version = chrome.runtime.getManifest().version;
    } catch {
      // not in an extension context
    }
    body.appendChild(h('section', { class: 'stack stack-2' }, [
      SectionHeader('About'),
      h('div', { class: 'detail-table' }, [
        h('div', { class: 'detail-row' }, [
          h('span', { class: 'eyebrow', text: 'Version' }),
          h('div', { class: 'detail-val mono', text: version }),
        ]),
        h('div', { class: 'detail-row' }, [
          h('span', { class: 'eyebrow', text: 'Networks' }),
          h('div', { class: 'detail-val', text: `${networks.length} available` }),
        ]),
      ]),
    ]));
  }

  load();
  d.add(bridge.onEvent('networkChanged', () => load()));

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
