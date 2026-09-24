// Context pin for a reviewed send. The popup and side panel can both be open, and a best-effort
// accountsChanged/networkChanged event may be delayed or missed while a password dialog is up.
// Legacy tx.send / token.transfer stay in the append-only contract, but their new checked
// counterparts require the account and chain displayed at Review to still be active here.

import { getActiveNetworkId } from './network-service.js';

export async function assertSendContext(expected, payer) {
  if (!expected) return; // legacy methods have no reviewed-context parameter
  const { fromAddress, networkId } = expected;
  if (typeof fromAddress !== 'string' || !fromAddress
    || typeof networkId !== 'string' || !networkId) {
    const error = new Error('A reviewed source account and network are required to send.');
    error.code = 'INVALID_REQUEST';
    error.retryable = false;
    throw error;
  }

  const currentNetworkId = await getActiveNetworkId();
  if (payer?.address !== fromAddress || currentNetworkId !== networkId) {
    const error = new Error('The sending account or network changed. Return to Send and review again.');
    error.code = 'SEND_CONTEXT_CHANGED';
    error.retryable = false;
    throw error;
  }
}
