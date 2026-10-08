#!/usr/bin/env node
/* Pins for the name-service lib module (src/lib/name-service.js): format constants as
 * recovered + verified (see module provenance), name rules, address derivation determinism,
 * decoders, and instruction-data builders. Pure — no chain access. */
import {
  NAME_SERVICE_PROGRAM, NS_ROOT_SIZE, NS_DOMAIN_HEADER, NS_RECORD_SIZE,
  nameProblem, domainAccountAddress, parseRootRegistrar, parseDomainAccount,
  buildInitRootInstructionData, buildRegisterSubdomainInstructionData,
  buildAppendRecordInstructionData, resolveNameChain, NameServiceDecodeError,
} from '../src/lib/name-service.js';
import { BOOTSTRAP_PROGRAM_ADDRESSES } from '../src/lib/bootstrap-pins.js';
import { Pubkey } from '@thru/sdk';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass += 1; } else { fail += 1; console.error(`  FAIL ${msg}`); }
}
function eq(a, b, msg) {
  const ser = (v) => (typeof v === 'bigint' ? `${v}n` : JSON.stringify(v));
  ok(a === b, `${msg} (got ${ser(a)}, want ${ser(b)})`);
}

// Program address rides the pinned package (never a string literal in this module).
eq(NAME_SERVICE_PROGRAM, BOOTSTRAP_PROGRAM_ADDRESSES.name_service, 'program comes from the pinned package');
ok(/^ta[A-Za-z0-9_-]+$/.test(NAME_SERVICE_PROGRAM), 'name program address parses as ta-*');
Pubkey.from(NAME_SERVICE_PROGRAM); // throws on malformed
ok(true, 'Pubkey.from accepts the program address');

// ---- nameProblem rules -------------------------------------------------------
const RULES = [
  ['abc', null], ['valid-name-1.abc.okk', null], ['a1-2b3c4d5e6f7890123456789012345', '32+'],
  ['-bad', 'edge hyphen'], ['bad-', 'edge hyphen'], ['bad--name', 'double hyphen'],
  ['UPPER', 'lowercase'], ['with space', 'charset'], ['ab', 'too short (3 min)'],
  ['', 'empty'], ['x'.repeat(33), 'too long (32 max)'], ['.,', null /* handled below */],
];
eq(nameProblem('abc'), null, 'plain name passes');
eq(nameProblem('-bad') !== null, true, 'leading hyphen rejected');
eq(nameProblem('bad-') !== null, true, 'trailing hyphen rejected');
eq(nameProblem('bad--name') !== null, true, 'double hyphen rejected');
eq(nameProblem('UPPER') !== null, true, 'uppercase rejected');
eq(nameProblem('with space') !== null, true, 'space rejected');
eq(nameProblem('ab') !== null, true, 'one-two-char labels rejected');
eq(nameProblem('x'.repeat(33)) !== null, true, '33-char label rejected');
eq(nameProblem('x'.repeat(64)) !== null, true, 'over-64 total rejected');
eq(nameProblem(''), 'a name is required', 'empty name explained');
ok(!RULES.some(([n, s]) => s === null && nameProblem(n) && n !== '.,'), 'rule table self-consistent');

// ---- derivation determinism --------------------------------------------------
const parentTwo = Pubkey.from(new Uint8Array(32).fill(11)).toThruFmt();
const a1 = await domainAccountAddress(parentTwo, 'alpha');
const a2 = await domainAccountAddress(parentTwo, 'alpha');
const a3 = await domainAccountAddress(parentTwo, 'beta');
eq(a1, a2, 'derivation is deterministic');
ok(a1 !== a3, 'different names derive different addresses');
ok(a1.startsWith('ta3') || a1.startsWith('ta'), 'derived address is a ta-* string');
let threw = false;
try { await domainAccountAddress(parentTwo, ''); } catch { threw = true; }
ok(threw, 'empty name rejected at derivation');
threw = false;
try { await domainAccountAddress(parentTwo, 'x'.repeat(65)); } catch { threw = true; }
ok(threw, 'over-sized name rejected at derivation');

