// Versioned HTTP API for the workspace-scope UI.
//
// Transport choice: same-origin JSON over the DSH web server, not a Typert
// Remote. This keeps the contract independent of the Client build pipeline and
// lets the UI be replaced wholesale without touching Host policy code.
//
//   GET    /workspace-scope/api/v1/capabilities
//   GET    /workspace-scope/api/v1/workspaces
//   GET    /workspace-scope/api/v1/workspaces/:id/policy
//   PUT    /workspace-scope/api/v1/workspaces/:id/policy
//   DELETE /workspace-scope/api/v1/workspaces/:id/policy[?deleteMemory=1]
//   POST   /workspace-scope/api/v1/workspaces/:id/apply-template
//   GET    /workspace-scope/api/v1/workspaces/:id/preview
//   GET    /workspace-scope/api/v1/templates
//   PUT    /workspace-scope/api/v1/templates
//   GET    /workspace-scope/api/v1/favorites
//   PUT    /workspace-scope/api/v1/favorites
//
// All responses are JSON: { apiVersion: 1, ok: true, data } or
// { apiVersion: 1, ok: false, error }. Writes require application/json and a
// same-origin Origin when the browser sends one.

import { allKnownToolNames, groupStateSummary } from './groups.js'
import { effectiveGroups, loadGroupConfig, saveGroupConfig } from './group-config.js'
import { runtimeToolDescriptions } from './tool-meta.js'
import { setRuntimeToolNames } from './runtime-tools.js'
import { TOOL_DESCRIPTIONS } from './tool-descriptions.js'

async function deleteWorkspaceMemoryDb(ctx, workspace) {
  let origin = ''
  try { origin = ctx.webServer?.getOrigin?.() ?? '' } catch { /* before bind */ }
  if (!origin) return { ok: false, error: 'webServer 尚未就绪，无法请求记忆插件删除数据库' }
  try {
    const response = await fetch(`${origin}/meow-memory/workspace-db`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspace: workspace.path }),
      signal: AbortSignal.timeout(15_000),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok || body?.ok !== true) {
      return { ok: false, error: body?.error || `记忆插件删除失败（HTTP ${response.status}）` }
    }
    return { ok: true, removed: Array.isArray(body.removed) ? body.removed : [] }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** Runtime MCP tools are normal tools with a `mcp__<server>__<tool>` name.
 *  Keep them out of the ungrouped bucket and present them as dynamic groups. */
