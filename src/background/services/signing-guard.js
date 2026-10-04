// Process-local guard that prevents active-network mutation while a signing operation is in flight.
//
// Thru's SDK adapter currently owns one mutable network binding. Until the SDK boundary can expose
// immutable per-network clients, allowing network.setActive during build/sign/submit can make one
// operation observe two chains. Every signing service enters this guard before reading the active
// account/network and leaves only after submission has resolved or failed.

let activeOperations = 0;

export function beginSigningOperation() {
  activeOperations += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeOperations = Math.max(0, activeOperations - 1);
  };
}

export function assertNetworkSwitchAllowed() {
  if (activeOperations === 0) return;
  const error = new Error('A transaction is being signed or submitted. Wait for it to finish before switching networks.');
  error.code = 'SIGNING_IN_PROGRESS';
  error.retryable = true;
  throw error;
}

export function hasActiveSigningOperation() {
  return activeOperations > 0;
}
