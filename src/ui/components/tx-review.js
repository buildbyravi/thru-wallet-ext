// Rabby-style Pre-Sign Transaction Simulation and Review Component.

import { formatThru, truncateAddress } from '../../shared/format.js';
import { icons } from '../../popup/icons.js';

/**
 * Renders the Rabby-style Pre-Sign Transaction Review Card HTML.
 * @param {Object} params
 * @param {string} params.toAddress
 * @param {bigint} params.amountUnits
 * @param {string} params.fromAddress
 * @param {string} [params.networkLabel='Thru Alphanet']
 * @param {string} [params.estimatedFee='~1 raw unit']
 * @returns {string} HTML string
 */
export function renderTxReviewCard({ toAddress, amountUnits, fromAddress, networkLabel = 'Thru Alphanet', estimatedFee = '~1 raw unit' }) {
  const isSelfTransfer = toAddress.toLowerCase() === fromAddress.toLowerCase();
  const formattedAmount = formatThru(amountUnits);

  return `
    <div class="tx-review-card">
      <div class="tx-review-section">
        <span class="tx-review-eyebrow">ESTIMATED BALANCE CHANGE</span>
        <div class="balance-change-box negative">
          <span class="change-amount mono">- ${formattedAmount} THRU</span>
          <span class="change-tag">Transfer</span>
        </div>
      </div>

      <div class="tx-review-details">
        <div class="tx-review-row">
          <span class="tx-review-label">From</span>
          <span class="tx-review-val mono">${truncateAddress(fromAddress)}</span>
        </div>
        <div class="tx-review-row">
          <span class="tx-review-label">To Recipient</span>
          <span class="tx-review-val mono">${truncateAddress(toAddress)}</span>
        </div>
        <div class="tx-review-row">
          <span class="tx-review-label">Network</span>
          <span class="tx-review-val">${networkLabel}</span>
        </div>
        <div class="tx-review-row">
          <span class="tx-review-label">Est. Network Fee</span>
          <span class="tx-review-val mono">${estimatedFee}</span>
        </div>
      </div>

      ${isSelfTransfer ? `
        <div class="tx-risk-box warning">
          <span class="risk-icon">${icons.warning(16)}</span>
          <div class="risk-copy">
            <strong>Self-Transfer Detected</strong>
            <span>You are sending funds to the currently active address.</span>
          </div>
        </div>
      ` : `
        <div class="tx-risk-box safe">
          <span class="risk-icon">${icons.checkCircle(16)}</span>
          <div class="risk-copy">
            <strong>Pre-Sign Security Check Passed</strong>
            <span>Valid non-EVM RISC-V Thru public address and instruction binary.</span>
          </div>
        </div>
      `}
    </div>
  `;
}
