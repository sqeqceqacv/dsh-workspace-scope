// dsh-workspace-scope — P1 Host core.
//
// A workspace is managed only when <workspace>/.dsh-scope/policy.json exists
// and policy.enabled !== false. Managed workspaces get:
//   - an assembly allowlist for tools and system-prompt sections;
//   - a guard that denies calls outside the allowlist with a readable message.
// Tool visibility is recomputed per request; no sticky agent-level restriction
// is installed.
// Unmanaged workspaces are untouched (full open).

import { isAbsolute, resolve } from 'node:path'
import { registerHttpApi } from './http-api.js'
import {
  ensureDefaultPolicyForNewWorkspace,
  initKnownWorkspaces,
  installWorkspaceCreateHook,
} from './new-workspace.js'
import { rememberToolSchemas } from './tool-meta.js'
import { stripTeamRuntimeContext } from './team-context.js'
import { filterAssemblyTools } from './tool-assembly.js'
import {
  agentCwd,
  contextAllowed,
  cwdOf,
  formatText,
  policyText,
  resolvePolicy,
  resolveWorkspace,
  sectionAllowed,
  toolAllowed,
} from './policy.js'
import { apply as applyGlobalRules } from './global-rules/index.js'
import { apply as applyMemory } from './memory/index.js'

export const name = 'workspace-scope'
export const inject = ['systemPrompt', 'tools', 'webServer', 'workspaceRegistry']

function warn(ctx, message, error) {
  try {
    ctx.logger.warn(`[workspace-scope] ${message}: ${error instanceof Error ? error.message : String(error)}`)
  } catch {
    /* ignore */
  }
}

/** DSH adds `tools` after the system-prompt/assemble waterfall, so filter the
 *  final assembled result. This is the layer that actually controls the model's
 *  tool definitions. */
function installToolAssemblyFilter(ctx) {
  const service = ctx.systemPrompt
  if (!service || typeof service.assemble !== 'function' || service.__workspaceScopeToolFilter === true) return
  const original = service.assemble
  const wrapped = async function (context) {
    const result = await original.call(this, context)
    try {
      const agent = context?.agent
      if (!agent) return result
      const info = resolvePolicy(ctx, agentCwd(agent))
      if (!info.managed) return result
      if (Array.isArray(result?.tools)) rememberToolSchemas(result.tools)
      return filterAssemblyTools(result, info.policy)
    } catch {
      return result
    }
  }
  try {
    service.assemble = wrapped
    service.__workspaceScopeToolFilter = true
  } catch {
    return
  }
  try {
    ctx.effect(() => () => {
      if (service.assemble === wrapped) service.assemble = original
      delete service.__workspaceScopeToolFilter
    }, 'workspace-scope: tool assembly filter')
  } catch {
    /* best-effort cleanup */
  }
}

/** Runtime context is refreshed again after pre-step. The Team plugin marks its
 *  identity as a required context, so it is restored even when assembly-level
 *  filtering removed it. Wrap refreshContext for the agent scope and drop the
 *  team contexts there when the workspace has not authorized team tools. */
function installTeamContextFilter(ctx) {
  const service = ctx.systemPrompt
  if (!service || typeof service.refreshContext !== 'function' || service.__workspaceScopeTeamFilter === true) return
  const original = service.refreshContext
  const wrapped = function (assembly, context) {
    const result = original.call(this, assembly, context)
    try {
      const agent = context?.agent
      if (!agent) return result
      const info = resolvePolicy(ctx, agentCwd(agent))
      if (sectionAllowed(info.policy, 'team:policy')) return result
      if (!Array.isArray(result?.contexts)) return result
      return {
        ...result,
        contexts: result.contexts.filter((entry) => !String(entry?.name ?? '').startsWith('team:')),
      }
    } catch {
      return result
    }
  }
  try {
    service.refreshContext = wrapped
    service.__workspaceScopeTeamFilter = true
  } catch {
    /* host service may be frozen; fail open */
    return
  }
  try {
    ctx.effect(() => () => {
      if (service.refreshContext === wrapped) service.refreshContext = original
      delete service.__workspaceScopeTeamFilter
    }, 'workspace-scope: team context filter')
  } catch {
    /* best-effort cleanup */
  }
}

