import * as bridge from '../../ui/bridge.js';
import { walletStore } from '../../ui/store.js';
import { events, Events } from '../../ui/events.js';
import { router } from '../../ui/router.js';
import { icons } from '../icons.js';
import { showToast } from '../toast.js';

/** @type {Array<function>} Cleanup subscriptions */
let _unsubs = [];

/**
 * Mount the settings screen.
 * @param {HTMLElement} container
 */
export function mount(container) {
  const state = walletStore.getState();
  const autoLockMin = state.settings?.autoLockMinutes ?? 15;
  const network = state.activeNetwork;
  const health = state.networkHealth;

  container.innerHTML = `
    <div class="subheader">
      <button type="button" class="icon-btn" id="settings-back-btn" title="Back">${icons.back()}</button>
      <h1>Settings</h1>
      <span class="subheader-spacer"></span>
    </div>

    <div class="settings-section">
      <div class="settings-group-label">Security</div>

      <div class="settings-row">
        <div class="settings-row-left">
          <span class="settings-icon">${icons.lock(16)}</span>
          <div class="settings-row-text">
            <span class="settings-row-title">Auto-lock timer</span>
            <span class="settings-row-sub">Lock after inactivity</span>
          </div>
        </div>
        <select id="settings-autolock" class="settings-select">
          <option value="5" ${autoLockMin === 5 ? 'selected' : ''}>5 min</option>
          <option value="15" ${autoLockMin === 15 ? 'selected' : ''}>15 min</option>
          <option value="30" ${autoLockMin === 30 ? 'selected' : ''}>30 min</option>
          <option value="60" ${autoLockMin === 60 ? 'selected' : ''}>1 hour</option>
          <option value="0" ${autoLockMin === 0 ? 'selected' : ''}>Never</option>
        </select>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-group-label">Network</div>

      <div class="settings-row">
        <div class="settings-row-left">
          <span class="settings-icon foot-dot ${health?.status || 'offline'}"></span>
          <div class="settings-row-text">
            <span class="settings-row-title">${network?.label || 'Alphanet'}</span>
            <span class="settings-row-sub">${health?.latencyMs != null ? `${health.latencyMs} ms` : health?.status || 'offline'}</span>
          </div>
        </div>
        <button type="button" class="btn-chip" id="settings-switch-network">Switch</button>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-group-label">About</div>

      <div class="settings-row">
        <div class="settings-row-left">
          <span class="settings-icon">${icons.shield(16)}</span>
          <div class="settings-row-text">
            <span class="settings-row-title">Thru Wallet</span>
            <span class="settings-row-sub">v0.1.0 — Alphanet</span>
          </div>
        </div>
      </div>
    </div>

    <div class="settings-section settings-danger">
      <div class="settings-group-label">Danger Zone</div>

      <div class="settings-row">
        <div class="settings-row-left">
          <span class="settings-icon">${icons.warning(16)}</span>
          <div class="settings-row-text">
            <span class="settings-row-title">Reset wallet</span>
            <span class="settings-row-sub">Remove all data from this device</span>
          </div>
        </div>
        <button type="button" class="btn-chip danger" id="settings-reset-btn">Reset</button>
      </div>
    </div>
  `;

  // --- Event handlers ---

  const backBtn = container.querySelector('#settings-back-btn');
  backBtn?.addEventListener('click', () => router.navigate('dashboard'));

  const autolockSelect = container.querySelector('#settings-autolock');
  const handleAutolockChange = async () => {
    const minutes = parseInt(autolockSelect.value, 10);
    try {
      await bridge.send('system.setAutoLock', { minutes });
      walletStore.setState({ settings: { ...walletStore.getState().settings, autoLockMinutes: minutes } });
      showToast(`Auto-lock set to ${minutes} min`, 'info');
    } catch (err) {
      showToast(`Failed to update auto-lock: ${err.message}`, 'error');
    }
  };
  autolockSelect?.addEventListener('change', handleAutolockChange);

  const switchNetworkBtn = container.querySelector('#settings-switch-network');
  const handleSwitchNetwork = () => {
    import('../../ui/components/network-switcher.js').then(({ openNetworkSwitcher: openNS }) => {
      openNS({
        onNetworkSwitched: (newConfig) => {
          walletStore.setState({ activeNetwork: newConfig });
          events.emit(Events.NETWORK_SWITCHED, newConfig);
          mount(container);
        },
      });
    });
  };
  switchNetworkBtn?.addEventListener('click', handleSwitchNetwork);

  const resetBtn = container.querySelector('#settings-reset-btn');
  resetBtn?.addEventListener('click', () => {
    router.navigate('reset-confirm');
  });

  // Store cleanup references
  _unsubs.push(
    () => backBtn?.removeEventListener('click', () => router.navigate('dashboard')),
    () => autolockSelect?.removeEventListener('change', handleAutolockChange),
    () => switchNetworkBtn?.removeEventListener('click', handleSwitchNetwork),
    () => resetBtn?.removeEventListener('click', () => router.navigate('reset-confirm')),
  );
}

/**
 * Cleanup the settings screen.
 */
export function cleanup() {
  for (const unsub of _unsubs) {
    try { unsub(); } catch { /* ignore */ }
  }
  _unsubs = [];
}
