// Faucet screen module — claim test THRU from the alphanet faucet.
//
// Submits faucet claims via bridge, shows explorer link on success.
// Amount is in raw base units (matches reverse-engineered CLI format).

import * as bridge from '../../ui/bridge.js';
import { walletStore } from '../../ui/store.js';
import { events, Events } from '../../ui/events.js';
import { icons } from '../icons.js';
import { showToast } from '../toast.js';
import { explorerTxUrl } from '../../lib/networks.js';

const FAUCET_MAX_PER_CLAIM = 10_000n;

/** @type {Array<function>} */
let _unsubs = [];

/**
 * Mount the faucet screen.
 * @param {HTMLElement} container
 */
export function mount(container) {
  container.innerHTML = `
    <div class="subheader">
      <button class="icon-btn" data-action="go-dashboard" data-icon="back" title="Back">${icons.back()}</button>
      <h1>Faucet</h1>
      <span class="subheader-spacer"></span>
    </div>
    <label class="field">
      <span>Amount, raw units (max 10,000 per claim)</span>
      <input type="text" id="faucet-amount" value="1000" />
    </label>
    <button class="btn primary" id="faucet-claim-btn">Claim on-chain</button>
    <p class="error hidden" id="faucet-error"></p>
    <p class="hint" id="faucet-status"></p>
    <a class="btn secondary link-btn hidden" id="faucet-explorer-link" href="#" target="_blank" rel="noopener">View transaction on explorer</a>
  `;

  const claimBtn = container.querySelector('#faucet-claim-btn');
  const handleClaim = async () => {
    const amountInput = container.querySelector('#faucet-amount');
    const errorEl = container.querySelector('#faucet-error');
    const linkEl = container.querySelector('#faucet-explorer-link');
    const amount = Number(amountInput.value.trim());

    // Clear previous state
    setError(errorEl, '');
    linkEl?.classList.add('hidden');

    if (!Number.isInteger(amount) || amount <= 0 || amount > Number(FAUCET_MAX_PER_CLAIM)) {
      setError(errorEl, `Enter a whole number between 1 and ${FAUCET_MAX_PER_CLAIM}.`);
      return;
    }

    claimBtn.disabled = true;
    claimBtn.textContent = 'Claiming…';

    try {
      const network = walletStore.getState().activeNetwork;
      const result = await bridge.send('tx.claimFaucet', { amountUnits: amount });
      if (result && result.signature) {
        showToast(`Claimed ${amount} raw units`, 'success');
        linkEl.href = explorerTxUrl(network, result.signature);
        linkEl.classList.remove('hidden');
      } else {
        showToast('Claimed', 'success');
      }
      events.emit(Events.BALANCE_UPDATED);
    } catch (err) {
      setError(errorEl, err.message);
    } finally {
      claimBtn.disabled = false;
      claimBtn.textContent = 'Claim on-chain';
    }
  };
  claimBtn?.addEventListener('click', handleClaim);
  _unsubs.push(() => claimBtn?.removeEventListener('click', handleClaim));
}

function setError(el, message) {
  if (!el) return;
  if (!message) {
    el.classList.add('hidden');
    el.textContent = '';
  } else {
    el.classList.remove('hidden');
    el.textContent = message;
  }
}

/**
 * Cleanup the faucet screen.
 */
export function cleanup() {
  for (const unsub of _unsubs) {
    try { unsub(); } catch { /* ignore */ }
  }
  _unsubs = [];
}
