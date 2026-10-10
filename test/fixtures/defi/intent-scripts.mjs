// Intent lifecycle scripts (S13): five deterministic timelines for the pending-tx/intent UI,
// derived from S8. Each script is the ordered list of intentChanged emissions the UI will see,
// with the timing the backend commits to (ttl constants come from the capability limits).
//
// The pending-tx tracker REMAINS the single lifecycle store — a script never implies a second
// store or a silent state change: every transition here is an event the backend emits on
// purpose (S8: notifications only on real state changes).

export const INTENT_STATES = Object.freeze([
  'prepared',      // built, unsigned, ttl running (preparedTtlMs from limits)
  'waitingUser',   // review shown, waiting for the user to sign/reject
  'waitingChain',  // submitted, one or more txs in flight
  'settled',       // landed and reconciled
  'failed',        // on-chain or policy failure (errorCode says which; resumable says what next)
  'expired',       // ttl elapsed before submit
  'rejected',      // user rejected the review (terminal state change, per USER_REJECTED)
  'cancelled',     // user discarded a prepared/failed/expired intent
]);

export const INTENT_ERROR_CODES = Object.freeze(['TX_DROPPED', 'TX_REPLACED', 'SIMULATION_FAILED', 'PROGRAM_ERROR', 'SLIPPAGE_EXCEEDED']);

export const INTENT_SCRIPTS = Object.freeze([
  {
    name: 'settled-fresh',
    kind: 'token-transfer',
    note: 'Happy path: prepare -> review -> submit -> chain confirms before any timeout.',
    events: [
      { atMs: 0, status: 'prepared', meta: { bindingHash: 'bh_s1_a', ttlMs: 120000 } },
      { atMs: 700, status: 'waitingUser', meta: { bindingHash: 'bh_s1_a' } },
      { atMs: 4200, status: 'waitingChain', meta: { signature: 'sig_s1_1' } },
      { atMs: 9800, status: 'settled', meta: { signature: 'sig_s1_1' } },
    ],
  },
  {
    name: 'settled-after-reprepare',
    kind: 'swap',
    note: 'Quote went stale at review time; rePrepare produces a NEW bindingHash, the user '
      + 'reviews the fresh hash, and only that hash can be submitted (BINDING_MISMATCH otherwise).',
    events: [
      { atMs: 0, status: 'prepared', meta: { bindingHash: 'bh_s2_a', ttlMs: 120000 } },
      { atMs: 900, status: 'waitingUser', meta: { bindingHash: 'bh_s2_a' } },
      { atMs: 15600, status: 'prepared', meta: { bindingHash: 'bh_s2_b', ttlMs: 120000, reason: 'reprepared' } },
      { atMs: 15800, status: 'waitingUser', meta: { bindingHash: 'bh_s2_b' } },
      { atMs: 21000, status: 'waitingChain', meta: { signature: 'sig_s2_1' } },
      { atMs: 27400, status: 'settled', meta: { signature: 'sig_s2_1' } },
    ],
  },
  {
    name: 'dropped-resume',
    kind: 'token-transfer',
    note: 'First submission never lands (TX_DROPPED is resumable). intent.resume repins the '
      + 'same intent with a fresh nonce and a new submission; the intentId never changes.',
    events: [
      { atMs: 0, status: 'prepared', meta: { bindingHash: 'bh_s3_a', ttlMs: 120000 } },
      { atMs: 800, status: 'waitingUser', meta: { bindingHash: 'bh_s3_a' } },
      { atMs: 3900, status: 'waitingChain', meta: { signature: 'sig_s3_1' } },
      { atMs: 66000, status: 'failed', meta: { errorCode: 'TX_DROPPED', resumable: true, signature: 'sig_s3_1' } },
      { atMs: 69000, status: 'waitingChain', meta: { signature: 'sig_s3_2', reason: 'resumed' } },
      { atMs: 75800, status: 'settled', meta: { signature: 'sig_s3_2' } },
    ],
  },
  {
    name: 'expired-discard',
    kind: 'swap',
    note: 'User never signs; the prepared intent expires at ttl, then the user discards it. '
      + 'An expired intent can never be submitted (INTENT_EXPIRED forces a fresh prepare).',
    events: [
      { atMs: 0, status: 'prepared', meta: { bindingHash: 'bh_s4_a', ttlMs: 120000 } },
      { atMs: 120000, status: 'expired', meta: { bindingHash: 'bh_s4_a' } },
      { atMs: 126000, status: 'cancelled', meta: { reason: 'user-discard' } },
    ],
  },
  {
    name: 'replaced-failed',
    kind: 'swap',
    note: 'Transaction replaced by policy (TX_REPLACED). Terminal and never silent: the '
      + 'notification is required, and continuing means a NEW intent (new intentId), not a resume.',
    events: [
      { atMs: 0, status: 'prepared', meta: { bindingHash: 'bh_s5_a', ttlMs: 120000 } },
      { atMs: 650, status: 'waitingUser', meta: { bindingHash: 'bh_s5_a' } },
      { atMs: 4100, status: 'waitingChain', meta: { signature: 'sig_s5_1' } },
      { atMs: 30000, status: 'failed', meta: { errorCode: 'TX_REPLACED', resumable: false, signature: 'sig_s5_1' } },
    ],
  },
]);
