# AI-agent and MCP companion integration plan

Date: 2026-09-18  
Purpose: define a safe path for AI agents to use wallet features without giving agents access to secrets or direct signing capability.

This is a planning document only. No MCP server is implemented in this phase.

---

## 1. Core safety rule

MCP must be a **separate local companion**, not code inside the Chrome extension service worker.

Agents may help prepare and explain actions, but the extension must remain the only signing surface:

```txt
AI/MCP prepares intent → extension shows human review → user approves/authenticates → background signs/submits
```

Never:

```txt
AI/MCP receives password/private key/mnemonic → AI signs/broadcasts
```

---

## 2. Allowed MCP tool classes

### Safe read tools

These can be exposed as read-only tools because they return public or non-secret local state:

| Tool idea | Data returned | Notes |
| --- | --- | --- |
| `wallet_get_public_accounts` | addresses, labels, refs, keyring metadata | No private keys, no mnemonic. |
| `wallet_get_balances` | cached/fresh balances | Must respect network scoping. |
| `wallet_get_assets` | visible tokens/assets | Unsupported token balances must say unsupported. |
| `wallet_get_activity` | transactions/pending records | Public chain/history data only. |
| `wallet_get_networks` | active/selectable networks | No hidden secrets. |
| `wallet_get_capabilities` | supported/unsupported feature flags | Useful to stop agents fabricating behavior. |

### Protected preparation tools

These may create a pending intent, but must not sign or broadcast:

| Tool idea | Output |
| --- | --- |
| `wallet_prepare_native_send` | transaction intent for review |
| `wallet_prepare_swap` | quote/intent if real Thru-native swap support exists; otherwise unsupported |
| `wallet_prepare_launchpad_create` | launch intent if launchpad semantics are verified; otherwise unsupported |
| `wallet_prepare_token_transfer` | token transfer intent after Token Program support exists |

### Forbidden tools

Never expose these through MCP:

- mnemonic export
- private-key export
- password access
- direct signing
- direct broadcast
- disabling signing re-authentication
- changing security settings
- reset wallet
- raw decrypted vault access
- arbitrary `chrome.storage` read/write

---

## 3. Trust boundaries

```txt
Local MCP companion process
  ├─ can call read-only extension APIs if explicitly allowed
  ├─ can request preparation of an intent
  └─ cannot sign, export secrets, or change security settings

Chrome extension background
  ├─ owns auth policy
  ├─ owns encrypted vault interaction
  ├─ owns signing and submit
  └─ validates all contract methods

Human extension UI
  ├─ reviews prepared intent
  ├─ sees warnings/unsupported states
  ├─ enters password if signing policy requires it
  └─ approves or rejects
```

---

## 4. MCP implementation direction

If implemented later, use a local Node process outside the extension:

```txt
tools/mcp-server/
  package.json
  src/index.js
  src/extension-client.js
  src/tools/accounts.js
  src/tools/assets.js
  src/tools/activity.js
  src/tools/intents.js
```

The extension should expose only a narrow, audited bridge for the MCP companion. Do not expose the whole `api-router` blindly.

Preferred pattern:

1. MCP server asks extension for public/cached state.
2. MCP server proposes a transaction intent.
3. Extension records intent as pending review.
4. Extension opens popup/full-tab review surface.
5. User approves/rejects.
6. Background signs only after `auth: 'signing'` policy passes.

---

## 5. Contract design for future MCP-safe intent APIs

Potential extension methods:

```txt
intent.createDraft       auth: unlocked   params: { kind, draft }
intent.listPending       auth: unlocked
intent.get               auth: unlocked
intent.reject            auth: unlocked
intent.signAndSubmit     auth: signing
```

Feature-specific prepare methods should return draft intents:

```txt
dex.prepareSwap          auth: unlocked or none depending on quote privacy
launchpad.prepareCreate  auth: unlocked
prediction.prepareOrder  auth: unlocked
```

Signing remains centralized through one intent submit path.

---

## 6. LLM context file

The root `llms.txt` file is intentionally short and read-only. It tells agents:

- where to read current status,
- what files are sacred,
- what not to invent,
- that Thru is a native L1,
- that MCP must not sign/export secrets.

Keep `llms.txt` concise enough to be copied into agent context. Put long explanations in docs and link to them.

---

## 7. Non-goals

- No agent gets the wallet password.
- No agent gets mnemonic/private key export.
- No remote MCP server for wallet control.
- No direct transaction signing outside the extension background.
- No direct mutation of security settings by MCP.
- No fake DEX/launchpad/chart responses to satisfy agent requests.

---

## 8. Review checklist before implementing MCP

- [ ] Reset and auto-lock audit gaps fixed.
- [ ] Route mount tests added.
- [ ] Feature namespaces isolated.
- [ ] Intent model implemented and tested.
- [ ] MCP tools are read-only or intent-only.
- [ ] No secret-bearing method is exposed.
- [ ] No generic “call any API method” tool exists.
- [ ] Human review opens reliably from prepared intents.
- [ ] Build/tests pass.
