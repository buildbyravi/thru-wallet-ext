#!/usr/bin/env node
/* Pins for the automatic resource-unit budgeting module (src/lib/tx-units.js):
 * live-proven floors, payload scaling parity with the SDK's own estimator, ceiling
 * clamps, and the fee policy. */
import { autoUnits, payloadFloor, noteExecution, observedMaxima, UNIT_CLASS, GLOBAL_CEILINGS } from '../src/lib/tx-units.js';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) pass += 1; else { fail += 1; console.error(`  FAIL ${msg}`); }
}
function eq(a, b, msg) { ok(a === b, `${msg} (got ${a}, want ${b})`); }

// — Live-proven floors are returned for the documented shapes —
const claim = autoUnits({ kind: UNIT_CLASS.CLAIM, bytes: 16, accounts: 1, balanceUnits: 1000n });
eq(claim.computeUnits, 300_000, 'claim computeUnits = thruscan-proven floor at claim payload sizes');
eq(claim.memoryUnits, 10_000, 'claim memoryUnits = thruscan-proven floor');
eq(claim.stateUnits, 1_024, 'claim stateUnits = thruscan-proven floor (payload formula yields far less at 16B)');
eq(claim.fee, 1n, 'funded fee payer tips the base unit');

const claimEmpty = autoUnits({ kind: UNIT_CLASS.CLAIM, bytes: 16, accounts: 1, balanceUnits: 0n });
eq(claimEmpty.fee, 0n, 'empty accounts pay nothing (fresh claims are free)');

const create = autoUnits({ kind: UNIT_CLASS.CREATE, bytes: 0, accounts: 1, balanceUnits: 0n });
eq(create.computeUnits, 10_000, 'create computeUnits = SDK-0.4.0-era proven default when payload is tiny');
const tokenBig = autoUnits({ kind: UNIT_CLASS.TOKEN_OP, bytes: 200_000 });
eq(tokenBig.computeUnits, 800_000, 'compute scales 4x bytes above the class floor for large payloads');
eq(create.stateUnits, 3, 'create stateUnits = payload formula (0B, 1 account → ceil(64/4096)+2 = 3)');
ok(create.stateUnits >= 1, 'create stateUnits respects the floor');

// payload scaling monotonic + parity with the SDK estimator formula
const big = payloadFloor({ bytes: 100_000, accounts: 3 });
eq(big.stateUnits, Math.ceil((100_000 + 64 * 3) / 4096) + 3 + 1, 'payload formula matches the SDK estimator shape');
eq(big.computeUnits, Math.min(GLOBAL_CEILINGS.computeUnits, 1_000_000 + 4 * 100_000), 'compute formula parity');
ok(payloadFloor({ bytes: 50_000 }).computeUnits < big.computeUnits, 'compute scales with bytes');
ok(autoUnits({ kind: UNIT_CLASS.TOKEN_OP, bytes: 200_000 }).computeUnits <= GLOBAL_CEILINGS.computeUnits, 'compute clamped at the SDK ceiling');

// ceiling clamp: stateUnits never exceed the live per-block limit
const overCeiling = autoUnits({ kind: UNIT_CLASS.TOKEN_OP, bytes: 40_000_000, accounts: 10, maxStateUnitsPerBlock: 8_192 });
eq(overCeiling.stateUnits, 8_192, 'stateUnits clamped at the live per-block ceiling when the payload demands more');
const customCeiling = autoUnits({ kind: UNIT_CLASS.TRANSFER, maxStateUnitsPerBlock: 100 });
eq(customCeiling.stateUnits, 100, 'small live ceiling honoured below the thruscan floor when the chain demands it');

// unknown class refuses rather than inventing a budget
let threw = false;
try { autoUnits({ kind: 'alchemy' }); } catch { threw = true; }
ok(threw, 'unknown class is refused honestly');

// calibration hook accumulates worst-case readings
noteExecution(UNIT_CLASS.CLAIM, { consumedComputeUnits: 5_000, consumedMemoryUnits: 2_000, consumedStateUnits: 12 });
noteExecution(UNIT_CLASS.CLAIM, { consumedComputeUnits: 9_000, consumedMemoryUnits: 1_000, consumedStateUnits: 8 });
const maxa = observedMaxima();
eq(maxa[UNIT_CLASS.CLAIM].computeUnits, 9_000, 'calibration keeps the worst compute reading');
eq(maxa[UNIT_CLASS.CLAIM].memoryUnits, 2_000, 'calibration keeps the worst memory reading');
eq(maxa[UNIT_CLASS.CLAIM].stateUnits, 12, 'calibration keeps the worst state reading');

console.log(`tx-units: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
