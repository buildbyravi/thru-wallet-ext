// Domain record decoder — review content for appending key/value text records to a .thru domain.
import {
  row, warn, feeBlock, instruction, accountRole, executionBlock,
} from './common.js';

export const DOMAIN_RECORD_KIND = 'domain-record';

export function decodeDomainRecord({ facts }) {
  const warnings = [];

  if (facts.isOwner === false) {
    warnings.push(warn('not-name-owner', 'danger',
      'You do not own this domain',
      `Only the domain owner (${facts.ownerAddress ? facts.ownerAddress.slice(0, 12) + '…' : 'another account'}) can set records on '${facts.name}.${facts.tld}'.`,
      { blocking: true }));
  }

  if (facts.domainExists === false) {
    warnings.push(warn('domain-absent', 'danger',
      'Domain does not exist',
      `'${facts.name}.${facts.tld}' is not registered on-chain.`,
      { blocking: true }));
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

  if (facts.unchanged) {
    warnings.push(warn('record-unchanged', 'info',
      'Record value is already set',
      `'${facts.key}' on '${facts.name}.${facts.tld}' is already '${facts.value}'. Submitting will re-append the record.`));
  }

  const progName = facts.program?.name || 'Thru Name Service';
  const progAddr = facts.program?.address || null;
  const progVer = facts.program?.address ? Boolean(facts.program?.verified) : false;
  const progSrc = facts.program?.source
    || 'Pinned system program at BOOTSTRAP_PROGRAM_ADDRESSES.name_service';

  return {
    operation: {
      id: DOMAIN_RECORD_KIND,
      name: 'Set domain record',
      summary: `Set record '${facts.key}' on '${facts.name}.${facts.tld}'.`,
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
      accounts: facts.domainAddress ? [
        accountRole(facts.domainAddress, 'Domain account', {
          signer: false, writable: true, verified: true,
          note: `State account for '${facts.name}.${facts.tld}'`,
        }),
      ] : [],
    }),
  };
}
