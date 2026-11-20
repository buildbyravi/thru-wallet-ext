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
// The full screen groups wallet shortcuts, preferences, and support. The focused network
// picker remains a standalone view of the same network controls.

import { h, disposer } from '../../kit/dom.js';
import { icon } from '../../kit/icon.js';
import { PageHeader, Banner, Spinner } from '../../kit/feedback.js';
import { HelpTooltip } from '../../kit/help-tooltip.js';
import { requirePassword } from '../../domain/password-prompt.js';
import * as bridge from '../bridge.js';
import { getTheme, setTheme } from '../../../popup/theme.js';
import { AUTO_LOCK_CHOICES } from '../../../shared/autolock.js';

function SettingsGroup(title, rows) {
  return h('section', null, [
    h('h2', { class: 'settings-heading', text: title }),
    h('div', { class: 'settings-card' }, rows),
  ]);
}

// One visual row for links, actions, switches, current values and disclosures.
function SettingsRow(tag, { label, glyph, attrs, value, control, trailing }) {
  return h(tag, { ...attrs, class: 'settings-row' }, [
    icon(glyph, 18),
    h('span', { class: 'settings-row-label' }, label),
    value,
    control,
    trailing ? icon(trailing, 15) : null,
  ]);
}

function RowValue(text) {
  return h('span', { class: 'settings-row-value', text });
}

function autoLockLabel(minutes) {
  return minutes === 0 ? 'Never' : minutes < 60 ? `${minutes} min` : `${minutes / 60} hr`;
}