function collectMcpServers(toolDescriptions) {
  const servers = new Map()
  for (const [name, description] of Object.entries(toolDescriptions)) {
    const match = /^mcp__(.+?)__(.+)$/.exec(name)
    if (!match) continue
    const [, server, tool] = match
    if (!servers.has(server)) servers.set(server, [])
    servers.get(server).push({ name, label: tool, description })
  }
  return [...servers.entries()]
    .map(([id, tools]) => ({
      id,
      name: id,
      tools: tools.sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Capabilities can be opened before the first system-prompt assembly.
 *  Merge the live tool registry so dynamic MCP tools are visible immediately. */
function liveToolDescriptions(ctx) {
  const merged = { ...runtimeToolDescriptions() }
  try {
    const service = ctx.get?.('tools') ?? ctx.tools
    const schemas = typeof service?.schemas === 'function' ? service.schemas() : []
    for (const schema of schemas) {
      if (typeof schema?.name === 'string' && typeof schema.description === 'string' && merged[schema.name] === undefined) {
        merged[schema.name] = schema.description
      }
    }
  } catch { /* registry may be unavailable during startup */ }
  setRuntimeToolNames(Object.keys(merged))
  return merged
}
import {
  BASE_SECTIONS,
  deletePolicyForWorkspace,
  fallbackPolicyPath,
  policyPathFor,
  policyText,
  resolvePolicy,
  revisionOf,
  savePolicyForWorkspace,
  sectionAllowed,
  toolAllowed,
} from './policy.js'
import {
  applyTemplate,
  fullOpenPolicy,
  loadFavorites,
  loadTemplates,
  policyFromTemplate,
  saveFavorites,
  saveTemplates,
} from './store.js'

const API_VERSION = 1
const PREFIX = '/workspace-scope/api/v1'
const MAX_BODY = 1024 * 1024

const SPECIAL_SECTIONS = [
  'global-rules',
  'meow-memory:guide',
  'team:policy',
  'ui:deliverable-file-references',
  'harness:source',
  'app:web-surface',
  'tool:jobs',
  'tool:goal',
]

function send(res, status, payload) {
  if (res.headersSent) return
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(payload))
}

function ok(res, data) {
  send(res, 200, { apiVersion: API_VERSION, ok: true, data })
}

function fail(res, status, error) {
  send(res, status, { apiVersion: API_VERSION, ok: false, error })
}

async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return undefined
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function strings(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []
}

function normalizeMemory(input) {
  const memory = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const inject = memory.inject && typeof memory.inject === 'object' ? memory.inject : {}
  const tools = memory.tools && typeof memory.tools === 'object' ? memory.tools : {}
  const auto = memory.auto && typeof memory.auto === 'object' ? memory.auto : {}
  const dream = memory.dream && typeof memory.dream === 'object' ? memory.dream : {}
  const reviewMode = ['auto', 'off', 'manual'].includes(memory.reviewMode)
    ? memory.reviewMode
    : (memory.judge === false ? 'off' : 'auto')
  const number = (value, fallback, min = 0, max = 1_000_000) => {
    const n = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback
  }
  const parseSuppress = (value) => {
    if (Array.isArray(value)) {
      return value.filter((item) => item && typeof item === 'object'
        && typeof item.start === 'string' && typeof item.end === 'string')
        .map((item) => ({ start: item.start, end: item.end }))
    }
    if (typeof value === 'string') {
      const out = []
      for (const part of value.split(/[,，]/)) {
        const m = /^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/.exec(part.trim())
        if (m) out.push({ start: m[1], end: m[2] })
      }
      return out
    }
    return []
  }
  return {
    enabled: memory.enabled === true,
    project: typeof memory.project === 'string' ? memory.project : '',
    theme: typeof memory.theme === 'string' ? memory.theme : '',
    judgeModel: typeof memory.judgeModel === 'string' ? memory.judgeModel : '',
    judge: reviewMode === 'auto',
    reviewMode,
    hitTopK: number(memory.hitTopK, 6, 1, 20),
    hitEveryN: number(memory.hitEveryN, 2, 1, 20),
    titleMax: number(memory.titleMax, 40, 10, 200),
    reflectTurns: number(memory.reflectTurns, 20, 1, 50),
    delegateModel: typeof memory.delegateModel === 'string' ? memory.delegateModel : '',
    inject: {
      snapshot: inject.snapshot !== false,
      hits: inject.hits !== false,
      reinject: inject.reinject !== false,
    },
    tools: {
      read: tools.read !== false,
      write: tools.write !== false,
    },
    auto: {
      reflect: auto.reflect !== false,
      dream: auto.dream === true,
      theme: auto.theme !== false,
    },
    dream: {
      idleMinutes: number(dream.idleMinutes, 180, 1, 10080),
      suppressWindows: parseSuppress(dream.suppressWindows),
      suppressLeadMinutes: number(dream.suppressLeadMinutes, 15, 0, 1440),
      checkMinutes: number(dream.checkMinutes, 15, 1, 1440),
      timeZone: typeof dream.timeZone === 'string' && dream.timeZone.trim() ? dream.timeZone.trim() : 'Asia/Shanghai',
      rulesReviewDays: number(dream.rulesReviewDays, 2, 0, 365),
    },
    soulAiWritable: memory.soulAiWritable === true,
  }
}

function normalizePolicy(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('policy must be an object')
  }
  const groups = {}
  if (input.groups && typeof input.groups === 'object' && !Array.isArray(input.groups)) {
    for (const [key, value] of Object.entries(input.groups)) {
      if (value === true) groups[key] = true
    }
  }
  const persona = typeof input.identity?.persona === 'string' ? input.identity.persona : ''
  const soul = typeof input.identity?.soul === 'string' ? input.identity.soul : ''
  return {
    version: 1,
    enabled: input.enabled !== false,
    template: typeof input.template === 'string' ? input.template : 'default',
    groups,
    favorites: input.favorites === true,
    tools: { allow: strings(input.tools?.allow), deny: strings(input.tools?.deny) },
    sections: { allow: strings(input.sections?.allow), deny: strings(input.sections?.deny) },
    rules: {
      global: input.rules?.global !== false,
    },
    identity: { persona, soulEnabled: input.identity?.soulEnabled === true, soul },
    memory: normalizeMemory(input.memory),
  }
}

function workspacesOf(ctx) {
  return ctx.get('workspaceRegistry')?.list?.() ?? []
}

function findWorkspace(ctx, key) {
  let decoded = key
  try { decoded = decodeURIComponent(key) } catch { /* keep raw */ }
  const rows = workspacesOf(ctx)
  return rows.find((row) => row.id === decoded)
    ?? rows.find((row) => row.path === decoded)
    ?? rows.find((row) => row.path.toLowerCase() === decoded.toLowerCase())
}

function workspaceSummary(ctx, workspace) {
  const info = resolvePolicy(ctx, workspace.path)
  return {
    id: workspace.id,
    path: workspace.path,
    title: workspace.title,
    managed: info.managed,
    enabled: info.policy?.enabled ?? false,
    template: info.policy?.template ?? null,
    groups: groupStateSummary(info.policy?.groups ?? {}, effectiveGroups()),
    policyPath: info.policyPath ?? null,
    fallback: info.policyPath === fallbackPolicyPath(workspace),
    revision: revisionOf(info.policyPath),
    updatedAt: workspace.updatedAt,
  }
}

function allSectionNames() {
  const names = new Set(BASE_SECTIONS)
  for (const name of SPECIAL_SECTIONS) names.add(name)
  for (const name of allKnownToolNames()) names.add(`tool:${name}`)
  return [...names].sort()
}

function preview(ctx, workspace) {
  const info = resolvePolicy(ctx, workspace.path)
  if (!info.managed) {
    return {
      managed: false,
      policy: null,
      tools: [...allKnownToolNames()].sort().map((name) => ({ name, enabled: true })),
      sections: allSectionNames().map((name) => ({ name, enabled: true })),
    }
  }
  return {
    managed: true,
    policy: info.policy,
    policyText: policyText(info.policy, workspace),
    tools: [...allKnownToolNames()].sort().map((name) => ({
      name,
      enabled: toolAllowed(info.policy, name),
    })),
    sections: allSectionNames().map((name) => ({
      name,
      enabled: sectionAllowed(info.policy, name),
    })),
  }
}

function route(ctx, req, res) {
  return (async () => {
    const origin = req.headers.origin
    let ownOrigin
    try { ownOrigin = ctx.webServer?.getOrigin?.() } catch { /* before bind */ }
    if (origin && ownOrigin && origin !== ownOrigin) {
      return fail(res, 403, 'cross-origin request rejected')
    }

    const url = new URL(req.url ?? '/', 'http://local')
    if (!url.pathname.startsWith(PREFIX)) return fail(res, 404, 'not found')
    const rest = url.pathname.slice(PREFIX.length).split('/').filter(Boolean)
    const method = req.method ?? 'GET'

    if (rest[0] === 'models' && rest.length === 1) {
      if (method !== 'GET') return fail(res, 405, 'method not allowed')
      const llm = (ctx.get && ctx.get('llm')) || ctx.llm
      if (!llm || typeof llm.listProviders !== 'function' || typeof llm.listModels !== 'function') {
        return ok(res, { models: [] })
      }
      let providers = []
      try {
        providers = llm.listProviders()
      } catch {
        return ok(res, { models: [] })
      }
      const models = []
      for (const provider of providers) {
        try {
          const listed = await llm.listModels(provider.id)
          for (const model of listed ?? []) {
            models.push({
              provider: provider.id,
              providerName: provider.name,
              id: model.id,
              name: model.name || model.id,
              description: model.description || '',
              value: `${provider.id}/${model.id}`,
            })
          }
        } catch {
          /* one provider discovery failure must not hide the rest */
        }
      }
      return ok(res, { models })
    }

    if (rest[0] === 'capabilities' && rest.length === 1) {
      if (method !== 'GET') return fail(res, 405, 'method not allowed')
      const runtime = liveToolDescriptions(ctx)
      const groups = effectiveGroups()
      const groupedNames = new Set()
      for (const group of groups) {
        for (const tool of group.tools ?? []) groupedNames.add(tool)
        for (const sub of group.subgroups ?? []) for (const tool of sub.tools ?? []) groupedNames.add(tool)
      }
      const toolDescriptions = { ...runtime, ...TOOL_DESCRIPTIONS }
      const mcp = collectMcpServers(toolDescriptions)
      const mcpNames = new Set(mcp.flatMap((server) => server.tools.map((tool) => tool.name)))
      const ungroupedNames = new Set(
        Object.keys(runtime).filter((toolName) => !groupedNames.has(toolName) && !mcpNames.has(toolName)),
      )
      const ungrouped = [...ungroupedNames]
        .filter((toolName) => !groupedNames.has(toolName))
        .sort()
        .map((toolName) => ({ name: toolName, description: toolDescriptions[toolName] ?? '' }))
      return ok(res, {
        groups,
        groupConfig: loadGroupConfig(),
        toolDescriptions,
        ungrouped,
        mcp,
        favorites: loadFavorites(),
        templates: loadTemplates(),
        sectionNames: allSectionNames(),
      })
    }

    if (rest[0] === 'group-config' && rest.length === 1) {
      if (method === 'GET') return ok(res, { config: loadGroupConfig(), groups: effectiveGroups() })
      if (method !== 'PUT') return fail(res, 405, 'method not allowed')
      const body = await readJson(req)
      const config = saveGroupConfig(body?.config ?? body)
      return ok(res, { config, groups: effectiveGroups() })
    }

    if (rest[0] === 'workspaces' && rest.length === 1) {
      if (method !== 'GET') return fail(res, 405, 'method not allowed')
      return ok(res, workspacesOf(ctx).map((workspace) => workspaceSummary(ctx, workspace)))
    }

    if (rest[0] === 'templates' && rest.length === 1) {
      if (method === 'GET') return ok(res, { templates: loadTemplates() })
      if (method !== 'PUT') return fail(res, 405, 'method not allowed')
      const body = await readJson(req)
      if (!Array.isArray(body?.templates)) return fail(res, 400, 'templates must be an array')
      return ok(res, { templates: saveTemplates(body.templates) })
    }

    if (rest[0] === 'templates' && rest.length === 2) {
      if (method !== 'DELETE') return fail(res, 405, 'method not allowed')
      const id = decodeURIComponent(rest[1])
      if (id === 'default') return fail(res, 400, 'default template cannot be deleted')
      const templates = loadTemplates()
      if (!templates.some((template) => template.id === id)) return fail(res, 404, 'template not found')
      const next = templates.filter((template) => template.id !== id)
      return ok(res, { deleted: id, templates: saveTemplates(next) })
    }

    if (rest[0] === 'favorites' && rest.length === 1) {
      if (method === 'GET') return ok(res, { favorites: loadFavorites() })
      if (method !== 'PUT') return fail(res, 405, 'method not allowed')
      const body = await readJson(req)
      if (!Array.isArray(body?.favorites)) return fail(res, 400, 'favorites must be an array')
      return ok(res, { favorites: saveFavorites(body.favorites) })
    }

    if (rest[0] === 'workspaces' && rest.length >= 3) {
      const workspace = findWorkspace(ctx, rest[1])
      if (!workspace) return fail(res, 404, 'workspace not found')
      const action = rest[2]

      if (action === 'policy') {
        if (rest.length !== 3) return fail(res, 404, 'not found')
        if (method === 'GET') {
          const info = resolvePolicy(ctx, workspace.path)
          return ok(res, {
            workspace: workspaceSummary(ctx, workspace),
            policy: info.policy,
            draft: info.managed ? null : fullOpenPolicy(),
            policyPath: info.policyPath,
            fallback: info.policyPath === fallbackPolicyPath(workspace),
            revision: revisionOf(info.policyPath),
          })
        }
        if (method === 'PUT') {
          const body = await readJson(req)
          const current = resolvePolicy(ctx, workspace.path)
          const currentRevision = revisionOf(current.policyPath)
          if (body?.revision && currentRevision && body.revision !== currentRevision) {
            return fail(res, 409, 'policy changed since it was read')
          }
          let policy
          try { policy = normalizePolicy(body?.policy) } catch (error) {
            return fail(res, 400, error instanceof Error ? error.message : String(error))
          }
          const saved = savePolicyForWorkspace(workspace, policy)
          return ok(res, { saved })
        }
        if (method === 'DELETE') {
          const deleteMemory = url.searchParams.get('deleteMemory') === '1'
          let memoryDeleted = false
          if (deleteMemory) {
            const result = await deleteWorkspaceMemoryDb(ctx, workspace)
            if (!result.ok) {
              return fail(res, 409, `记忆库删除失败，策略未删除：${result.error}`)
            }
            memoryDeleted = true
          }
          const removed = deletePolicyForWorkspace(workspace)
          return ok(res, { removed, memoryDeleted })
        }
        return fail(res, 405, 'method not allowed')
      }

      if (action === 'preview' && rest.length === 3) {
        if (method !== 'GET') return fail(res, 405, 'method not allowed')
        return ok(res, preview(ctx, workspace))
      }

      if (action === 'apply-template' && rest.length === 3) {
        if (method !== 'POST') return fail(res, 405, 'method not allowed')
        const body = await readJson(req)
        const templates = loadTemplates()
        const template = templates.find((item) => item.id === body?.templateId)
        if (!template) return fail(res, 404, 'template not found')
        const current = resolvePolicy(ctx, workspace.path)
        const base = current.policy ?? policyFromTemplate(templates.find((t) => t.id === 'default'))
        const applied = applyTemplate(base, template)
        const saved = savePolicyForWorkspace(workspace, applied)
        return ok(res, { saved, policy: applied })
      }

      return fail(res, 404, 'not found')
    }

    return fail(res, 404, 'not found')
  })().catch((error) => {
    try { ctx.logger.warn(`[workspace-scope] api failed: ${error instanceof Error ? error.message : String(error)}`) } catch { /* ignore */ }
    fail(res, 500, 'internal error')
  })
}

export function registerHttpApi(ctx) {
  const webServer = ctx.get('webServer') ?? ctx.webServer
  if (!webServer?.register) {
    try { ctx.logger.info('[workspace-scope] webServer unavailable; HTTP API disabled') } catch { /* ignore */ }
    return
  }
  ctx.effect(() => webServer.register({
    kind: 'prefix',
    path: PREFIX,
    handler: (req, res) => route(ctx, req, res),
  }), 'workspace-scope: HTTP API')
}
