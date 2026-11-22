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
// view is reused by the dashboard sheet and remains available as a standalone route.

import { h, disposer } from '../../kit/dom.js';
import { icon } from '../../kit/icon.js';
import { Button } from '../../kit/button.js';
import { Sheet } from '../../kit/sheet.js';
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

export function SettingsRoute({ navigate, back, params = {}, onNetworkBusy = () => {} }) {
  const networkOnly = params.view === 'network';
  let disposed = false;
  let switchingNetwork = false;
  let refreshAfterSwitch = false;
  const d = disposer();
  const owned = [];
  const pickerRows = new Map();
  const routeAbort = new AbortController();
  let picker = null;
  let savingTheme = false;
  let themeRevision = 0;
  let themeValue = null;
  let rowEvents = disposer();
  let networks = [];
  let activeNetworkId = null;
  let preferences = null;
  let theme = 'system';

  const banner = Banner({ tone: 'error' });
  const body = h('div', { class: networkOnly ? 'stack stack-5' : 'settings-groups' }, Spinner({ label: 'Loading settings' }).el);
  const header = PageHeader({ title: networkOnly ? 'Choose network' : 'Settings', onBack: () => { if (!switchingNetwork) back(); } });
  const el = h('section', { class: networkOnly ? 'screen' : 'screen settings-screen' }, [header.el, banner.el, body]);

  function clearBody() {
    picker?.sheet.close();
    sidePanelSwitch = null;
    themeValue = null;
    rowEvents.dispose();
    rowEvents = disposer();
    for (const c of owned) c.destroy?.();
    owned.length = 0;
    while (body.firstChild) body.removeChild(body.firstChild);
  }

  // ---- Network rows -------------------------------------------------------
  function networkRow(network, events) {
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

    const row = selectable && !isActive
      ? h('button', {
        type: 'button',
        class: 'row',
      }, children)
      : h('div', { class: isActive ? 'row active' : 'row', 'aria-current': isActive ? 'true' : null, 'aria-disabled': !isActive ? 'true' : null }, children);

    if (selectable && !isActive) {
      events.on(row, 'click', async () => {
        if (switchingNetwork) return;
        switchingNetwork = true;
        const owner = picker;
        owner?.sheet.setDismissible(false);
        const dismissControl = owner?.close?.el || (networkOnly ? header.el.querySelector('button') : null);
        dismissControl?.setAttribute('aria-disabled', 'true');
        onNetworkBusy(true);
        const status = h('span', { class: 'hint', role: 'status', text: `Switching to ${network.label || network.id}…` });
        row.appendChild(status);
        row.setAttribute('aria-disabled', 'true');
        banner.clear();
        owner?.notice.clear();
        let switchError = null;
        try {
          await bridge.send('network.setActive', { networkId: network.id });
          if (disposed || (owner && owner.sheet.closed)) return;
          // Balances, tokens and pending transactions are all per-network, so the whole
          // wallet view changes. Going back to the dashboard makes that obvious rather than
          // leaving the user on a settings screen wondering whether it took effect.
          if (networkOnly) back();
          else navigate('/dashboard');
        } catch (error) {
          switchError = error.message || 'Could not switch network.';
          if (!disposed && !refreshAfterSwitch && (!owner || !owner.sheet.closed)) (owner?.notice || banner).set(switchError);
        } finally {
          switchingNetwork = false;
          owner?.sheet.setDismissible(true);
          dismissControl?.removeAttribute('aria-disabled');
          onNetworkBusy(false);
          row.removeAttribute('aria-disabled');
          status.remove();
          if (refreshAfterSwitch && !disposed) {
            refreshAfterSwitch = false;
            void load().then(() => { if (!disposed && switchError) banner.set(switchError); });
          }
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
      events.on(removeBtn, 'click', async () => {
        banner.clear();
        try {
          await bridge.send('network.removeCustom', { networkId: network.id });
          load();
        } catch (error) {
          if (!disposed) (picker?.notice || banner).set(error.message || 'Could not remove that network.');
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
  function renderAutoLock(hostEl, current, events) {
    const chips = AUTO_LOCK_CHOICES.map((minutes) => {
      const label = autoLockLabel(minutes);
      const selected = minutes === current;
      const chip = h('button', {
        type: 'button',
        class: ['chip-option', selected ? 'selected' : null].filter(Boolean),
        'aria-pressed': String(selected),
        text: label,
      });
      events.on(chip, 'click', async () => {
        banner.clear();
        if (minutes === current) { picker?.sheet.close(); return; }
        // The password prompt owns focus. Do not run two modal focus traps at once.
        picker?.sheet.close();
        const result = await requirePassword({
          signal: routeAbort.signal,
          title: minutes === 0 ? 'Disable auto-lock?' : 'Change auto-lock?',
          body: minutes === 0
            ? 'Enter your password to set auto-lock to Never. This keeps the wallet unlocked until you lock it or the browser closes.'
            : `Enter your password to lock the wallet after ${label} of inactivity.`,
          confirmLabel: minutes === 0 ? 'Set to Never' : 'Update auto-lock',
          danger: minutes === 0,
          verify: (password) => bridge.send('system.setAutoLock', { minutes, password }),
        });
        if (result && !disposed) load();
      });
      return chip;
    });

    // The explanation is the (?) popover on the "Auto-lock" row above.
    hostEl.appendChild(h('div', { class: 'row-flex wrap' }, chips));
  }

  function renderSigningReauth(hostEl, requirePasswordForSigning, events) {
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
      events.on(chip, 'click', async () => {
        banner.clear();
        picker?.sheet.close();
        if (selected) return;
        const result = await requirePassword({
          signal: routeAbort.signal,
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
        if (result && !disposed) load();
      });
      return chip;
    });
    hostEl.appendChild(h('div', { class: 'row-flex wrap' }, chips));
  }


  // ---- Appearance ------------------------------------------------------
  // The shared theme helper persists the preference before applying it.
  function themeLabel() {
    return theme[0].toUpperCase() + theme.slice(1);
  }

  function paintThemeMode() {
    if (themeValue) themeValue.textContent = themeLabel();
    if (picker?.key === 'theme') picker.paintTheme?.();
  }

  function themeChips(activePicker) {
    const options = ['light', 'dark', 'system'];
    const chips = options.map((option) => {
      const chip = h('button', {
        type: 'button', class: 'chip-option', text: option[0].toUpperCase() + option.slice(1),
      });
      activePicker.sheet.d.on(chip, 'click', async () => {
        if (savingTheme) return;
        activePicker.notice.clear();
        if (option === theme) { activePicker.sheet.close(); return; }
        savingTheme = true;
        themeRevision += 1;
        paintThemeMode();
        let error;
        try {
          await setTheme(option);
          theme = option;
        } catch (err) {
          error = err?.message || 'Could not update theme.';
        } finally {
          themeRevision += 1;
          savingTheme = false;
        }
        if (disposed) return;
        // The original sheet may have been dismissed. Paint the current row and picker,
        // and only dismiss the picker the user was in when they selected the theme.
        paintThemeMode();
        if (error) (picker?.key === 'theme' ? picker.notice : banner).set(error);
        else activePicker.sheet.close();
      });
      return chip;
    });
    activePicker.paintTheme = () => {
      options.forEach((option, index) => {
        const selected = option === theme;
        const chip = chips[index];
        chip.classList.toggle('selected', selected);
        chip.setAttribute('aria-pressed', String(selected));
        // Keep focus in place while blocking a second write.
        if (savingTheme) chip.setAttribute('aria-disabled', 'true');
        else chip.removeAttribute('aria-disabled');
      });
    };
    activePicker.paintTheme();
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
  let sidePanelSaving = false;
  let sidePanelRevision = 0;
  let sidePanelSwitch = null;

  function paintSidePanelMode() {
    if (!sidePanelSwitch) return;
    sidePanelSwitch.classList.toggle('active', sidePanelMode);
    sidePanelSwitch.setAttribute('aria-checked', String(sidePanelMode));
    // Retain focus while a save is pending; the click guard enforces the disabled state.
    for (const attr of ['aria-disabled', 'aria-busy']) {
      if (sidePanelSaving) sidePanelSwitch.setAttribute(attr, 'true');
      else sidePanelSwitch.removeAttribute(attr);
    }
  }

  async function toggleSidePanelMode() {
    if (disposed || sidePanelSaving) return;
    banner.clear();
    const panel = globalThis.chrome?.sidePanel;
    if (typeof panel?.setPanelBehavior !== 'function') {
      banner.set('This browser has no side panel API. The popup keeps working as usual.', 'warning');
      return;
    }

    const previous = sidePanelMode;
    const next = !previous;
    const apply = (enabled) => panel.setPanelBehavior({ openPanelOnActionClick: enabled });
    sidePanelRevision += 1;
    sidePanelSaving = true;
    paintSidePanelMode();
    let warning;
    try {
      // Don't save a mode this browser rejected. Both directions require an explicit click.
      await apply(next);
      let saved;
      try {
        saved = await bridge.send('settings.set', { patch: { sidePanelMode: next } });
      } catch {
        // The worker may have committed the preference but lost the reply. Check before undoing it.
        saved = await bridge.send('settings.get').catch(() => null);
      }
      const confirmed = typeof saved?.sidePanelMode === 'boolean';
      sidePanelMode = confirmed ? saved.sidePanelMode : previous;
      if (preferences && confirmed) preferences.sidePanelMode = sidePanelMode;
      if (sidePanelMode !== next) {
        try {
          await apply(sidePanelMode);
          warning = confirmed
            ? 'Side Panel Mode could not be saved. The previous toolbar behavior was restored.'
            : 'Could not confirm whether Side Panel Mode was saved. The previous toolbar behavior was restored. Reopen Settings to check.';
        } catch {
          warning = 'Chrome could not restore the previous toolbar behavior. It may not match the saved switch. Try again.';
        }
      }
    } catch {
      warning = 'Chrome could not change the toolbar behavior. Side Panel Mode was not saved.';
    } finally {
      sidePanelRevision += 1;
      sidePanelSaving = false;
      if (!disposed) {
        paintSidePanelMode();
        if (warning) banner.set(warning, 'warning');
      }
    }
  }

  async function load() {
    const panelRevisionAtLoad = sidePanelRevision;
    const themeRevisionAtLoad = themeRevision;
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
      if (!sidePanelSaving && panelRevisionAtLoad === sidePanelRevision) {
        sidePanelMode = preferences.sidePanelMode === true;
      }
      const storedTheme = await getTheme().catch(() => 'system');
      if (!savingTheme && themeRevisionAtLoad === themeRevision) theme = storedTheme;
      if (!disposed) render(autoLock);
    } catch (error) {
      if (disposed) return;
      clearBody();
      banner.set(error.message || (networkOnly ? 'Could not load networks.' : 'Could not load settings.'));
    }
  }

  function render(autoLockMinutes) {
    const focusedKey = picker?.key ?? [...pickerRows].find(([, row]) => row === document.activeElement)?.[0];
    pickerRows.clear();
    clearBody();

    const networkList = (events) => h('div', { class: 'list' }, networks.map((network) => networkRow(network, events)));
    if (networkOnly) {
      const networkSection = h('section', { class: 'stack stack-2' }, networkList(rowEvents));
      body.appendChild(networkSection);
      if (!networks.some((network) => !network.custom && network.selectable !== false && network.id !== activeNetworkId)) {
        networkSection.appendChild(h('p', { class: 'hint', text: 'No other networks are available to switch to.' }));
      }
      return;
    }

    function pickerRow(key, label, glyph, value, renderContent) {
      const row = SettingsRow('button', {
        label, glyph, value, attrs: { type: 'button', 'aria-haspopup': 'dialog' }, trailing: 'chevronRight',
      });
      pickerRows.set(key, row);
      rowEvents.on(row, 'click', () => {
        if (picker) return;
        const sheet = Sheet({ label, className: 'settings-picker', opener: row, onClose: () => { picker = null; } });
        const notice = sheet.track(Banner({ tone: 'error' }));
        const close = sheet.track(Button({ label: 'Close', variant: 'text', onClick: () => { if (!switchingNetwork) sheet.close(); } }));
        sheet.card.appendChild(h('div', { class: 'modal-head settings-picker-head' }, [h('h2', { text: label }), close.el]));
        sheet.card.appendChild(notice.el);
        picker = { sheet, notice, key, close };
        sheet.card.appendChild(renderContent(sheet));
        sheet.open();
      });
      return row;
    }

    function help(host, label, text, sheet) {
      const tooltip = HelpTooltip({ host, label, text });
      if (sheet) sheet.track(tooltip);
      else owned.push(tooltip);
      return tooltip.trigger;
    }

    function choices(sheet, label, helpLabel, helpText) {
      const title = h('div', { class: 'settings-choice-title' }, h('span', { text: label }));
      title.appendChild(help(title, helpLabel, helpText, sheet));
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

    const networkPanel = (sheet) => {
      const panel = h('div', { class: 'settings-detail stack stack-2' }, networkList(sheet.d));
      renderCustomNetworkNotice(panel);
      return panel;
    };
    const active = networks.find((network) => network.id === activeNetworkId);
    themeValue = RowValue(themeLabel());
    const appearance = (sheet) => {
      const panel = choices(sheet, 'Choose a theme', 'About appearance', 'Choose Light, Dark, or System to follow your device theme.');
      panel.appendChild(h('div', { class: 'row-flex wrap' }, themeChips(picker)));
      return panel;
    };
    const requirePasswordForSigning = preferences?.requirePasswordForSigning === true;
    const signing = (sheet) => {
      const panel = choices(sheet, 'Signing policy', 'About signing security',
        'Session-only allows signing freely while unlocked. Require password prompts before every transaction.');
      renderSigningReauth(panel, requirePasswordForSigning, sheet.d);
      return panel;
    };
    const minutes = Number(autoLockMinutes);
    const autoLock = (sheet) => {
      const panel = choices(sheet, 'Lock after inactivity', 'About auto-lock',
        'Automatically locks your wallet after inactivity to protect decrypted keys.');
      renderAutoLock(panel, minutes, sheet.d);
      return panel;
    };

    // ---- Side Panel Mode ----
    // The "Side Panel Mode" toggle only — the explicit "Open side panel" button is not
    // restored here because the dashboard header already provides it.
    const switchKnob = h('span', { class: 'toggle-knob' });
    sidePanelSwitch = h('button', {
      type: 'button',
      class: 'toggle-switch',
      role: 'switch',
      'aria-label': 'Side Panel Mode',
    }, switchKnob);

    paintSidePanelMode();
    rowEvents.on(sidePanelSwitch, 'click', toggleSidePanelMode);

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
      pickerRow('network', 'Network', 'globe', RowValue(active?.label || activeNetworkId || '—'), networkPanel),
      sidePanelRow,
      notifications,
      pickerRow('signing', 'Signing security', 'shield', RowValue(requirePasswordForSigning ? 'Require password' : 'Session-only'), signing),
      pickerRow('theme', 'Theme Mode', 'settings', themeValue, appearance),
      plannedRow('Language', 'language'),
      plannedRow('Currency', 'coins'),
      pickerRow('auto-lock', 'Auto-lock time', 'clock', RowValue(Number.isFinite(minutes) ? autoLockLabel(minutes) : '—'), autoLock),
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
      h('img', { src: 'icons/icon128.png', alt: '', width: 20, height: 20 }),
      h('span', { text: 'Thru Wallet' }),
    ]));
    pickerRows.get(focusedKey)?.focus();
  }

  load();
  d.add(bridge.onEvent('networkChanged', () => {
    if (switchingNetwork) refreshAfterSwitch = true;
    else void load();
  }));

  return {
    el,
    destroy() {
      disposed = true;
      clearBody();
      routeAbort.abort();
      pickerRows.clear();
      header.destroy();
      banner.destroy();
      d.dispose();
    },
  };
}
