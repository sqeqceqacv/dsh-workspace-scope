// Workspace policy resolution and the allow/deny rules used by both the
// assembly filter and the agent-scoped tool restriction.
//
// A workspace is "managed" only when <workspace>/.dsh-scope/policy.json exists
// and policy.enabled !== false. Unmanaged workspaces are untouched (full open).

import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { groupStateSummary, toolsFromGroups } from './groups.js'
import { effectiveGroups, groupKeyNames } from './group-config.js'
import { SYSTEM_DIR, loadFavorites } from './store.js'

const cache = new Map()

const FILE_TOOLS = ['read', 'write', 'edit', 'read_image', 'glob', 'grep']

export const BASE_SECTIONS = new Set([
  'harness:identity',
  'deployment:persona-prefix',
  'deployment:persona-suffix',
  'dsh-context:prompt-prefix',
  'dsh-context:prompt-suffix',
  'context:file-reference',
  'plan:policy',
  'mcp-resource-servers',
  'workspace-scope:policy',
  'workspace-scope:format',
])

export const FORMAT_TEXT = [
  '## 交付格式',
  '- 提到已有文件时用 Markdown 链接指向完整路径；路径含空格用尖括号包住。',
  '- 图片用 ![说明](路径)；需要让用户打开完整文件时用 present，不要只为了列出改动文件而调用。',
].join('\n')

