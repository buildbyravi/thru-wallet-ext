// @thru/programs 0.5.x token accounts carry a one-byte account-type discriminator:
// byte 0 = 1 (mint) or 2 (token account), followed by the old ABI payload. Build both shapes
// through the official generated wrapper so the fixtures stay byte-exact with the package.

import { TokenProgramAccount } from '@thru/programs/token';

export function wrapTokenAccount(kind, payload) {
  return TokenProgramAccount.builder()
    .payload()
    .select(kind)
    .writePayload(payload)
    .finish()
    .build();
}

export const mintAccountBytes = (payload) => wrapTokenAccount('mint_v1', payload);
export const tokenAccountBytes = (payload) => wrapTokenAccount('token_account_v1', payload);
