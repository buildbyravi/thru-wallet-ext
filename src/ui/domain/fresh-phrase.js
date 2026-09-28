/**
 * One-shot handoff for a recovery phrase generated in THIS session.
 *
 * wallet.create returns the mnemonic so onboarding can show it immediately — every
 * mainstream wallet does, and the create screen itself already has that disclosure window.
 * The backup step that follows must therefore skip its "enter password to reveal" gate:
 * the user set the password seconds ago, and re-authenticating mid-onboarding is friction
 * that pushes people to click past the most important screen in the product.
 *
 * The offer is keyed by the export link's ref token, consumed exactly once, and dropped
 * wholesale on lock or teardown. In-wallet "back up / view recovery phrase" routes keep
 * their password gate — this handoff is for the create path only.
 */

const offers = new Map();

export function offerFreshPhrase(refToken, mnemonic) {
  if (refToken && mnemonic) {
    // Shaped like the wallet.exportSecret result the reveal step already consumes.
    offers.set(String(refToken), { kind: 'hd', mnemonic: String(mnemonic) });
  }
}

export function takeFreshPhrase(refToken) {
  const phrase = offers.get(String(refToken));
  offers.delete(String(refToken));
  return phrase || null;
}

/** Drop every held phrase — wired to lock and route teardown. */
export function clearFreshPhrases() {
  offers.clear();
}
