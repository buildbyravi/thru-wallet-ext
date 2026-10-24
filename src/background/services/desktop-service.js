// Desktop surface (M0): LOCAL routing to an in-extension Desktop page.
//
// No Desktop page exists in this build (the popups are the only extension pages, enforced by
// the launchpad-quarantine dist checks), and DEFI_DESKTOP is false. desktop.open therefore
// answers the honest wire value { enabled:false, reason:'FLAG_OFF' } instead of opening
// nothing. When the page ships this handler becomes the single answer to "which Desktop lane
// can I route to", which is exactly what pinned navigation (DEFI R16 adjacent: state survives
// refresh) needs.

import { gateOrThrow, featureDisabledError } from './defi/gating.js';

export async function openDesktop() {
  const { proceed, data } = gateOrThrow({ gate: 'DEFI_DESKTOP', feature: null, env: 'result', label: 'Desktop surface' });
  if (!proceed) {
    // { supported:false, reason } re-shapes into the DesktopPage wire form: enabled + reason.
    return { enabled: false, reason: data.reason };
  }
  // Unreachable at M0 (no Desktop page is built). Loud, not silent, if a flag ships early.
  throw featureDisabledError('Desktop surface');
}