export function SettingsRoute({ navigate, back, params = {} }) {
  const networkOnly = params.view === 'network';
  let disposed = false;
  let switchingNetwork = false;
  const d = disposer();
  const owned = [];
  const disclosures = new Map();
  let rowEvents = disposer();
  let networks = [];
  let activeNetworkId = null;
  let preferences = null;
  let theme = 'system';

  const banner = Banner({ tone: 'error' });
  const body = h('div', { class: networkOnly ? 'stack stack-5' : 'settings-groups' }, Spinner({ label: 'Loading settings' }).el);
  const header = PageHeader({ title: networkOnly ? 'Choose network' : 'Settings', onBack: () => back() });
  const el = h('section', { class: networkOnly ? 'screen' : 'screen settings-screen' }, [header.el, banner.el, body]);

  function clearBody() {
    rowEvents.dispose();
    rowEvents = disposer();
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

    const row = selectable && !(networkOnly && isActive)
      ? h('button', {
        type: 'button',
        class: ['row', isActive ? 'active' : null].filter(Boolean),
        'aria-current': isActive ? 'true' : null,
      }, children)
      : h('div', { class: 'row', 'aria-current': isActive ? 'true' : null, 'aria-disabled': !isActive ? 'true' : null }, children);

    if (selectable && !isActive) {
      rowEvents.on(row, 'click', async () => {
        if (switchingNetwork) return;
        switchingNetwork = true;
        banner.clear();
        try {
          await bridge.send('network.setActive', { networkId: network.id });
          if (disposed) return;
          // Balances, tokens and pending transactions are all per-network, so the whole
          // wallet view changes. Going back to the dashboard makes that obvious rather than
          // leaving the user on a settings screen wondering whether it took effect.
          if (networkOnly) back();
          else navigate('/dashboard');
        } catch (error) {
          if (!disposed) banner.set(error.message || 'Could not switch network.');
        } finally {
          switchingNetwork = false;
        }
      });
    }

    const wrap = h('div', { class: 'row-flex' }, [row]);

    if (network.custom && !networkOnly) {
      const removeBtn = h('button', {
        type: 'button',
        class: 'icon-btn icon-btn-ghost sm danger-hover',
        title: `Remove ${network.label || network.id}`,
        'aria-label': `Remove ${network.label || network.id}`,
      }, icon('trash', 13));
      rowEvents.on(removeBtn, 'click', async () => {
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
      'Adding a custom network is temporarily unavailable until custom RPC endpoints and chain '
      + 'programs can be verified. Saved custom networks cannot be selected, though you can remove them here.' }));
  }

  // ---- Auto-lock ----------------------------------------------------------
  function renderAutoLock(hostEl, current) {
    const chips = AUTO_LOCK_CHOICES.map((minutes) => {
      const label = autoLockLabel(minutes);
      const selected = minutes === current;
      const chip = h('button', {
        type: 'button',
        class: ['chip-option', selected ? 'selected' : null].filter(Boolean),
        'aria-pressed': String(selected),
        text: label,
      });
      rowEvents.on(chip, 'click', async () => {
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
        'aria-pressed': String(selected),
        text: option.label,
      });
      if (!selected) {
        rowEvents.on(chip, 'click', async () => {
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
  // The shared theme helper persists the preference before applying it.
  function themeChips(onChange) {
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
        'aria-pressed': String(selected),
        text: option.label,
      });
      rowEvents.on(chip, 'click', async () => {
        banner.clear();
        const previous = theme;
        try {
          await setTheme(option.value);
          theme = option.value;
        } catch (err) {
          theme = previous;
          banner.set(err?.message || 'Could not update theme.');
          return;
        }
        if (disposed) return;
        onChange(option.label);
        // Reflow the selected state by identity — never by DOM position.
        options.forEach((o, i) => {
          const active = o.value === theme;
          chips[i].classList.toggle('selected', active);
          chips[i].setAttribute('aria-pressed', String(active));
        });
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
      const [netList, active, autoLock, prefs] = await Promise.all([
        bridge.send('network.list'),
        bridge.send('network.getActive'),
        ...(networkOnly ? [] : [bridge.send('system.getAutoLock'), bridge.send('settings.get')]),
      ]);
      if (disposed) return;
      networks = netList || [];
      activeNetworkId = active?.id || null;
      if (networkOnly) {
        render();
        return;
      }
      preferences = prefs || {};
      sidePanelMode = preferences.sidePanelMode === true;
      theme = await getTheme().catch(() => 'system');
      if (!disposed) render(autoLock);
    } catch (error) {
      if (disposed) return;
      clearBody();
      banner.set(error.message || (networkOnly ? 'Could not load networks.' : 'Could not load settings.'));
    }
  }

  function render(autoLockMinutes) {
    const focused = document.activeElement?.closest('.settings-disclosure');
    const focusedDisclosure = [...disclosures].find(([, el]) => el === focused)?.[0];
    const expanded = new Set([...disclosures].filter(([, el]) => el.hasAttribute('open')).map(([key]) => key));
    disclosures.clear();
    clearBody();

    const networkList = h('div', { class: 'list' }, networks.map(networkRow));
    if (networkOnly) {
      const networkSection = h('section', { class: 'stack stack-2' }, [
        h('h2', { class: 'list-group-header', text: 'Network' }), networkList,
      ]);
      body.appendChild(networkSection);
      if (!networks.some((network) => !network.custom && network.selectable !== false && network.id !== activeNetworkId)) {
        networkSection.appendChild(h('p', { class: 'hint', text: 'No other networks are available to switch to.' }));
      }
      return;
    }

    function disclosure(key, label, glyph, value, content) {
      const details = h('details', { class: 'settings-disclosure', open: expanded.has(key) }, [
        SettingsRow('summary', { label, glyph, value, trailing: 'chevronRight' }), content,
      ]);
      disclosures.set(key, details);
      return details;
    }

    function help(host, label, text) {
      const tooltip = HelpTooltip({ host, label, text });
      owned.push(tooltip);
      return tooltip.trigger;
    }

    function choices(label, helpLabel, helpText) {
      const title = h('div', { class: 'settings-choice-title' }, h('span', { text: label }));
      title.appendChild(help(title, helpLabel, helpText));
      return h('div', { class: 'settings-detail stack stack-2' }, title);
    }

    function action(label, glyph, onClick) {
      const row = SettingsRow('button', { label, glyph, attrs: { type: 'button' }, trailing: 'chevronRight' });
      rowEvents.on(row, 'click', onClick);
      return row;
    }

    body.appendChild(SettingsGroup('Features', [
      action('Lock wallet', 'lock', async () => {
        try {
          await bridge.send('wallet.lock');
        } catch {
          // Keep the existing lock-screen fallback.
        }
        if (!disposed) navigate('/unlock', { replace: true });
      }),
      action('Transaction history', 'history', () => navigate('/history')),
      action('Manage accounts and recovery phrases', 'wallet', () => navigate('/accounts')),
    ]));

    const networkPanel = h('div', { class: 'settings-detail stack stack-2' }, networkList);
    renderCustomNetworkNotice(networkPanel);
    const active = networks.find((network) => network.id === activeNetworkId);
    const themeValue = RowValue(theme[0].toUpperCase() + theme.slice(1));
    const appearance = choices('Choose a theme', 'About appearance', 'Choose Light, Dark, or System to follow your device theme.');
    appearance.appendChild(h('div', { class: 'row-flex wrap' }, themeChips((label) => { themeValue.textContent = label; })));

    const requirePasswordForSigning = preferences?.requirePasswordForSigning === true;
    const signing = choices('Signing policy', 'About signing security',
      'Session-only allows signing freely while unlocked. Require password prompts before every transaction.');
    renderSigningReauth(signing, requirePasswordForSigning);
    const autoLock = choices('Lock after inactivity', 'About auto-lock',
      'Automatically locks your wallet after inactivity to protect decrypted keys.');
    const minutes = Number(autoLockMinutes);
    renderAutoLock(autoLock, minutes);

    // ---- Side Panel Mode ----
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

    rowEvents.on(sidePanelSwitch, 'click', async () => {
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
        preferences = await bridge.send('settings.set', { patch: { sidePanelMode: next } });
        sidePanelMode = preferences.sidePanelMode === true;
        sidePanelSwitch.classList.toggle('active', next);
        sidePanelSwitch.setAttribute('aria-checked', String(next));
      } catch (err) {
        banner.set(err?.message || 'Could not update side panel mode.', 'warning');
      }
    });

    const sidePanelLabel = h('span', { class: 'settings-label-with-help' }, 'Side Panel Mode');
    const sidePanelRow = SettingsRow('div', { label: sidePanelLabel, glyph: 'sidePanel', control: sidePanelSwitch });
    sidePanelLabel.appendChild(help(sidePanelRow, 'About Side Panel Mode',
      'When on, clicking the browser toolbar icon opens the side panel instead of the popup.'));

    // ---- Desktop Notifications ----
    const notifKnob = h('span', { class: 'toggle-knob' });
    const notifSwitch = h('button', {
      type: 'button',
      class: ['toggle-switch', preferences?.desktopNotifications !== false ? 'active' : null].filter(Boolean),
      role: 'switch',
      'aria-checked': String(preferences?.desktopNotifications !== false),
      'aria-label': 'Desktop Notifications',
    }, notifKnob);

    rowEvents.on(notifSwitch, 'click', async () => {
      const current = preferences?.desktopNotifications !== false;
      const next = !current;
      banner.clear();
      try {
        await bridge.send('settings.set', { patch: { desktopNotifications: next } });
        if (!preferences) preferences = {};
        preferences.desktopNotifications = next;
        notifSwitch.classList.toggle('active', next);
        notifSwitch.setAttribute('aria-checked', String(next));
      } catch (err) {
        banner.set(err?.message || 'Could not update notification preferences.');
      }
    });

    const notifications = SettingsRow('div', { label: 'Desktop Notifications', glyph: 'bell', control: notifSwitch });
    const plannedRow = (label, glyph) => SettingsRow('button', {
      label, glyph, value: RowValue('Planned'), attrs: { type: 'button', disabled: true },
    });

    body.appendChild(SettingsGroup('Settings', [
      disclosure('network', 'Network', 'globe', RowValue(active?.label || activeNetworkId || '—'), networkPanel),
      sidePanelRow,
      notifications,
      disclosure('signing', 'Signing security', 'shield', RowValue(requirePasswordForSigning ? 'Require password' : 'Session-only'), signing),
      disclosure('theme', 'Theme Mode', 'settings', themeValue, appearance),
      plannedRow('Language', 'language'),
      plannedRow('Currency', 'coins'),
      disclosure('auto-lock', 'Auto-lock time', 'clock', RowValue(Number.isFinite(minutes) ? autoLockLabel(minutes) : '—'), autoLock),
    ]));

    // There is deliberately NO full-wallet reset on this screen: an unlocked wallet
    // should not be one tap from total destruction. Individual account/seed removal
    // lives in Manage Accounts; removing the ONLY key source there is spelled out as a
    // full wipe in its confirm dialog (it fulfils through wallet.reset), and the
    // forgotten-password recovery path remains on the lock screen (/reset, from /unlock).

    // ---- About ----
    // Read from the manifest so it can never drift from the shipped version, unlike the
    // hardcoded 'v0.1.0' the legacy settings screen showed against a 1.3.0 manifest.
    let version = '—';
    try {
      version = chrome.runtime.getManifest().version;
    } catch {
      // not in an extension context
    }
    function externalLink(label, glyph, href) {
      return SettingsRow('a', {
        label, glyph, trailing: 'external', attrs: { href, target: '_blank', rel: 'noopener noreferrer' },
      });
    }
    body.appendChild(SettingsGroup('About', [
      externalLink('Support', 'help', 'https://t.me/+dA8TwsOECcIxZWZl'),
      SettingsRow('div', { label: 'Current version', glyph: 'info', value: RowValue(version) }),
      externalLink('Website', 'globe', 'https://thruwallet.vercel.app'),
    ]));
    body.appendChild(h('div', { class: 'settings-footer' }, [
      h('img', { src: 'icons/thru.png', alt: '', width: 20, height: 20 }),
      h('span', { text: 'Thru Wallet' }),
    ]));
    disclosures.get(focusedDisclosure)?.firstChild.focus();
  }

  load();
  d.add(bridge.onEvent('networkChanged', () => load()));

  return {
    el,
    destroy() {
      disposed = true;
      clearBody();
      disclosures.clear();
      header.destroy();
      banner.destroy();
      d.dispose();
    },
  };
}
