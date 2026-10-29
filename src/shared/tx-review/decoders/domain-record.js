// Domain record decoder — review content for appending key/value text records to a .thru domain.
import {
  row, warn, feeBlock, instruction, accountRole, executionBlock,
} from './common.js';

export const DOMAIN_RECORD_KIND = 'domain-record';

export function decodeDomainRecord({ facts }) {
  const warnings = [];

  // Three states each (audit E-3, 2026-10-29): a failed read must never render as a proven
  // absence or a proven foreign owner. "Could not be verified" blocks too — a record write
  // without a verified owner is exactly the thing a review exists to prevent.
  if (facts.domainExists === false) {
    warnings.push(warn('domain-absent', 'danger',
      'Domain does not exist',
      `'${facts.name}.${facts.tld}' is not registered on-chain.`,
      { blocking: true }));
  } else if (facts.domainExists == null) {
    warnings.push(warn('domain-unverified', 'danger',
      'The domain could not be read',
      `The chain did not answer the lookup for '${facts.name}.${facts.tld}', so the wallet cannot `
      + 'prove the record write would land on a domain you own.', { blocking: true }));
  } else if (facts.isOwner === false) {
    warnings.push(warn('not-name-owner', 'danger',
      'You do not own this domain',
      `Only the domain owner (${facts.ownerAddress ? `${facts.ownerAddress.slice(0, 12)}…` : 'another account'}) can set records on '${facts.name}.${facts.tld}'.`,
      { blocking: true }));
  } else if (facts.isOwner == null) {
    warnings.push(warn('owner-unverified', 'danger',
      'Ownership could not be verified',
      `'${facts.name}.${facts.tld}' exists but its owner could not be read, so the wallet cannot `
      + 'prove this write is yours to make.', { blocking: true }));
  }

  if (facts.keyProblem) {
    warnings.push(warn('invalid-key', 'danger',
      'Invalid record key',
      facts.keyProblem,
      { blocking: true }));
  }

  if (facts.valueProblem) {
    warnings.push(warn('invalid-value', 'danger',
      'Invalid record value',
      facts.valueProblem,
      { blocking: true }));
  }

  // name-service opcode 2 is APPEND_RECORD. A key that already exists is not replaced: the new
  // value becomes a second record, and a reader that takes the first match keeps showing the old
  // one (this is what `find()` does in reverseLookup and in domainRecordFacts). Saying nothing
  // here would let "Set record" read as "replace".
  if (facts.unchanged) {
    warnings.push(warn('record-unchanged', 'info',
      'Record value is already set',
      `'${facts.key}' on '${facts.name}.${facts.tld}' is already '${facts.value}'. Submitting `
      + 'appends the same pair again.'));
  } else if (facts.existingValue != null) {
    warnings.push(warn('record-appends', 'warning',
      'A record with this key already exists',
      `'${facts.name}.${facts.tld}' already has '${facts.key}' = '${facts.existingValue}'. `
      + 'The name service APPENDS records, so the old value stays on the account and readers '
      + 'that take the first match will keep showing it.'));
  }

  const progName = facts.program?.name || 'Thru Name Service';
  const progAddr = facts.program?.address || null;
  const progVer = facts.program?.address ? Boolean(facts.program?.verified) : false;
  const progSrc = facts.program?.source
    || 'Pinned system program at BOOTSTRAP_PROGRAM_ADDRESSES.name_service';

  return {
    operation: {
      id: DOMAIN_RECORD_KIND,
      name: 'Add domain record',
      summary: `Append a '${facts.key}' record to '${facts.name}.${facts.tld}'.`,
      confirmLabel: 'Confirm and sign',
      decode: 'decoded',
    },
    protocol: {
      name: progName,
      address: progAddr,
      verified: progVer,
      source: progSrc,
    },
    summary: [
      row('Domain', `${facts.name}.${facts.tld}`, { mono: true }),
      row('Record Key', String(facts.key ?? ''), { mono: true }),
      row('Record Value', String(facts.value ?? ''), { mono: true }),
    ],
    assets: {
      outgoing: [],
      incoming: [],
      fee: feeBlock({
        supported: true,
        amountUnits: '0',
        reserveUnits: '0',
        source: 'declared-by-builder',
        note: 'Name service record operations declare a 0 network fee in the transaction header.',
      }),
      balanceAfter: null,
      balanceAfterNote: 'Thru has no verified dry-run, so no post-transaction balance is shown.',
    },
    warnings,
    acknowledgements: [],
    execution: executionBlock({
      program: {
        name: progName,
        address: progAddr,
        verified: progVer,
        source: progSrc,
      },
      instructions: [
        instruction('APPEND_RECORD (name-service opcode 2)', {
          decoded: true,
          note: `Append key '${facts.key}' with value '${facts.value}' to '${facts.name}.${facts.tld}'`,
        }),
      ],
      // accountRole(role, address) — two arguments. The first version passed the address as the
      // role and the string 'Domain account' as the address, so the advanced details printed a
      // row whose label was an address and whose value was the words "Domain account" (E-4).
      accounts: facts.domainAddress
        ? [accountRole('Domain account (written)', facts.domainAddress)]
        : [],
    }),
  };
}
