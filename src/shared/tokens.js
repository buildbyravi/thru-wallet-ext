// Canonical token definitions for Thru blockchain.
// Central source of truth for native currency and asset constants across backend and UI.

export const NATIVE_TOKEN = Object.freeze({
  symbol: 'THRU',
  name: 'Thru Native Token',
  decimals: 9,
  isNative: true,
  mintAddress: null,
  logoUrl: 'icons/thru.png',
});

export const APP_ICON_URL = 'icons/icon128.png';

// Shared token balance wire semantics. A proven absent account is zero, not an RPC miss.
export function isVerifiedTokenBalance(row) {
  if (row?.error !== false) return false;
  if (row.tokenAccountExists === false) return row.amountUnits === null;
  return row.tokenAccountExists === true && typeof row.amountUnits === 'string'
    && /^(0|[1-9]\d*)$/.test(row.amountUnits)
    && (row.amountUnits === '0'
      || (Number.isInteger(row.decimals) && row.decimals >= 0 && row.decimals <= 18));
}