export function inside(root, target) {
  const rel = relative(root, target)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

export function cwdOf(context) {
  if (typeof context?.cwd === 'string') return context.cwd
  const cwd = context?.agent?.session?.header?.cwd
  return typeof cwd === 'string' ? cwd : undefined
}

export function agentCwd(agent) {
  const cwd = agent?.session?.header?.cwd
  return typeof cwd === 'string' ? cwd : undefined
}

export function resolveWorkspace(ctx, cwd) {
  if (!cwd) return undefined
  const registry = ctx.get('workspaceRegistry')
  const rows = registry?.list?.() ?? []
  return rows
    .filter((row) => typeof row?.path === 'string' && inside(row.path, cwd))
    .sort((a, b) => b.path.length - a.path.length)[0]
}

export function policyPathFor(workspace) {
  return join(workspace.path, '.dsh-scope', 'policy.json')
}

export function fallbackPolicyPath(workspace) {
  const hash = createHash('sha256').update(workspace.path.toLowerCase()).digest('hex').slice(0, 16)
  return join(SYSTEM_DIR, 'workspaces', `${hash}.json`)
}

function firstExistingPath(workspace) {
  for (const candidate of [policyPathFor(workspace), fallbackPolicyPath(workspace)]) {
    try {
      statSync(candidate)
      return candidate
    } catch {
      /* try next */
    }
  }
  return undefined
}

export function resolvePolicy(ctx, cwd) {
  const workspace = resolveWorkspace(ctx, cwd)
  if (!workspace) return { managed: false, workspace: undefined, policyPath: undefined, policy: null }
  const policyPath = firstExistingPath(workspace)
  if (!policyPath) {
    return { managed: false, workspace, policyPath: policyPathFor(workspace), policy: null }
  }
  let stat
  try {
    stat = statSync(policyPath)
  } catch {
    cache.delete(policyPath)
    return { managed: false, workspace, policyPath, policy: null }
  }
  const cached = cache.get(policyPath)
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    return { ...cached.value, workspace, policyPath }
  }
  try {
    const policy = JSON.parse(readFileSync(policyPath, 'utf8'))
    const managed = policy?.enabled !== false
    const value = { managed, policy, workspace: undefined, policyPath: undefined }
    cache.set(policyPath, { mtimeMs: stat.mtimeMs, value })
    return { ...value, workspace, policyPath, error: undefined }
  } catch (error) {
    cache.delete(policyPath)
    return {
      managed: false,
      workspace,
      policyPath,
      policy: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export function revisionOf(policyPath) {
  if (!policyPath) return null
  try {
    const stat = statSync(policyPath)
    return `${stat.mtimeMs}:${stat.size}`
  } catch {
    return null
  }
}

export function invalidatePolicy(policyPath) {
  if (policyPath) cache.delete(policyPath)
}

export function savePolicyForWorkspace(workspace, policy) {
  const primary = policyPathFor(workspace)
  const fallback = fallbackPolicyPath(workspace)
  let target = primary
  let usedFallback = false
  try {
    mkdirSync(dirname(primary), { recursive: true })
  } catch {
    target = fallback
    usedFallback = true
    mkdirSync(dirname(target), { recursive: true })
  }
  const write = () => {
    if (existsSync(target)) {
      try { copyFileSync(target, `${target}.bak`) } catch { /* best-effort backup */ }
    }
    writeFileSync(target, `${JSON.stringify(policy, null, 2)}\n`, 'utf8')
  }
  try {
    write()
  } catch (error) {
    if (usedFallback) throw error
    target = fallback
    usedFallback = true
    mkdirSync(dirname(target), { recursive: true })
    write()
  }
  invalidatePolicy(primary)
  invalidatePolicy(fallback)
  return { path: target, fallback: usedFallback, revision: revisionOf(target) }
}

export function deletePolicyForWorkspace(workspace) {
  const removed = []
  for (const path of [policyPathFor(workspace), fallbackPolicyPath(workspace)]) {
    try {
      if (existsSync(path)) {
        unlinkSync(path)
        removed.push(path)
      }
    } catch {
      /* best-effort */
    }
    invalidatePolicy(path)
  }
  return removed
}

function match(pattern, name) {  if (pattern === name) return true
  if (!pattern.includes('*')) return false
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`).test(name)
}

function matchesAny(patterns, name) {
  return Array.isArray(patterns) && patterns.some((pattern) => typeof pattern === 'string' && match(pattern, name))
}

export function toolAllowed(policy, name) {
  if (!policy) return true
  if (name === 'global_rule' && policy.rules?.global === false) return false
  if (matchesAny(policy.tools?.deny, name)) return false
  if (matchesAny(policy.tools?.allow, name)) return true
  if (policy.favorites === true && loadFavorites().includes(`tool:${name}`)) return true
  return toolsFromGroups(policy.groups ?? {}, effectiveGroups()).has(name)
}

const TEAM_TOOLS = [
  'spawn_teammate', 'send_message', 'list_agents', 'wait_agent', 'interrupt_agent',
  'team_task_create', 'team_task_get', 'team_task_list', 'team_task_update',
]

export function sectionAllowed(policy, name) {
  if (!policy) return name === 'team:policy' ? false : true
  if (matchesAny(policy.sections?.deny, name)) return false
  if (matchesAny(policy.sections?.allow, name)) return true
  // The @path / "use the read tool" block is misleading when no file tool is
  // available; drop it together with the file capability.
  if (name === 'context:file-reference') return FILE_TOOLS.some((tool) => toolAllowed(policy, tool))
  // MCP resources belong to the same runtime as MCP tools; keep the section
  // only when the workspace has authorized at least one dynamic MCP tool.
  if (name === 'mcp-resource-servers') {
    const allow = policy.tools?.allow ?? []
    const deny = policy.tools?.deny ?? []
    return allow.some((pattern) => pattern === '*' || pattern.startsWith('mcp__'))
      && !deny.some((pattern) => pattern === '*' || pattern === 'mcp__*')
  }
  if (BASE_SECTIONS.has(name)) return true
  if (name === 'global-rules') return policy.rules?.global !== false
  if (name === 'meow-memory:guide') return policy.groups?.memory === true
  if (name === 'team:policy') {
    if (policy.groups?.agent === true) return true
    return TEAM_TOOLS.some((tool) => toolAllowed(policy, tool))
  }
  if (name === 'ui:deliverable-file-references') return false
  if (name === 'harness:source' || name === 'app:web-surface') return policy.groups?.system === true
  if (name === 'tool:jobs') {
    return ['job_list', 'job_output', 'job_kill'].some((tool) => toolAllowed(policy, tool))
  }
  if (name === 'tool:goal') {
    return ['create_goal', 'get_goal', 'update_goal'].some((tool) => toolAllowed(policy, tool))
  }
  if (name.startsWith('tool:')) return toolAllowed(policy, name.slice(5))
  return false
}

export function contextAllowed(policy, name) {
  if (name.startsWith('team:')) return sectionAllowed(policy, 'team:policy')
  return true
}

export function allowedSectionNames(policy) {
  const groups = groupStateSummary(policy?.groups ?? {}, effectiveGroups())
  return groups.length > 0 ? groups : ['（无）']
}export function policyText(policy, workspace) {
  if (!policy) return ''
  const groups = effectiveGroups()
  const names = groupKeyNames(groups)
  const enabledGroups = groupStateSummary(policy.groups ?? {}, groups)
    .map((id) => names.get(id) ?? id)
  const favoriteTools = policy.favorites === true
    ? loadFavorites().filter((item) => typeof item === 'string' && item.startsWith('tool:')).map((item) => item.slice(5))
    : []
  if (favoriteTools.length > 0) enabledGroups.push('收藏组')
  const reviewMode = policy.memory?.reviewMode
    || (policy.memory?.judge === false ? 'off' : 'auto')
  const judgeEnabled = reviewMode === 'auto'
  const theme = judgeEnabled && typeof policy.memory?.theme === 'string' && policy.memory.theme.trim() !== ''
    ? policy.memory.theme.trim()
    : '（未设置）'
  const hasTools = toolsFromGroups(policy.groups ?? {}, groups).size > 0
    || (policy.tools?.allow?.length ?? 0) > 0
    || favoriteTools.length > 0
  const soul = policy.identity?.soulEnabled === true && typeof policy.identity.soul === 'string'
    ? policy.identity.soul.trim()
    : ''
  return [
    '## 工作区策略',
    `- 工作区：${workspace?.title ?? '（未知）'}（${workspace?.path ?? ''}）`,
    `- 记忆主题：${theme}`,
    `- 主题 judge：${reviewMode === 'auto'
      ? '开启'
      : reviewMode === 'manual'
        ? '关闭（手动审批：记忆写入进入待审区，不要询问或设置主题）'
        : '关闭（默认无主题，不要主动询问或设置主题）'}`,
    `- 已启用能力：${enabledGroups.length > 0 ? enabledGroups.join('、') : '（无）'}`,
    hasTools
      ? '- 只可使用当前工具列表中的工具；没有出现的能力表示在本工作区未启用。'
      : '- 本工作区当前没有启用任何工具；不要尝试调用工具，也不要输出工具调用标签。',
    '- 如果看不到任何工具，或明显缺少完成任务所需的文件/命令工具：不要输出伪造的工具调用；请向用户说明这是会话创建时读取到的旧工作区策略。若本工作区并未选择“全关工具”，请用户在当前工作区新开一个对话再试。',
    '- 策略文件由用户管理：不得直接修改 <workspace>/.dsh-scope/policy.json；需要新增工具或调整能力时，先向用户说明并让用户在工作区设置中确认。',
    '- 安装/注册插件成功不等于本工作区已授权工具。如果新工具被工作区守卫拒绝：先报告“插件已安装、工作区未授权”，询问用户是否在工作区设置中启用；不要自行修改策略，也不要用命令或脚本绕过。若用户已确认但当前会话仍看不到工具，提示用户新开一个对话。',
    ...(soul ? ['', '## 工作区 SOUL', soul] : []),
  ].join('\n')
}

export function formatText() {
  return FORMAT_TEXT
}
