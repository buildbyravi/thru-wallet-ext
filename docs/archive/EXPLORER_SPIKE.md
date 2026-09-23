# P2.5 Explorer-enrichment spike — findings

Date: 2026-09-20
Directive: `docs/handoff/P25_EXPLORER_SPIKE_PROMPT.md` (merged via PR #8), tasks A–D plus the
owner's addendum: read the official `https://thru.org/docs/llm.txt` docs for **oracle and
indexer** use in the extension.

**Status: PARTIAL — blocked where the environment had no route, proven where it did.** Every
claim below is tagged with its evidence channel (§1). **Zero response shapes are recorded that
did not come off the wire or out of the official docs.** No extension runtime code changed, no
contract change: **`CONTRACT_VERSION` stays 10** (spike-only, per the directive). Deliverable
tooling: `scripts/probe-explorer-mcp.mjs`, `scripts/probe-oracle-feed.mjs` (dev-only; not
imported by the extension, not copied to `dist/`).

---

## 1. Environment channels — what could reach what

This sandbox has **two different network positions**, and conflating them would corrupt the
spike record:

| Channel | thru.org docs | scan.thru.org | rpc.alphanet.thru.org | POST-capable? |
| --- | --- | --- | --- | --- |
| Sandbox shell (`curl`) | **No** — HTTP 000 in 0.15s | **No** — HTTP 000 in 0.06s | **No** — HTTP 000 in 0.14s | — |
| Agent page-fetch tool | **Yes** | **Yes** | not applicable (JSON-RPC needs POST) | **No** (GET-only) |

Probes run 2026-09-20: `curl -sS -o /dev/null -w '%{http_code}' --max-time 8` on
`https://thru.org/docs/llm.txt`, `https://scan.thru.org`, `https://rpc.alphanet.thru.org`,
`https://scan.thru.org/api/mcp` — all `000` from the shell (same restriction class as prior
sessions' "RPC endpoints blocked"; GitHub is allowlisted, Thru hosts are not). The agent fetch
tool is a separate network position: it retrieved every docs page cited below **and** got a
live HTTP response from the MCP endpoint (§3.1). It cannot POST, so **MCP tool calls
(`tools/call`) were impossible here** — that is the hard boundary of this spike.

Consequence: tasks A (live shapes) and C (explorer-vs-node cross-check) are **prepared but not
executed**; task B (`measure-fee.mjs`) is **blocked** (needs the RPC); task D (this document)
is complete. §11 is the exact resume checklist.

## 2. Explorer MCP — the documented surface (channel: official docs)

Source: `https://thru.org/docs/api-ref/explorer-mcp/overview/` and
`.../tools-reference/` (fetched 2026-09-20). Endpoint **`https://scan.thru.org/api/mcp`**
(Streamable HTTP). Documented tools:

| Tool | Inputs | Notes from docs |
| --- | --- | --- |
| `get_block` | `slot` | block, producer, **timestamps**, tx rows |
| `get_transaction` | `signature` (`ts...`) | execution status, r/w accounts, instructions, **events** |
| `get_account` | `address` (`ta...`) | owner, balance, flags, data size/sequence |
| `list_account_transactions` | `address`, `pageSize` ≤ 100, `pageToken` | account history, paginated |
| `list_recent_blocks` | `limit` 1–50 | recent slots |
| `list_recent_transactions` | `limit` 1–50 | chain-wide feed |
| `search` | `query` | routes ambiguous slot/sig/address values |
| `get_program_abi` | `program` | on-chain ABI used by explorer reflection |

Documented properties that matter to us: every tool wraps the explorer API with
**`format=toon`** (LLM-optimized text, generated "from the same underlying API response
model"); optional **`?rpc=<url>`** override with silent fallback to the default network on
bad values; the docs position MCP as **read-only** ("need to send transactions → use the CLI
or SDK"). The raw non-TOON explorer API that the tools sit on remains **undocumented** — the
docs route applications to gRPC/SDK, agents to MCP.

## 3. Wire evidence actually captured (channel: agent fetch, GET)

### 3.1 MCP endpoint is live

`GET https://scan.thru.org/api/mcp` returned, verbatim (2026-09-20):

```json
{"jsonrpc":"2.0","error":{"code":-32000,"message":"Not Acceptable: Client must accept text/event-stream"},"id":null}
```

That is an authentic Streamable-HTTP MCP rejection (GET without SSE accept), proving the host
is up and speaking MCP. First real error shape in our records.

### 3.2 The Oracle program is LIVE on alphanet — updating today

`GET https://scan.thru.org/address/taQlmNDxbXJUeInC24XEAhKw66BpqtcAraLMeA4PgBwPTq` (2026-09-20,
~18:05 UTC) rendered "Oracle Program": owner **Manager Program**
(`taAAAA…AAAAQE`), flag `PermanentProgramNew`, published ABI account
`tadAVFQn3xdhhlHC15oTuAzDYe-nCEem6ky3hv7rwMiGJr`, 4,640 bytes data, and a transaction list of
`Multicall` → `post_updateOracle` calls **seconds old at fetch time**, all `Success`:

| signature (full, from page) | explorer-rendered time | block |
| --- | --- | --- |
| `ts7HFsV9PSc7Cs4Kh5bh77UmUWCmegbhDW13SNtdU4Y4Lxiy9OMC0E3B7VQQ9rYWi1xCIicB5r9X8hzc8FeSVTCR1g` | Sep 20, 2026, 14:04:47 EDT | 13162959 |
| `tsQbPXl6AqDWemfEqLF6ec0vPw1p1p8OYYfBaE6Nu0qr1GrAvogt53NuNWYLZakIbOnZQzTqgpmr4iSyvDO_FxDSHD` | Sep 20, 2026, 14:04:45 EDT | 13162951 |
| `tsnJA2Im-2aHqqmyuWcspgcvCsfrdP1sVkS-bdZINcrLwX7a6LyBr8KBGKvIuZOjnV6pWw1xJBwngKCGNEmkG3BiBh` | Sep 20, 2026, 14:04:43 EDT | 13162941 |

These three rows double as **prepared test vectors** for task C (§8). The page also self-qualified
the RPC override (`…?rpc=https%3A%2F%2Frpc.alphanet.thru.org`), matching the documented
`?rpc=` behavior.

## 4. Validation matrix

| Claim | Status | Evidence |
| --- | --- | --- |
| MCP host live, speaks Streamable HTTP | **PROVEN** | §3.1 wire response |
| Tool list, argument bounds, read-only posture | **documented, not wire-verified** | §2 (official docs) |
| Tool response shapes (any) | **NOT PROVEN** — needs POST+SSE | run §11 step 2 |
| Raw non-TOON explorer API shapes | **NOT PROVEN; still undocumented** | §2 |
| Oracle program deployed & actively updated on alphanet | **PROVEN** | §3.2 |
| Oracle bindings present in our tree and importable | **PROVEN** | §5.1 runtime import dump |
| Oracle feed account shape on the wire | **typed only** (§5.2); wire read blocked here | run §11 step 4 |
| gRPC-Web streaming client shipped in `@thru/sdk` | **PROVEN** (package inspect) | §6 |
| Charged fee exists anywhere | **still unknown — C2 stays open** | §7 |

## 5. Oracle — the owner's question, answered with what is provable today

### 5.1 The bindings are already in our dependency tree

`@thru/programs@0.3.16` (our pinned version) exports `./oracle` (verified against the
installed package's `exports` map and a runtime import):

```
ORACLE_PROGRAM_ADDRESS   = 'taQlmNDxbXJUeInC24XEAhKw66BpqtcAraLMeA4PgBwPTq'   (= §3.2 explorer page)
ORACLE_FEED_TYPE_PRICE   = 1          ORACLE_FEED_TYPE_BOOLEAN      = 2
ORACLE_EVENT_TYPE_PRICE_UPDATE   = 1  ORACLE_EVENT_TYPE_BOOLEAN_UPDATE = 2
ORACLE_FEED_SEED_LENGTH  = 32
deriveOracleFeedAddress(thru, oracleProgramAddress, seed) → { address, bytes, seed }
normalizeOracleFeedSeed(seed) → Uint8Array
parseOracleFeedAccount(account | Uint8Array) → OracleFeed
parseOracleEvent(data) → OracleEvent
oracleProgramErrorFromCode(code) / OracleProgramError (11 codes)
```

### 5.2 Typed shapes (from the package's own `index.d.ts` — type-level, not wire-verified)

```ts
interface OracleFeedCommon { maxStalenessNs: bigint; lastUpdateNs: bigint;
                             adminAddress: string; reporterAddress: string; feedName: string; }
interface OraclePriceFeed  { kind: 'price';   common: OracleFeedCommon;
                             price: bigint; maxVarianceBps: number; exponent: number; }
interface OracleBooleanFeed{ kind: 'boolean'; common: OracleFeedCommon; value: boolean; }
interface OraclePriceUpdateEvent { kind: 'priceUpdate'; feedName: string; feedAddress: string;
                                   oldPrice: bigint; newPrice: bigint; timestampNs: bigint; }
```

`parseOracleFeedAccount` accepts the SDK account (or raw bytes), so a feed read is:
`getClient().accounts.get(deriveOracleFeedAddress(getClient(), ORACLE_PROGRAM_ADDRESS, seed).address)`
→ `parseOracleFeedAccount(...)` — an ordinary **RPC read on `rpc.alphanet.thru.org`, the one
origin `src/manifest.json:28` already pins in `connect-src`**. No new host, no CSP change, no
new dependency. `scripts/probe-oracle-feed.mjs` implements exactly this.

### 5.3 Consequence for the plan docs

`docs/HISTORY_REDESIGN_PLAN.md` §5 lists "**No price/USD lines (no price feed on alphanet)**"
as a non-goal. The **fact under that decision changed on 2026-09-20**: a live oracle posts
price updates on alphanet continuously (§3.2), and the read path is CSP-clean (§5.2). The
*decision* (don't ship fiat lines this cycle) can stand — but it is now a product choice, not
an impossibility, and the doc has been annotated to say so. If it is ever revisited: feed
discovery is `parseOracleEvent` over the oracle program's recent transactions (events carry
`feedAddress` + `feedName`), then one account read per feed. Open live questions: which feeds
exist (names/seeds), feed freshness/staleness behavior on alphanet, and whether any feed
denotes THRU/USD — none answerable without the RPC (§11).

## 6. Indexer — the owner's question, answered

The official indexing stack (`https://thru.org/docs/indexing/overview/`, fetched 2026-09-20)
is **backend-tier by design**: `@thru/indexer` is a Drizzle + Postgres indexing framework with
checkpoints; `@thru/replay` is historical+live replay where "you bring your own storage".
Neither belongs inside a browser extension — wrong tier, wrong storage assumptions, and both
are absent from our lockfile (verified).

What the extension actually needs maps to two surfaces:

1. **History/enrichment reads** → the explorer API (what scan.thru.org runs). Its raw REST
   shape is undocumented; its MCP face is TOON/agent-formatted and is **not** an application
   data source. Until the typed API is published, enrichment stays blocked-by-design — which
   is the same conclusion `docs/TX_DETAIL_SPIKE.md` reached, now with the docs' own structure
   as confirmation.
2. **Live tailing** (pending-tx watcher, R7 design input) → `@thru/sdk` already ships
   **`@connectrpc/connect-web`** and exports a `StreamingClient`
   (`createClient<typeof StreamingService>`, `dist/client-BLTFR4JE.d.ts:267`; gRPC/gRPC-Web
   docs: `https://thru.org/docs/api-ref/grpc/overview/`, alphanet endpoint = the same pinned
   `rpc.alphanet.thru.org`). Push updates for account/block/tx streams on the CSP-clean
   origin, with the transport already in our bundle's dependency graph. **Recorded as R7
   design input only** — this spike scopes nothing.

## 7. Task B — charged fee (`measure-fee.mjs`): BLOCKED

The script is self-contained (own throwaway keypair, faucet funding, `spent − amount`) but
needs the RPC, which this environment cannot reach (§1). Not run. Documented evidence remains
as in `docs/TX_DETAIL_SPIKE.md`: `TransactionExecutionResult` has no charged-fee field, and
the official `get_transaction` description (§2) mentions status/accounts/instructions/events —
no fee field. `docs/BACKEND_GAPS.md` C2's "remaining" line stays open and now points here.
Resume: §11 step 3, then a `get_transaction` call on the same signature (§11 step 2).

## 8. Task C — explorer vs node cross-check: PREPARED, NOT RUN

Procedure (agrees with the P2.5 prompt): for each §3.2 vector, compare
(a) explorer `get_transaction`/`get_block` output vs (b) node `tx.getDetail` /
`blocks.get({slot})` on the same signature/slot — fields: wall-clock time, status, and any fee
rows; record raw values from both sides. The explorer-rendered wall times in §3.2 are page
renderings (fetch-time 2026-09-20 ~18:05 UTC) — side (a) partial; side (b) needs the RPC.
Blocked here; vectors are ready.

## 9. In-extension guardrails (unchanged by this spike)

- `src/manifest.json:28` `connect-src` = `https://rpc.alphanet.thru.org http://127.0.0.1:*`.
  Any future scan.thru.org consumption = manifest CSP edit + `scripts/check-csp.mjs` origin
  policy + settings/docs updates — a reviewed PR, not a spike side-effect.
- MCP/TOON is an **agent** surface; the extension must not scrape LLM-formatted text as data.
- Enrichment stays read-only, background-owned, provenance-labelled, degraded-to-stated-absent
  (`docs/MCP_AGENT_INTEGRATION.md`, `docs/HISTORY_REDESIGN_PLAN.md` §4/§5).
- No dApp provider, no signing surface change. Contract v10 untouched.

## 10. Answers to the spike's four questions

1. **Charged fee anywhere?** Unknown. RPC + explorer tool calls blocked here; docs describe no
   charged-fee field. C2 open (§7).
2. **Explorer time vs node time?** Method + vectors ready (§8); unrun. The wallet keeps the
   node's `blockTimeNs` as source of truth regardless.
3. **Typed explorer API stable enough to depend on?** Cannot be certified without live calls.
   Documented surface is coherent and the docs route apps to gRPC/SDK instead — treat the raw
   REST API as unpublished until proven otherwise.
4. **`get_program_abi` coverage?** Unknown (needs a live call); the oracle program already has
   a published ABI account visible in §3.2, so it is a concrete first target.

## 11. Resume checklist (networked environment, in order)

```bash
npm ci && npm run build                                   # baseline, 0 warnings
node scripts/probe-explorer-mcp.mjs                       # handshake + tools/list        → paste into §3
node scripts/probe-explorer-mcp.mjs get_transaction '{"signature":"ts7HFsV9PSc7Cs4Kh5bh77UmUWCmegbhDW13SNtdU4Y4Lxiy9OMC0E3B7VQQ9rYWi1xCIicB5r9X8hzc8FeSVTCR1g"}'
node scripts/probe-explorer-mcp.mjs get_block '{"slot":13162959}'     # task C side (a)
node scripts/measure-fee.mjs alphanet 12                              # task B
# feed discovery: pull feedAddress events from the get_transaction output above, then:
node scripts/probe-oracle-feed.mjs --address <feedAddress>            # §5.2 wire proof
node scripts/probe-oracle-feed.mjs --seed '<feedName from event>'
```

Paste raw outputs into this document with a dated addendum; do not summarize shapes from
memory. Then, and only then, decide whether enrichment becomes a contract-v11 proposal.

## Provenance appendix

| # | Source | Channel | When (UTC) |
| --- | --- | --- | --- |
| P1 | `https://thru.org/docs/llm.txt` | agent fetch | 2026-09-20 ~17:5x |
| P2 | `https://thru.org/docs/api-ref/overview/` | agent fetch | 2026-09-20 ~17:5x |
| P3 | `https://thru.org/docs/api-ref/explorer-mcp/overview/` | agent fetch | 2026-09-20 ~17:5x |
| P4 | `https://thru.org/docs/api-ref/explorer-mcp/tools-reference/` | agent fetch | 2026-09-20 ~18:0x |
| P5 | `https://thru.org/docs/getting-started/build-with-an-llm/` | agent fetch | 2026-09-20 ~18:0x |
| P6 | `GET https://scan.thru.org/api/mcp` (error JSON) | agent fetch | 2026-09-20 ~18:0x |
| P7 | `https://thru.org/docs/api-ref/grpc/overview/` | agent fetch | 2026-09-20 ~17:5x |
| P8 | `https://thru.org/docs/sdks/web/` | agent fetch | 2026-09-20 ~18:1x |
| P9 | `https://thru.org/docs/indexing/overview/` | agent fetch | 2026-09-20 ~18:1x |
| P10 | `https://thru.org/docs/core-programs/overview/` | agent fetch | 2026-09-20 ~18:1x |
| P11 | Oracle explorer page (`scan.thru.org/address/taQlmND…`) | agent fetch | 2026-09-20 ~18:05 |
| P12 | `@thru/programs` 0.3.16 exports + `dist/oracle/index.d.ts` (installed pkg) | local node_modules | 2026-09-20 |
| P13 | `@thru/sdk` package.json + `dist/client-BLTFR4JE.d.ts` (installed pkg) | local node_modules | 2026-09-20 |
| P14 | Shell curl probes ×4 (HTTP 000) | sandbox bash | 2026-09-20 ~17:5x |
