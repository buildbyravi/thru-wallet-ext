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
import { HelpTooltip } from '../../kit/help-tooltip.js';
import { requirePassword } from '../../domain/password-prompt.js';
import * as bridge from '../bridge.js';
import { getTheme, setTheme } from '../../../popup/theme.js';
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
  let theme = 'system';

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
    // Contract v7: a saved custom network remains visible and removable, but can never become the
    // active network. The background enforces this too; rendering an inert row avoids presenting an
    // action that can only fail.
    const selectable = !network.custom && network.selectable !== false;

    const children = [
      h('span', { class: ['status-dot', isActive ? 'healthy' : 'muted'].filter(Boolean) }),
      h('span', { class: 'row-body' }, [
        h('span', { class: 'row-flex', style: { gap: '6px' } }, [
          h('span', { class: 'row-title', text: network.label || network.id }),
          isLive ? h('span', { class: 'tag-accent', text: 'live' }) : null,
          network.custom ? h('span', { class: 'badge', text: 'custom' }) : null,
          network.custom ? h('span', { class: 'tag-warning', text: 'not selectable' }) : null,
        ]),
        h('span', { class: 'row-sub', text: network.rpcUrl || '—' }),
        network.custom
          ? h('span', {
            class: 'row-sub',
            // The service supplies the same sentence used by its direct-call refusal. The fallback
            // keeps this UI safe while an older service worker is still winding down after update.
            text: network.unselectableReason
              || 'Cannot be selected: the wallet will not sign against an unverified endpoint.',
          })
          : null,
      ]),
    ];

    if (isActive) {
      children.push(h('span', { class: 'row-value' }, icon('check', 14)));
    }

    const row = selectable
      ? h('button', {
        type: 'button',
        class: ['row', isActive ? 'active' : null].filter(Boolean),
        'aria-current': isActive ? 'true' : null,
      }, children)
      : h('div', { class: 'row', 'aria-disabled': 'true' }, children);

    if (selectable && !isActive) {
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
   * Networks added BEFORE this are still listed above and can still be removed. They can no longer
   * be SELECTED: since contract v7 the background refuses `network.setActive` for a custom id and
   * self-heals a legacy stored selection to the default network before the RPC client is bound.
   * Hiding the rows instead would strand a user with a record they cannot delete.
   */
  function renderCustomNetworkNotice(hostEl) {
    hostEl.appendChild(h('p', { class: 'hint', text:
      'Adding a custom network is temporarily unavailable. Before this wallet will build '
      + 'transactions against an endpoint you supply, that endpoint has to be reachable under the '
      + 'security policy of this extension, and its chain programs have to be verified rather than '
      + 'assumed. For the same reason a network you saved earlier stays listed but cannot be '
      + 'selected; the wallet uses a built-in network and you can remove the saved one here.' }));
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

    // The explanation is the (?) popover on the "Auto-lock" row above.
    hostEl.appendChild(h('div', { class: 'row-flex wrap' }, chips));
  }

  function renderSigningReauth(hostEl, requirePasswordForSigning) {
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


  // ---- Appearance ------------------------------------------------------
  // Theme is popup-local rendering state (popup/theme.js), not a backend or
  // security decision: no password gate, no bridge call, no load() round-trip.
  function themeChips() {
    const options = [
      { value: 'light', label: 'Light' },
      { value: 'dark', label: 'Dark' },
      { value: 'system', label: 'System' },
    ];
    const chips = options.map((option) => {
      const selected = option.value === theme;
      const chip = h('button', {
        type: 'button',
        class: ['chip-option', selected ? 'selected' : null].filter(Boolean),
        text: option.label,
      });
      d.on(chip, 'click', async () => {
        banner.clear();
        theme = option.value;
        await setTheme(option.value).catch(() => {});
        // Reflow the selected state by identity — never by DOM position.
        options.forEach((o, i) => chips[i].classList.toggle('selected', o.value === theme));
      });
      return chip;
    });
    return chips;
  }

  // ---- Side Panel Mode ------------------------------------------------------
  //
  // An explicit opt-in: when ON, clicking the wallet toolbar icon opens the side panel
  // instead of the popup. It is the only chrome.sidePanel.setPanelBehavior call in the UI,
  // and it fires only on this toggle's click — never at boot, never behind the user.
  // (The background re-applies the stored choice on worker restart so the setting survives
  // service-worker eviction; see src/background/index.js.)
  //
  // The redundant "Open side panel" button that lived here is gone: the dashboard header
  // carries the explicit open action, and this section only owns the MODE.
  let sidePanelMode = false;

  async function load() {
    banner.clear();
    try {
      const [netList, active, autoLock, prefs, panelStored] = await Promise.all([
        bridge.send('network.list'),
        bridge.send('network.getActive'),
        bridge.send('system.getAutoLock'),
        bridge.send('settings.get'),
        chrome.storage?.local?.get ? chrome.storage.local.get('thru_side_panel_mode').catch(() => null) : null,
      ]);
      networks = netList || [];
      activeNetworkId = active?.id || null;
      preferences = prefs || {};
      sidePanelMode = Boolean(panelStored?.thru_side_panel_mode);
      theme = await getTheme().catch(() => 'system');
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
    // The explanation lives in a (?) in-wallet popover (kit/help-tooltip.js), not a
    // paragraph of small print and not the native title tooltip — the browser owns that
    // one and it can render outside the 400x600 popup. Session-only is the default;
    // requiring the password again is the explicit opt-in.
    const signingRow = h('div', { class: 'row-flex align-center', style: { gap: '6px' } }, [
      h('strong', { text: 'Signing' }),
    ]);
    const signingHelp = HelpTooltip({
      host: signingRow,
      label: 'About signing security',
      text: 'Session-only allows signing freely while unlocked. Require password prompts before every transaction.',
    });
    owned.push(signingHelp);
    signingRow.appendChild(signingHelp.trigger);
    security.appendChild(signingRow);
    renderSigningReauth(security, preferences?.requirePasswordForSigning === true);

    const autoLockRow = h('div', { class: 'row-flex align-center', style: { gap: '6px' } }, [
      h('strong', { text: 'Auto-lock' }),
    ]);
    const autoLockHelp = HelpTooltip({
      host: autoLockRow,
      label: 'About auto-lock',
      text: 'Automatically locks your wallet after inactivity to protect decrypted keys.',
    });
    owned.push(autoLockHelp);
    autoLockRow.appendChild(autoLockHelp.trigger);
    security.appendChild(autoLockRow);
    renderAutoLock(security, Number(autoLockMinutes));

    // ---- Accounts shortcut ----
    // Self-describing button — deliberately no section header.
    body.appendChild(h('section', { class: 'stack stack-2' }, [
      track(Button({
        label: 'Manage accounts and recovery phrases',
        variant: 'secondary',
        iconName: 'wallet',
        onClick: () => navigate('/accounts'),
      })).el,
    ]));

    // ---- Side Panel Mode (no section header; the toggle is self-describing) ----
    // The "Side Panel Mode" toggle only — the explicit "Open side panel" button is not
    // restored here because the dashboard header already provides it.
    const switchKnob = h('span', { class: 'toggle-knob' });
    const sidePanelSwitch = h('button', {
      type: 'button',
      class: ['toggle-switch', sidePanelMode ? 'active' : null].filter(Boolean),
      role: 'switch',
      'aria-checked': String(sidePanelMode),
      'aria-label': 'Side Panel Mode',
    }, switchKnob);

    d.on(sidePanelSwitch, 'click', async () => {
      const next = !sidePanelMode;
      banner.clear();
      try {
        if (!chrome?.sidePanel?.setPanelBehavior) {
          banner.set('This browser has no side panel API. The popup keeps working as usual.', 'warning');
          return;
        }
        // Both directions are applied explicitly: ON makes the toolbar icon open the
        // panel; OFF restores the popup, so a user who turned it off is never left
        // with a stale behaviour.
        await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: next });
        if (chrome.storage?.local?.set) {
          await chrome.storage.local.set({ thru_side_panel_mode: next });
        }
        sidePanelMode = next;
        sidePanelSwitch.classList.toggle('active', next);
        sidePanelSwitch.setAttribute('aria-checked', String(next));
      } catch (err) {
        banner.set(err?.message || 'Could not update side panel mode.', 'warning');
      }
    });

    const sidePanelLabelGroup = h('div', { class: 'toggle-label-group' }, [
      icon('sidePanel', 18),
      h('span', { text: 'Side Panel Mode' }),
    ]);
    const sidePanelRow = h('div', { class: 'toggle-row' }, [sidePanelLabelGroup, sidePanelSwitch]);
    const sidePanelHelp = HelpTooltip({
      host: sidePanelRow,
      label: 'About Side Panel Mode',
      text: 'When on, clicking the browser toolbar icon opens the side panel instead of the popup.',
    });
    owned.push(sidePanelHelp);
    sidePanelLabelGroup.appendChild(sidePanelHelp.trigger);

    // Self-describing toggle row — deliberately no section header.
    body.appendChild(h('section', { class: 'stack stack-2' }, [
      sidePanelRow,
    ]));

    // ---- Appearance ----
    const appearanceHeader = SectionHeader('Appearance');
    const appearanceHelp = HelpTooltip({
      host: appearanceHeader,
      label: 'About appearance',
      text: 'Choose Light, Dark, or System to follow your device theme.',
    });
    owned.push(appearanceHelp);
    appearanceHeader.appendChild(appearanceHelp.trigger);
    body.appendChild(h('section', { class: 'stack stack-2' }, [
      appearanceHeader,
      h('div', { class: 'row-flex wrap' }, themeChips()),
    ]));

    // There is deliberately NO full-wallet reset on this screen: an unlocked wallet
    // should not be one tap from total destruction. Individual account/seed removal
    // lives in Manage Accounts; removing the ONLY key source there is spelled out as a
    // full wipe in its confirm dialog (it fulfils through wallet.reset), and the
    // forgotten-password recovery path remains on the lock screen (/reset, from /unlock).

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
