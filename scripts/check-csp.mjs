// Keep the extension's RPC allowlist aligned with the networks it can actually select.
//
// A network is safe to enable only when its RPC origin is reachable by the extension. The inverse
// matters too: an origin in connect-src is an authorization to make requests, so it must belong to
// an enabled, verified network. Disabled networks stay out of the policy until someone deliberately
// enables them and updates both files.
//
// Run: node scripts/check-csp.mjs

import { readdirSync, readFileSync } from "node:fs";
import { listAllNetworks } from "../src/lib/networks.js";

const manifest = JSON.parse(readFileSync("src/manifest.json", "utf8"));
const policy = manifest.content_security_policy?.extension_pages || "";
const directives = policy
  .split(";")
  .map((part) => part.trim())
  .filter(Boolean);
const connectDirective = directives.find((part) =>
  /^connect-src(?:\s|$)/.test(part),
);

if (!connectDirective) {
  console.error(
    "CSP check failed: extension_pages has no connect-src directive.",
  );
  process.exit(1);
}

const sources = connectDirective.split(/\s+/).slice(1);

/**
 * Return a comparable origin for an RPC URL. CSP allows wildcard ports, which URL does not parse
 * as an origin, so the allowlist keeps a small explicit representation for that case.
 */
function originOf(value) {
  const raw = String(value || "").trim();
  const wildcard = /^(https?):\/\/([^/:]+|\[[^\]]+\]):\*$/i.exec(raw);
  if (wildcard)
    return `${wildcard[1].toLowerCase()}://${wildcard[2].toLowerCase()}:*`;

  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(url.protocol)) return null;
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
  const wildcard = /^(https?):\/\/([^:]+):\*$/i.exec(cspOrigin || "");
  if (!wildcard) return false;
  const rpc = /^(https?):\/\/([^:]+)(?::(\d+))?$/i.exec(rpcOrigin || "");
  return (
    Boolean(rpc) &&
    wildcard[1].toLowerCase() === rpc[1].toLowerCase() &&
    wildcard[2].toLowerCase() === rpc[2].toLowerCase()
  );
}

const allNetworks = listAllNetworks();
const enabled = allNetworks.filter((network) => network.enabled === true);
const disabled = allNetworks.filter((network) => network.enabled !== true);
const cspOrigins = cspOriginSources();
const errors = [];

// MV3 extension pages must execute only packaged scripts; do not loosen this to permit
// inline scripts, eval, remote code or plugin content. Also reject HTML inline handlers.
const directiveValues = new Map(
  directives.map((directive) => {
    const [name, ...values] = directive.split(/\s+/);
    return [name, values];
  }),
);
if (
  JSON.stringify(directiveValues.get("script-src")) !==
  JSON.stringify(["'self'"])
) {
  errors.push("CSP script-src must be exactly 'self'");
}
if (
  JSON.stringify(directiveValues.get("object-src")) !==
  JSON.stringify(["'none'"])
) {
  errors.push("CSP object-src must be exactly 'none'");
}

function scanHtml(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) scanHtml(path);
    else if (entry.isFile() && entry.name.endsWith(".html")) {
      const html = readFileSync(path, "utf8");
      if (/\son[a-z]+\s*=/i.test(html))
        errors.push(`${path}: inline event handler attribute is forbidden`);
      const scriptTags = [...html.matchAll(/<script\b[^>]*>/gi)];
      for (const match of scriptTags) {
        const attributes = new Map();
        const attributePattern =
          /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
        for (const attr of match[0].slice(7).matchAll(attributePattern)) {
          attributes.set(
            attr[1].toLowerCase(),
            attr[2] ?? attr[3] ?? attr[4] ?? "",
          );
        }
        const src = attributes.get("src");
        if (!src || !/^(?:https?:)?\/\//i.test(src)) continue;
        if (
          !/^sha384-[A-Za-z0-9+/]+={0,2}$/.test(
            attributes.get("integrity") || "",
          ) ||
          !attributes.has("crossorigin")
        ) {
          errors.push(
            `${path}: external script must have sha384 integrity and crossorigin attributes`,
          );
        }
      }
    }
  }
}
scanHtml("src");

for (const network of enabled) {
  const rpcOrigin = originOf(network.rpcUrl);
  if (!rpcOrigin) {
    errors.push(
      `${network.id}: rpcUrl is not a valid http(s) origin (${network.rpcUrl})`,
    );
    continue;
  }
  if (!cspOrigins.some(({ origin }) => originMatches(origin, rpcOrigin))) {
    errors.push(
      `${network.id}: enabled RPC origin ${rpcOrigin} is missing from connect-src`,
    );
  }
}

for (const { source, origin } of cspOrigins) {
  const matchingEnabled = enabled.filter((network) => {
    const rpcOrigin = originOf(network.rpcUrl);
    return rpcOrigin && originMatches(origin, rpcOrigin);
  });
  if (!matchingEnabled.length) {
    errors.push(
      `connect-src origin ${source} does not map to an enabled network`,
    );
  }
}

for (const network of disabled) {
  const rpcOrigin = originOf(network.rpcUrl);
  if (
    rpcOrigin &&
    cspOrigins.some(({ origin }) => originMatches(origin, rpcOrigin))
  ) {
    errors.push(
      `${network.id}: disabled RPC origin ${rpcOrigin} is present in connect-src`,
    );
  }
}

if (errors.length) {
  console.error(
    `\nCSP/network consistency failed (${errors.length} issue${errors.length === 1 ? "" : "s"}):`,
  );
  for (const error of errors) console.error(`  - ${error}`);
  console.error(
    "\nEnable a network only with two deliberate edits: networks.js and manifest.json.",
  );
  process.exit(1);
}

const enabledSummary = enabled
  .map((network) => `${network.id}=${originOf(network.rpcUrl)}`)
  .join(", ");
console.log(
  `CSP/network consistency OK — ${enabled.length} enabled network(s): ${enabledSummary}`,
);
console.log(
  `Disabled network origins remain unreachable: ${disabled.length} checked.`,
);