export async function apply(ctx, config) {
  ctx.logger.info('[workspace-scope] P1 core loaded')
  installToolAssemblyFilter(ctx)
  installTeamContextFilter(ctx)

  // Global RULE used to be a separate dsh-global-rules bundle. It now runs as
  // an internal module so one workspace-scope bundle enables both layers.
  applyGlobalRules(ctx, config?.globalRules ?? config?.globalRulesConfig ?? {})

  // Capture existing workspaces before any create hook: they stay unmanaged.
  // Only workspaces that appear after this snapshot receive the default policy.
  initKnownWorkspaces(ctx)
  installWorkspaceCreateHook(ctx)

  // ── model-visible policy sections (empty when the workspace is unmanaged) ──
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'workspace-scope:policy',
    order: 10301,
    text: (context) => {
      try {
        const info = resolvePolicy(ctx, cwdOf(context))
        return info.managed ? policyText(info.policy, info.workspace) : ''
      } catch {
        return ''
      }
    },
  }), 'workspace-scope: policy section')

  ctx.effect(() => ctx.systemPrompt.section({
    name: 'workspace-scope:format',
    order: 10300,
    text: (context) => {
      try {
        const info = resolvePolicy(ctx, cwdOf(context))
        return info.managed ? formatText() : ''
      } catch {
        return ''
      }
    },
  }), 'workspace-scope: format section')

  // Keep policy bootstrap on agent creation; tool visibility is enforced by the
  // per-request assembly allowlist and the execution guard. We intentionally do
  // not call tools.restrict(): its deny snapshot is sticky and made newly
  // enabled tools appear as unknown until a new session.
  ctx.on('agent/created', ({ agent }) => {
    try {
      const workspace = resolveWorkspace(ctx, agentCwd(agent))
      if (workspace) ensureDefaultPolicyForNewWorkspace(ctx, workspace)
    } catch (error) {
      warn(ctx, 'new-workspace policy fallback failed', error)
    }
  })

  // Team identity is a required runtime context. It must be removed from the
  // accepted pre-step decision; removing it only from the assembly is not
  // enough because refreshContext restores required registrations.
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    try {
      const info = resolvePolicy(ctx, agentCwd(payload.agent))
      if (sectionAllowed(info.policy, 'team:policy')) return decision
      return stripTeamRuntimeContext(decision)
    } catch {
      return decision
    }
  })
  // ── section / context allowlist ──
  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const downstream = await next()
    try {
      const cwd = cwdOf(context)
      const info = resolvePolicy(ctx, cwd)
      if (!info.managed) return downstream

      const sections = downstream?.sections ?? []
      const contexts = downstream?.contexts ?? []
      const keptSections = sections.filter((section) => sectionAllowed(info.policy, section.name))
      const keptContexts = contexts.filter((entry) => contextAllowed(info.policy, entry.name))
      return { ...downstream, sections: keptSections, contexts: keptContexts }
    } catch (error) {
      warn(ctx, 'assembly policy failed (fail-open)', error)
      return downstream
    }
  })

  // ── execution guard ──
  function isRegisteredTool(execution) {
    try {
      const definitions = ctx.tools?.definitions
      if (typeof definitions === 'function') {
        const has = (list) => Array.isArray(list) && list.some((item) => item?.name === execution.name)
        if (has(definitions())) return true
        if (execution.agent && has(definitions(execution.agent))) return true
        if (typeof ctx.tools.get === 'function' && ctx.tools.get(execution.name, execution.agent)) return true
        return false
      }
      // Older Hosts may not expose definitions(); only then trust the admitted
      // schema. It is intentionally not trusted first: an unknown name can still
      // carry a placeholder schema in some builds.
      return Boolean(execution.schema)
    } catch {
      // Do not turn a registry read failure into a false "unknown tool".
      return true
    }
  }

  ctx.effect(() => ctx.tools.guard((execution) => {
    try {
      const cwd = agentCwd(execution.agent) ?? execution.cwd
      const info = resolvePolicy(ctx, cwd)
      if (!info.managed) return undefined
      // The policy file is user-owned configuration. Writing it through the
      // file tools would let the model silently grant itself new tools.
      const args = typeof execution.arguments === 'string'
        ? (() => { try { return JSON.parse(execution.arguments) } catch { return null } })()
        : (execution.arguments ?? execution.args ?? execution.input)
      const target = args?.file_path ?? args?.path
      if ((execution.name === 'write' || execution.name === 'edit') && typeof target === 'string' && info.policyPath) {
        const absoluteTarget = (isAbsolute(target) ? target : resolve(cwd || '', target)).toLowerCase()
        const protectedPolicy = resolve(info.policyPath).toLowerCase()
        if (absoluteTarget === protectedPolicy || absoluteTarget.startsWith(`${protectedPolicy}.bak`)) {
          return '策略文件受保护，不能由 AI 直接修改。请向用户报告：这需要用户在工作区设置中确认变更；安装或注册新工具不等于本工作区已授权。'
        }
      }
      if (execution.name === 'pwsh') {
        const command = String(args?.command ?? args?.script ?? '')
        if (/\.dsh-scope[\\/]+policy\.json/i.test(command)) {
          return '策略文件受保护，不能由 AI 通过命令直接读写。请让用户在工作区设置中确认策略变更。'
        }
      }
      if (!toolAllowed(info.policy, execution.name)) {
        if (!isRegisteredTool(execution)) {
          return `未知工具：${execution.name} 没有在当前 DSH 注册。请检查工具名，或让用户确认对应插件是否已启用。`
        }
        return `工具 ${execution.name} 在当前工作区未启用（工作区隔离）。不要重试；如需使用请让用户在工作区设置中开启。`
      }
    } catch {
      /* fail-open */
    }
    return undefined
  }), 'workspace-scope: policy guard')

  // ── versioned HTTP API for the (replaceable) Client UI ──
  registerHttpApi(ctx)

  // dsh-meow-scope used to be a separate bundle. It now lives inside this
  // package (lib/memory) and is applied on the same fiber, so the profile only
  // registers workspace-scope. The memory config lives under workspace-scope's
  // config.memory to keep the single-entry setup self-contained.
  try {
    await applyMemory(ctx, config?.memory ?? config?.memoryConfig ?? {})
    ctx.logger.info('[workspace-scope] internal memory plugin loaded')
  } catch (error) {
    warn(ctx, 'internal memory plugin failed (workspace scope continues)', error)
  }
}
