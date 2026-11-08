# Workspace Scope UI API v1

The UI is a **separate, replaceable Client plugin**. It reads and writes through
this versioned HTTP JSON API; it owns no policy semantics. The Host policy,
JSON files, and API keep working with the UI disabled.

Base URL (same origin as the harness web page):

```
/workspace-scope/api/v1
```

Every response is JSON:

```json
{ "apiVersion": 1, "ok": true, "data": {} }
{ "apiVersion": 1, "ok": false, "error": "message" }
```

Writes require `Content-Type: application/json`. When the browser sends an
`Origin`, it must equal the harness origin. Bodies are capped at 1 MB.

## Data model

```ts
interface Policy {
  version: 1
  enabled: boolean                 // false = policy present but unmanaged
  template: string
  groups: Record<string, true>     // enabled group ids, e.g. "file", "agent.skills", "runtime:my_plugin"
  tools: { allow: string[]; deny: string[] }   // exact names or * patterns
  sections: { allow: string[]; deny: string[] }
  rules: { global: boolean }
  identity: { persona: string }
  memory: { project: string; theme: string }
}

interface WorkspaceSummary {
  id: string
  path: string
  title: string
  managed: boolean
  enabled: boolean
  template: string | null
  groups: string[]
  policyPath: string | null
  fallback: boolean
  revision: string | null
  updatedAt: string
}
```

`revision` is an opaque `mtime:size` string. Send it back on write; a mismatch
returns `409` (another writer changed the policy).

For an unmanaged workspace, `GET /workspaces/:id/policy` returns `policy: null`
and a `draft` whose groups are **all on** (all current core and runtime group
ids true, no allow/deny). This matches the workspace's actual full-open state;
saving the draft is what makes the workspace managed. `DELETE` returns the same
full-open draft.

## Core and runtime groups

`capabilities.groups` contains two kinds of groups:

- **Core groups** (`file`, `web`, `shell`, `conversation`, `memory`, `agent`,
  `system`): DSH built-ins plus tools owned by this plugin. They are defined in
  `lib/groups.js`.
- **Runtime groups** (`runtime:<prefix>`, `mcp:<server>`): discovered from the
  host's current tool registry. External plugin tools are grouped by the first
  underscore-separated prefix; MCP tools are grouped by server. Runtime groups
  are **off by default** and must be enabled by the user. They disappear when
  the corresponding plugin/tool is no longer present.

The package never hard-codes a list of third-party plugin tools.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/capabilities` | effective groups, groupConfig, tool descriptions, ungrouped, templates, favorites, section names |
| GET | `/workspaces` | all registered workspaces + managed summary |
| GET | `/workspaces/:id/policy` | current policy, `draft` when unmanaged, revision |
| PUT | `/workspaces/:id/policy` | validate + save `{ policy, revision? }` |
| DELETE | `/workspaces/:id/policy` | remove policy (back to full open) |
| POST | `/workspaces/:id/apply-template` | `{ templateId }` → apply switches |
| GET | `/workspaces/:id/preview` | per-tool/per-section enabled flags + policy text |
| GET/PUT | `/templates` | templates (one public placeholder + custom) |
| DELETE | `/templates/:id` | delete a custom template; `default` returns 400 |
| GET/PUT | `/group-config` | custom groups + tool→group overrides + removed group ids; returns effective groups |
| GET/PUT | `/favorites` | global favorite list |

Each tool has **at most one regular group**. `group-config.overrides` maps a
tool to one target group key (`''` = ungrouped); favorites are a separate global
list and never act as a regular group. A policy's `favorites` boolean is the
"收藏组" overlay: when true, all favorited tools are allowed in addition to
their regular groups. `group-config.removedGroups` lists deleted group ids;
their tools fall into `ungrouped` until the group is restored.
`group-config.purgedGroups` lists permanently deleted ids; they stay hidden and
cannot be restored from the UI.

`id` accepts the workspace UUID or its path (URL-encoded). Policy is written to
`<workspace>/.dsh-scope/policy.json`; if that path is not writable it falls back
to `~/.dsh/workspace-scope/workspaces/<hash>.json`.

## Tool descriptions

`GET /capabilities` returns:

- `toolDescriptions`: `name → one-line description`. Curated text from
  `lib/tool-descriptions.js` wins for core tools; otherwise the registered Tool
  schema's own description (captured from the assembly) is used.
- `ungrouped`: `[{ name, description }]` for registered tools that belong to no
  capability group. They render under a synthetic 未分组 section. A managed
  policy hides them until the user checks them, which adds `tools.allow`.

Adding a new tool:

1. Core/DSH tools: add them to `lib/groups.js` and add a Chinese line to
   `lib/tool-descriptions.js`; tests fail when a grouped core tool has no entry.
2. External plugin tools: no source change. The Host discovers them at runtime,
   creates `runtime:<prefix>` groups, and leaves them **off by default** until
   the user enables the group.
3. MCP tools: no source change. They appear under `mcp:<server>` groups.
4. Tools with no underscore-separated prefix appear under 未分组; enabling them
   adds `tools.allow`.

## UI rendering rules (the margin)

1. Render `capabilities.groups` generically: group → tools/subgroups. No screen
   may assume a fixed set of groups or a fixed layout.
2. Policy fields are stable semantics; tabs, cards, wizard steps and editors are
   free to change without touching the Host.
3. Breaking API changes bump the path to `v2`; v1 stays available while the UI
   migrates.
4. UI-only state (selected tab, collapsed groups, wizard draft) stays in
   `localStorage`; workspace policy is only written through this API.
5. Use DSH theme tokens and locale; never hardcode colors or visible strings.
6. Preview is computed by the Host (`/preview`); the UI only displays it.
7. The Client bundle is optional. Disabling it must leave policy, API, and JSON
   files fully usable.
