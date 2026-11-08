// Policy-first for new workspaces.
//
// There is no workspace/created event. We use two hooks so a new workspace is
// managed before its first agent runs:
//   1. wrap workspaceRegistry.create to write the default all-off policy right
//      after creation;
//   2. agent/created fallback in case the wrapper is unavailable or a session
//      is created before the wrapper's write lands.
//
// Existing workspaces are captured into known-workspaces.json at plugin load
// and are NEVER auto-managed; only ids that appear after that snapshot are new.

import {
  DEFAULT_TEMPLATES,
  loadKnownWorkspaces,
  loadTemplates,
  policyFromTemplate,
  saveKnownWorkspaces,
} from './store.js'
import { resolvePolicy, savePolicyForWorkspace } from './policy.js'

let known = null

function registryOf(ctx) {
  return ctx.get('workspaceRegistry') ?? ctx.workspaceRegistry
}

export function initKnownWorkspaces(ctx) {
  const rows = registryOf(ctx)?.list?.() ?? []
  const stored = new Set(loadKnownWorkspaces())
  let changed = false
  for (const workspace of rows) {
    if (typeof workspace?.id !== 'string') continue
    if (!stored.has(workspace.id)) {
      stored.add(workspace.id)
      changed = true
    }
  }
  known = stored
  if (changed) saveKnownWorkspaces([...stored])
  return known
}

export function isKnownWorkspace(workspaceId) {
  return known ? known.has(workspaceId) : false
}

/**
 * Write the default all-off policy for a workspace created after the known-set
 * snapshot. Returns { created: false } for existing workspaces, so callers can
 * safely call it on every agent creation.
 */
export function ensureDefaultPolicyForNewWorkspace(ctx, workspace) {
  if (!workspace || typeof workspace.id !== 'string' || typeof workspace.path !== 'string') {
    return { created: false, reason: 'invalid-workspace' }
  }
  if (!known) initKnownWorkspaces(ctx)
  if (known.has(workspace.id)) return { created: false, reason: 'known' }

  // A policy already written by the wizard or another hook wins; just mark it.
  const existing = resolvePolicy(ctx, workspace.path)
  if (existing.managed || existing.policy) {
    known.add(workspace.id)
    saveKnownWorkspaces([...known])
    return { created: false, reason: 'existing-policy' }
  }

  // Use the user-edited default template, not the built-in constant, so the
  // template editor controls what a new workspace starts with.
  const template = loadTemplates().find((item) => item.id === 'default') ?? DEFAULT_TEMPLATES[0]
  const policy = policyFromTemplate(template)
  const saved = savePolicyForWorkspace(workspace, policy)
  known.add(workspace.id)
  saveKnownWorkspaces([...known])
  return { created: true, ...saved }
}

/** Wrap workspaceRegistry.create so the policy exists before any session opens. */
export function installWorkspaceCreateHook(ctx) {
  const registry = registryOf(ctx)
  if (!registry || typeof registry.create !== 'function') return false
  const original = registry.create
  if (original.__workspaceScopeWrapped) return true

  const wrapped = async function (...args) {
    const workspace = await original.apply(this, args)
    try {
      const result = ensureDefaultPolicyForNewWorkspace(ctx, workspace)
      if (result.created) {
        try {
          ctx.logger.info(`[workspace-scope] new workspace ${workspace.path} initialized all-off`)
        } catch { /* ignore */ }
      }
    } catch (error) {
      try {
        ctx.logger.warn(`[workspace-scope] new workspace policy failed: ${error instanceof Error ? error.message : String(error)}`)
      } catch { /* ignore */ }
    }
    return workspace
  }
  wrapped.__workspaceScopeWrapped = true

  try {
    registry.create = wrapped
    ctx.effect(() => () => {
      if (registry.create === wrapped) registry.create = original
    }, 'workspace-scope: workspace create hook')
    return true
  } catch (error) {
    try {
      ctx.logger.warn(`[workspace-scope] cannot wrap workspaceRegistry.create: ${error instanceof Error ? error.message : String(error)}`)
    } catch { /* ignore */ }
    return false
  }
}
