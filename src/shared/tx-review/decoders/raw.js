// Unknown / raw transaction decoder.
//
// This is the honest escape hatch for a transaction the wallet cannot explain. It exists
// because "we could not decode this" must be a first-class, clearly-labelled review — not a
// guessed friendly name, and not a silent refusal to show anything.
//
// What it renders: exactly the facts a caller supplied (program, instruction data, account
// roles), a `decode: 'unknown'` state and a danger warning. What it never does: invent an
// operation name, claim verification, or become submittable. A raw review is display-only by
// construction — the background refuses to attach a submit policy to it, so there is no path
// from this screen to a signature.
//
// Reachable today only through `tx.prepareReview({ kind: 'raw', ... })` (API-level; no shipped
// screen submits raw transactions because the wallet has no dApp provider). When one arrives,
// it renders here until a real decoder exists.

import { row, warn, executionBlock, accountRole } from './common.js';

export const RAW_KIND = 'raw';

export function decodeRawTransaction({ facts }) {
  const warnings = [
    warn('undecoded-transaction', 'danger',
      'This transaction cannot be decoded',
      'The wallet has no decoder for this program or instruction, so it cannot describe what '
      + 'the transaction would do. Nothing below is a guarantee. Do not approve a transaction '
      + 'you cannot explain.', { blocking: true }),
  ];
  if (facts.programVerified === false) {
    warnings.push(warn('unverified-program', 'warning',
      'Program is not a pinned first-party deployment',
      facts.programNote || 'The program address does not match any address this wallet trusts.'));
  }

  const rows = [
    row('Program', facts.programAddress ?? 'unknown', { mono: true }),
    row('Instruction data', facts.dataHex ? `${facts.dataHex.length} hex characters` : 'not supplied'),
  ];
  if (facts.note) rows.push(row('Note', String(facts.note)));
  rows.push(row('Network', facts.networkLabel ?? ''));

  return {
    operation: {
      id: RAW_KIND,
      name: 'Unrecognized transaction',
      summary: 'A transaction this wallet cannot decode. Only raw details are available.',
      confirmLabel: null,
      decode: 'unknown',
    },
    protocol: facts.programAddress
      ? {
        name: facts.programName || 'Unrecognized program',
        address: facts.programAddress,
        verified: facts.programVerified === true,
        source: facts.programNote ?? 'Caller-supplied program address; not matched to a pinned deployment.',
      }
      : null,
    summary: rows,
    assets: {
      outgoing: [],
      incoming: [],
      fee: {
        supported: false,
        symbol: 'THRU',
        decimals: 9,
        amountUnits: null,
        reserveUnits: null,
        source: null,
        note: 'The wallet cannot decode this transaction, so it cannot describe its fee.',
      },
      balanceAfter: null,
      balanceAfterNote: 'The wallet cannot decode this transaction, so it cannot describe its effects.',
    },
    execution: executionBlock({
      program: facts.programAddress
        ? {
          name: facts.programName || 'Unrecognized program',
          address: facts.programAddress,
          verified: facts.programVerified === true,
        }
        : null,
      instructions: [{
        name: 'Undecoded instruction',
        decoded: false,
        note: facts.note || 'No instruction layout is known for this program.',
      }],
      accounts: (facts.accounts ?? []).map((entry) => accountRole(entry.role || 'Account', entry.address)),
      raw: facts.dataHex
        ? {
          format: 'hex',
          data: String(facts.dataHex),
          note: 'Uninterpreted instruction data, exactly as supplied.',
        }
        : null,
    }),
    warnings,
    acknowledgements: [],
  };
}
