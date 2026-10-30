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
  // One blocking statement, short enough to read on the card. The program's own identity is in
  // Details; a second warning saying the same thing twice made the card look louder, not safer.
  const warnings = [
    warn('undecoded-transaction', 'danger',
      'This transaction cannot be read',
      'This wallet cannot explain this transaction. Signing is unavailable.', { blocking: true }),
  ];

  const rows = [];
  if (facts.note) rows.push(row('Note', String(facts.note)));

  return {
    operation: {
      id: RAW_KIND,
      name: 'Unrecognised transaction',
      // Never an instruction to sign. There is no path from this card to a signature: the state
      // is blocked, `confirmLabel` is null and the background refuses an unknown intent. Copy
      // must not imply that a careful user could approve it anyway.
      summary: 'This wallet cannot explain this transaction. Signing is unavailable.',
      confirmLabel: null,
      decode: 'unknown',
    },
    protocol: facts.programAddress
      ? {
        name: facts.programName || 'Unrecognised program',
        address: facts.programAddress,
        verified: facts.programVerified === true,
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
        note: 'The wallet cannot read this transaction, so it cannot say what it costs.',
      },
      balanceAfter: null,
      balanceAfterNote: 'The wallet cannot read this transaction, so it cannot say what changes afterwards.',
    },
    execution: executionBlock({
      program: facts.programAddress
        ? {
          name: facts.programName || 'Unrecognised program',
          address: facts.programAddress,
          verified: facts.programVerified === true,
        }
        : null,
      instructions: [{
        name: 'Unrecognised instruction',
        decoded: false,
        note: facts.note || 'The wallet does not know how to read this program\'s data.',
      }],
      accounts: (facts.accounts ?? []).map((entry) => accountRole(entry.role || 'Account', entry.address)),
      raw: facts.dataHex
        ? {
          format: 'hex',
          data: String(facts.dataHex),
          note: 'The transaction data, exactly as given.',
        }
        : null,
    }),
    warnings,
    acknowledgements: [],
  };
}
