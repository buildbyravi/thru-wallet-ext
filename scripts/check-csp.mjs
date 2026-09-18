// Keep the extension's RPC allowlist aligned with the networks it can actually select.
//
// A network is safe to enable only when its RPC origin is reachable by the extension. The inverse
// matters too: an origin in connect-src is an authorization to make requests, so it must belong to
// an enabled, verified network. Disabled networks stay out of the policy until someone deliberately
// enables them and updates both files.
//
// Run: node scripts/check-csp.mjs

import { readFileSync } from 'node:fs';
import { listAllNetworks } from '../src/lib/networks.js';

const manifest = JSON.parse(readFileSync('src/manifest.json', 'utf8'));
const policy = manifest.content_security_policy?.extension_pages || '';
const directives = policy.split(';').map((part) => part.trim()).filter(Boolean);
const connectDirective = directives.find((part) => /^connect-src(?:\s|$)/.test(part));

if (!connectDirective) {
  console.error('CSP check failed: extension_pages has no connect-src directive.');
  process.exit(1);
}

const sources = connectDirective.split(/\s+/).slice(1);

/**
 * Return a comparable origin for an RPC URL. CSP allows wildcard ports, which URL does not parse
 * as an origin, so the allowlist keeps a small explicit representation for that case.
 */
function originOf(value) {
  const raw = String(value || '').trim();
  const wildcard = /^(https?):\/\/([^/:]+|\[[^\]]+\]):\*$/i.exec(raw);
  if (wildcard) return `${wildcard[1].toLowerCase()}://${wildcard[2].toLowerCase()}:*`;

  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol)) return null;
  return url.origin.toLowerCase();
}

function cspOriginSources() {
  return sources
    .filter((source) => /^https?:\/\//i.test(source))
    .map((source) => ({ source, origin: originOf(source) }))
    .filter(({ origin }) => origin);
}

function originMatches(cspOrigin, rpcOrigin) {
  if (cspOrigin === rpcOrigin) return true;
  // A wildcard port is only a port wildcard; protocol and host remain exact.
  const wildcard = /^(https?):\/\/([^:]+):\*$/i.exec(cspOrigin || '');
  if (!wildcard) return false;
  const rpc = /^(https?):\/\/([^:]+)(?::(\d+))?$/i.exec(rpcOrigin || '');
  return Boolean(rpc)
    && wildcard[1].toLowerCase() === rpc[1].toLowerCase()
    && wildcard[2].toLowerCase() === rpc[2].toLowerCase();
}

const allNetworks = listAllNetworks();
const enabled = allNetworks.filter((network) => network.enabled === true);
const disabled = allNetworks.filter((network) => network.enabled !== true);
const cspOrigins = cspOriginSources();
const errors = [];

for (const network of enabled) {
  const rpcOrigin = originOf(network.rpcUrl);
  if (!rpcOrigin) {
    errors.push(`${network.id}: rpcUrl is not a valid http(s) origin (${network.rpcUrl})`);
    continue;
  }
  if (!cspOrigins.some(({ origin }) => originMatches(origin, rpcOrigin))) {
    errors.push(`${network.id}: enabled RPC origin ${rpcOrigin} is missing from connect-src`);
  }
}

for (const { source, origin } of cspOrigins) {
  const matchingEnabled = enabled.filter((network) => {
    const rpcOrigin = originOf(network.rpcUrl);
    return rpcOrigin && originMatches(origin, rpcOrigin);
  });
  if (!matchingEnabled.length) {
    errors.push(`connect-src origin ${source} does not map to an enabled network`);
  }
}

for (const network of disabled) {
  const rpcOrigin = originOf(network.rpcUrl);
  if (rpcOrigin && cspOrigins.some(({ origin }) => originMatches(origin, rpcOrigin))) {
    errors.push(`${network.id}: disabled RPC origin ${rpcOrigin} is present in connect-src`);
  }
}

if (errors.length) {
  console.error(`\nCSP/network consistency failed (${errors.length} issue${errors.length === 1 ? '' : 's'}):`);
  for (const error of errors) console.error(`  - ${error}`);
  console.error('\nEnable a network only with two deliberate edits: networks.js and manifest.json.');
  process.exit(1);
}

const enabledSummary = enabled.map((network) => `${network.id}=${originOf(network.rpcUrl)}`).join(', ');
console.log(`CSP/network consistency OK — ${enabled.length} enabled network(s): ${enabledSummary}`);
console.log(`Disabled network origins remain unreachable: ${disabled.length} checked.`);
