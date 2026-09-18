// Settings route — including the network switcher.
//
// Exposes backend capability that has existed with no UI: network.list / setActive /
// removeCustom, and system.setAutoLock. Until now the only way to change network was the legacy
// drawer, and custom RPC endpoints were unreachable entirely.
//
// `network.upsertCustom` is deliberately NOT exposed here — see renderCustomNetworkNotice for
// the reasoning and the four preconditions for bringing it back. The backend method stays (the
// contract is append-only); the UI does not offer it.
//
// The network section is deliberately first. Once mainnet exists, "which chain am I on" is the
// most consequential setting in the wallet.

import { h, disposer } from '../../kit/dom.js';
import { icon } from '../../kit/icon.js';
import { Button } from '../../kit/button.js';
import { PageHeader, Banner, Spinner } from '../../kit/feedback.js';
import { requirePassword } from '../../domain/password-prompt.js';
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
  let preferences = null;

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

  // ---- Custom networks: deliberately not offered --------------------------
  /**
   * Why there is no "Add custom network" control here.
   *
   * `network.upsertCustom` accepts any `http(s)` endpoint, but the manifest CSP allows
   * `connect-src` only to the Thru RPC hosts plus localhost, so most networks a user could save
   * were unreachable the moment they were saved — the row appeared in the list, selected fine,
   * and every call failed. The network service also falls back to the DEFAULT transfer/token
   * program IDs for a custom network, which is only correct on a chain that is program-for-program
   * equivalent to the built-ins; on any other network the wallet would construct transactions
   * against the wrong programs. Tracked as the P0 custom-network decision in
   * docs/PROJECT_LEDGER.md and item 3 of the remediation plan in docs/AUDIT_REPORT.md.
   *
   * Re-enabling this needs all four, designed and tested, not just the form back:
   *   1. an HTTPS-only policy with an explicit localhost exception;
   *   2. narrow, user-granted host permission for the one endpoint (optional_host_permissions),
   *      because a CSP that allows every host is worse than no custom networks;
   *   3. a verified capability record per network (chain id, program addresses actually present)
   *      instead of silent defaults, with read-only mode until transaction semantics are verified;
   *   4. an explicit warning plus password re-authentication before the wallet talks to a
   *      user-supplied endpoint.
   *
   * Networks added BEFORE this are still listed above and can still be removed or switched away
   * from. Hiding them would strand a user on a network they cannot leave, which is worse than the
   * defect being fixed.
   */
  function renderCustomNetworkNotice(hostEl) {
    hostEl.appendChild(h('p', { class: 'hint', text:
      'Adding a custom network is temporarily unavailable. Before this wallet will build '
      + 'transactions against an endpoint you supply, that endpoint has to be reachable under the '
      + 'security policy of this extension, and its chain programs have to be verified rather than '
      + 'assumed. Networks you already saved stay listed above and can still be removed.' }));
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
        if (minutes === current) return;
        const result = await requirePassword({
          title: minutes === 0 ? 'Disable auto-lock?' : 'Change auto-lock?',
          body: minutes === 0
            ? 'Enter your password to set auto-lock to Never. This keeps the wallet unlocked until you lock it or the browser closes.'
            : `Enter your password to lock the wallet after ${label} of inactivity.`,
          confirmLabel: minutes === 0 ? 'Set to Never' : 'Update auto-lock',
          danger: minutes === 0,
          verify: (password) => bridge.send('system.setAutoLock', { minutes, password }),
        });
        if (result) load();
      });
      return chip;
    });

    hostEl.appendChild(h('p', { class: 'hint', text:
      'The wallet locks after this much inactivity. "Never" keeps it unlocked until the '
      + 'browser closes.' }));
    hostEl.appendChild(h('div', { class: 'row-flex wrap' }, chips));
  }

  function renderSigningReauth(hostEl, requirePasswordForSigning) {
    hostEl.appendChild(h('p', { class: 'hint', text:
      'Recommended: require the wallet password before any transaction is signed. Turning this off '
      + 'allows signing from an already-unlocked session.' }));

    const options = [
      { value: true, label: 'Require password' },
      { value: false, label: 'Session-only' },
    ];
    const chips = options.map((option) => {
      const selected = option.value === requirePasswordForSigning;
      const chip = h('button', {
        type: 'button',
        class: ['chip-option', selected ? 'selected' : null].filter(Boolean),
        text: option.label,
      });
      if (!selected) {
        d.on(chip, 'click', async () => {
          banner.clear();
          const result = await requirePassword({
            title: option.value ? 'Require password for signing' : 'Disable signing password prompt',
            body: option.value
              ? 'Enter your password to require re-authentication before every signing action.'
              : 'Enter your password to allow transaction signing from an unlocked session. This is less secure.',
            confirmLabel: option.value ? 'Require password' : 'Allow session-only signing',
            danger: option.value === false,
            verify: (password) => bridge.send('settings.setSecurity', {
              patch: { requirePasswordForSigning: option.value },
              password,
            }),
          });
          if (result) load();
        });
      }
      return chip;
    });
    hostEl.appendChild(h('div', { class: 'row-flex wrap' }, chips));
  }

  // ---- Side panel ---------------------------------------------------------
  //
  // The manifest declares `side_panel.default_path: popup.html`, so the panel runs this exact UI —
  // but until now nothing in the app could open it. The only way in was the browser's own menu,
  // which no user finds, so the declared panel was unreachable from the wallet itself.
  //
  // Two things this deliberately does NOT do:
  //   - no `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`. That replaces the
  //     toolbar popup with the panel for every user — a behaviour change that needs real browser
  //     testing before anyone opts users into it, and it is not needed for an explicit action.
  //   - no manifest, permission or panel-path change.
  //
  // `sidePanel.open()` only works from a user gesture and only on Chromium 116+, so the windowId is
  // fetched during load(): awaiting inside the click handler can cost the gesture and make the call
  // fail for a reason that has nothing to do with the user's browser.
  let sidePanelWindowId = null;

  function prepareSidePanel() {
    try {
      if (!chrome.sidePanel?.open || !chrome.windows?.getCurrent) return;
      Promise.resolve(chrome.windows.getCurrent())
        .then((win) => { if (win?.id != null) sidePanelWindowId = win.id; })
        .catch(() => {});
    } catch {
      // Not in an extension context, or a browser without the API: the button says so on click.
    }
  }

  function openSidePanel() {
    banner.clear();
    if (!chrome.sidePanel?.open) {
      banner.set('This browser has no side panel API. The popup keeps working as usual.', 'warning');
      return;
    }
    const fallback = 'Could not open the side panel. Use the wallet icon in the toolbar instead.';
    try {
      const result = chrome.sidePanel.open(
        sidePanelWindowId != null ? { windowId: sidePanelWindowId } : {},
      );
      // Chromium returns a promise; the usual rejections are "no user gesture" and "either tabId or
      // windowId must be specified". Both are reported rather than swallowed.
      Promise.resolve(result).catch((error) => {
        banner.set(error?.message || fallback, 'warning');
      });
    } catch (error) {
      banner.set(error?.message || fallback, 'warning');
    }
  }

  async function load() {
    banner.clear();
    try {
      const [netList, active, autoLock, prefs] = await Promise.all([
        bridge.send('network.list'),
        bridge.send('network.getActive'),
        bridge.send('system.getAutoLock'),
        bridge.send('settings.get'),
      ]);
      networks = netList || [];
      activeNetworkId = active?.id || null;
      preferences = prefs || {};
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
    renderCustomNetworkNotice(networkSection);

    // ---- Security ----
    const security = h('section', { class: 'stack stack-2' }, [SectionHeader('Security')]);
    body.appendChild(security);
    security.appendChild(h('strong', { text: 'Signing' }));
    renderSigningReauth(security, preferences?.requirePasswordForSigning !== false);
    security.appendChild(h('strong', { text: 'Auto-lock' }));
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

    // ---- Window ----
    body.appendChild(h('section', { class: 'stack stack-2' }, [
      SectionHeader('Window'),
      h('p', { class: 'hint', text:
        'Open the same wallet beside your browser tab. The popup and the side panel share one '
        + 'session, so locking in one locks both.' }),
      track(Button({
        label: 'Open side panel',
        variant: 'secondary',
        iconName: 'external',
        onClick: () => openSidePanel(),
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
  prepareSidePanel();
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
