// Probe the Thru Explorer MCP server (https://scan.thru.org/api/mcp) over Streamable HTTP.
//
// P2.5 spike tooling — dev-only, never imported by the extension, never shipped in dist/.
// Dependency-free (Node >= 18 global fetch). Prints RAW protocol messages: everything this
// script outputs is wire evidence, not interpretation.
//
// Without arguments it performs the MCP handshake (initialize → initialized → tools/list) and
// prints the server's advertised tool list. With a tool name it performs tools/call.
// Only the eight tools documented in the official docs are allowed:
//   https://thru.org/docs/api-ref/explorer-mcp/tools-reference/
//
//   node scripts/probe-explorer-mcp.mjs                                  # handshake + tools/list
//   node scripts/probe-explorer-mcp.mjs get_block '{"slot":12345}'
//   node scripts/probe-explorer-mcp.mjs get_transaction '{"signature":"ts..."}'
//   node scripts/probe-explorer-mcp.mjs get_account '{"address":"ta..."}'
//   node scripts/probe-explorer-mcp.mjs list_account_transactions '{"address":"ta...","pageSize":25}'
//   node scripts/probe-explorer-mcp.mjs list_recent_blocks '{"limit":10}'
//   node scripts/probe-explorer-mcp.mjs list_recent_transactions '{"limit":10}'
//   node scripts/probe-explorer-mcp.mjs search '{"query":"ta..."}'
//   node scripts/probe-explorer-mcp.mjs get_program_abi '{"program":"ta..."}'
//
// Flags: --endpoint <url> (default https://scan.thru.org/api/mcp), --rpc <url> (appended as
// ?rpc=<url> per the documented override), --timeout <ms> (default 20000).

const DOCUMENTED_TOOLS = new Set([
  'get_block',
  'get_transaction',
  'get_account',
  'list_account_transactions',
  'list_recent_blocks',
  'list_recent_transactions',
  'search',
  'get_program_abi',
]);

const args = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--endpoint') { flags.endpoint = args[i + 1]; i += 1; }
  else if (args[i] === '--rpc') { flags.rpc = args[i + 1]; i += 1; }
  else if (args[i] === '--timeout') { flags.timeout = Number(args[i + 1]); i += 1; }
  else positional.push(args[i]);
}

const endpoint = new URL(flags.endpoint || 'https://scan.thru.org/api/mcp');
if (flags.rpc) endpoint.searchParams.set('rpc', flags.rpc);
const timeoutMs = flags.timeout || 20000;

const tool = positional[0];
let toolArgs = {};
if (tool) {
  if (!DOCUMENTED_TOOLS.has(tool)) {
    console.error(`refusing non-documented tool '${tool}'. Allowed: ${[...DOCUMENTED_TOOLS].join(', ')}`);
    process.exit(2);
  }
  toolArgs = positional[1] ? JSON.parse(positional[1]) : {};
}

let session = null;
let nextId = 0;

async function post(payload) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(session ? { 'mcp-session-id': session } : {}),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const sid = res.headers.get('mcp-session-id');
  if (sid) session = sid;
  const contentType = res.headers.get('content-type') || '';
  const text = await res.text();

  if (!res.ok) {
    console.log(`[transport] HTTP ${res.status} ${contentType}`);
    console.log(text.slice(0, 2000));
    return { httpError: res.status, body: text.slice(0, 2000) };
  }
  if (contentType.includes('text/event-stream')) {
    const messages = [];
    for (const line of text.split('\n')) {
      if (line.startsWith('data:')) {
        const data = line.slice(5).trim();
        if (data && data !== '[DONE]') { try { messages.push(JSON.parse(data)); } catch { messages.push(data); } }
      }
    }
    return { sse: true, messages };
  }
  try { return { json: JSON.parse(text) }; } catch { return { raw: text.slice(0, 2000) }; }
}

function show(label, result) {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(result, null, 2));
}

try {
  const init = await post({
    jsonrpc: '2.0', id: (nextId += 1), method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'thru-wallet-ext-spike', version: '0.1.0' },
    },
  });
  show('initialize', init);
  if (init.httpError) process.exit(1);

  await post({ jsonrpc: '2.0', method: 'notifications/initialized' });

  const listed = await post({ jsonrpc: '2.0', id: (nextId += 1), method: 'tools/list' });
  show('tools/list', listed);

  if (tool) {
    const called = await post({
      jsonrpc: '2.0', id: (nextId += 1), method: 'tools/call',
      params: { name: tool, arguments: toolArgs },
    });
    show(`tools/call ${tool} ${JSON.stringify(toolArgs)}`, called);
  }
} catch (err) {
  console.error(`\nUNREACHABLE from this environment: ${err.name}: ${err.message}`);
  console.error('Record the spike step as BLOCKED in docs/EXPLORER_SPIKE.md — do not fabricate shapes.');
  process.exit(1);
}