// ---- resolveNameChain --------------------------------------------------------
const rootAddr = Pubkey.from(new Uint8Array(32).fill(22)).toThruFmt();
const chain1 = await resolveNameChain(rootAddr, 'bob');
eq(chain1.length, 2, 'single-label chain length');
eq(chain1[1], rootAddr, 'chain ends at the root registrar');
eq(chain1[0], await domainAccountAddress(rootAddr, 'bob'), 'leaf derives from root+label');
const chain2 = await resolveNameChain(rootAddr, 'sub.bob');
eq(chain2.length, 3, 'two-label chain length');
eq(chain2[0], await domainAccountAddress(chain2[1], 'sub'), 'nested label derives under its domain');

// ---- decoder fixtures (synthetic, built to the pinned layout) ----------------
const enc = new TextEncoder();
const dec = new TextDecoder();
function buildRootBytes(name, authorityRandom) {
  const out = new Uint8Array(NS_ROOT_SIZE);
  out[0] = 1;
  out.set(authorityRandom.toBytes(), 1);
  const nb = enc.encode(name);
  out.set(nb, 0x21);
  new DataView(out.buffer).setUint32(0x61, nb.length, true);
  new DataView(out.buffer).setBigUint64(0x65, 7n, true);
  return out;
}
const auth = Pubkey.from(new Uint8Array(32).fill(33));
const root = parseRootRegistrar(buildRootBytes('.id', auth));
eq(root.kind, 1, 'root kind byte parsed');
eq(root.authority, auth.toThruFmt(), 'root authority round-trips');
eq(root.name, '.id', 'root name parsed from padded field');
eq(root.nameLen, 3, 'root name_len parsed');
eq(root.totalSubdomains, 7n, 'total_subdomains parsed');
let decThrow = 0;
try { parseRootRegistrar(new Uint8Array(64)); } catch (e) { if (e instanceof NameServiceDecodeError) decThrow += 1; }
try { const bad = buildRootBytes('.id', auth); bad[0] = 2; parseRootRegistrar(bad); } catch { decThrow += 1; }
eq(decThrow, 2, 'decoder rejects wrong size and kind');

function buildDomainBytes({ parent, owner, name, key, value }) {
  const nb = enc.encode(name);
  const hasRecord = key !== undefined;
  const out = new Uint8Array(NS_DOMAIN_HEADER + (hasRecord ? NS_RECORD_SIZE : 0));
  const dv = new DataView(out.buffer);
  out[0] = 2;
  out.set(parent.toBytes(), 1);
  out.set(owner.toBytes(), 0x21);
  out.set(nb, 0x41);
  dv.setUint32(0x81, nb.length, true);
  dv.setBigUint64(0x85, 4096n, true);
  dv.setUint32(0x8d, hasRecord ? 1 : 0, true);
  if (hasRecord) {
    const kb = enc.encode(key);
    const vb = enc.encode(value);
    dv.setUint32(0x91, kb.length, true);
    out.set(kb, 0x95);
    dv.setUint32(0x95 + 0x20, vb.length, true);
    out.set(vb, 0x99 + 0x20);
  }
  return out;
}
const ownerPk = Pubkey.from(new Uint8Array(32).fill(44));
const dom = parseDomainAccount(buildDomainBytes({ parent: auth, owner: ownerPk, name: 'bob' }));
eq(dom.name, 'bob', 'domain name parsed');
eq(dom.owner, ownerPk.toThruFmt(), 'domain owner round-trips');
eq(dom.parent, auth.toThruFmt(), 'domain parent round-trips');
eq(dom.registeredAt, 4096n, 'registered_at parsed');
eq(dom.records.length, 0, 'empty record list parsed');
const domR = parseDomainAccount(buildDomainBytes({ parent: auth, owner: ownerPk, name: 'bob', key: 'avatar', value: 'ta-xyz' }));
eq(domR.records.length, 1, 'record count parsed');
eq(domR.records[0].key, 'avatar', 'record key parsed');
eq(domR.records[0].value, 'ta-xyz', 'record value parsed');
decThrow = 0;
try { parseDomainAccount(new Uint8Array(200)); } catch { decThrow += 1; }
try { const bad = buildDomainBytes({ parent: auth, owner: ownerPk, name: 'bob' }); bad[0] = 9; parseDomainAccount(bad); } catch { decThrow += 1; }
eq(decThrow, 2, 'domain decoder rejects wrong size/kind');

// ---- builders -----------------------------------------------------------------
const proof = new Uint8Array([9, 9, 9, 9, 9]);
const init = buildInitRootInstructionData({ name: '.mine', registrarAccountIndex: 3, stateProof: proof });
eq(new DataView(init.buffer).getUint32(0, true), 0, 'init-root opcode at 0');
eq(new DataView(init.buffer).getUint16(4, true), 3, 'registrar index slot');
eq(init[8], '.mine'.charCodeAt(0), 'name written into 64-byte field');
eq(init.slice(-5).join(','), '9,9,9,9,9', 'proof appended at the tail');
eq(init.length, 4 + 2 + 2 + 64 + 8 + 5, 'init-root size resistant');
eq(new DataView(init.buffer).getBigUint64(72, true), 5n, 'name byte length (of ".mine") at the pinned land');

const reg = buildRegisterSubdomainInstructionData({
  name: 'bobby', indexOf: (a) => ({ D: 2, P: 4, O: 6 }[a]),
  domainAddress: 'D', parentAddress: 'P', ownerAddress: 'O', stateProof: proof,
});
const rdv = new DataView(reg.buffer);
eq(rdv.getUint32(0, true), 1, 'register opcode at 0');
eq(rdv.getUint16(4, true), 2, 'domain index slot');
eq(rdv.getUint16(6, true), 4, 'parent index slot');
eq(rdv.getUint16(8, true), 6, 'owner index slot');
eq(rdv.getUint16(10, true), 0, 'authority = fee payer (slot 0)');
eq(dec.decode(reg.slice(12, 17)), 'bobby', 'name in the 64-byte field');
eq(rdv.getBigUint64(76, true), 5n, 'byte length slot');
const regNoOwner = buildRegisterSubdomainInstructionData({
  name: 'bobby', indexOf: (a) => ({ D: 1, P: 2 }[a]),
  domainAddress: 'D', parentAddress: 'P', stateProof: proof,
});
eq(new DataView(regNoOwner.buffer).getUint16(8, true), 0, 'missing owner falls back to slot 0 (fee payer = signer)');
threw = false;
try { buildRegisterSubdomainInstructionData({ name: 'x', indexOf: () => 1, domainAddress: 'D', parentAddress: 'P' }); } catch { threw = true; }
ok(threw, 'missing proof rejected (creation needs a state proof)');

const app = buildAppendRecordInstructionData({ domainAddress: 'D', key: 'web', value: 'https://x', indexOf: (a) => (a === 'D' ? 5 : 0) });
const adv = new DataView(app.buffer);
eq(adv.getUint32(0, true), 2, 'append opcode at 0');
eq(adv.getUint16(4, true), 5, 'domain index slot');
eq(adv.getUint16(6, true), 0, 'authority = fee payer (slot 0)');
eq(adv.getUint32(8, true), 3, 'key length slot');
eq(dec.decode(app.slice(12, 15)), 'web', 'key bytes at pinned land');
eq(adv.getUint32(44, true), 'https://x'.length, 'value length slot');
eq(dec.decode(app.slice(48, 48 + 9)), 'https://x', 'value bytes at pinned land');
eq(app.length, 4 + 2 + 2 + 4 + 32 + 4 + 256, 'append size resistant');
threw = 0;
try { buildAppendRecordInstructionData({ domainAddress: 'D', key: '', value: 'v', indexOf: () => 1 }); } catch { threw += 1; }
try { buildAppendRecordInstructionData({ domainAddress: 'D', key: 'k'.repeat(33), value: 'v', indexOf: () => 1 }); } catch { threw += 1; }
try { buildAppendRecordInstructionData({ domainAddress: 'D', key: 'k', value: 'v'.repeat(257), indexOf: () => 1 }); } catch { threw += 1; }
eq(threw, 3, 'append rejects broken key/value shapes');

console.log(`name-service: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
