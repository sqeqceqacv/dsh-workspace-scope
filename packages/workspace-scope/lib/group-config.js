// User-managed group overrides and custom groups.
//
// The static GROUPS in groups.js are the baseline. This layer stores:
//   - customGroups: extra top-level groups created in the UI;
//   - overrides: tool -> target group key ('' means ungrouped).
//
// effectiveGroups() returns the merged view used by both policy evaluation and
// the capabilities API, so moving a tool actually changes which group switch
// controls it.

import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { GROUPS } from './groups.js'
import { runtimeGroupsFor, runtimeRevision } from './runtime-tools.js'
import { SYSTEM_DIR } from './store.js'

export const GROUP_CONFIG_PATH = join(SYSTEM_DIR, 'groups.json')

const EMPTY = Object.freeze({ version: 1, customGroups: [], overrides: {}, removedGroups: [], purgedGroups: [] })
let cachedConfig = null
let cachedMtime = -1
let cachedGroups = null
let cachedGroupsConfig = null
let cachedRuntimeRevision = -1
let testConfigOverride = null

function staticGroupKeys() {
  const keys = new Set()
  for (const group of GROUPS) {
    keys.add(group.id)
    for (const sub of group.subgroups ?? []) keys.add(`${group.id}.${sub.id}`)
  }
  return keys
}

function coreToolNames() {
  const names = new Set()
  for (const group of GROUPS) {
    for (const tool of group.tools ?? []) names.add(tool)
    for (const sub of group.subgroups ?? []) for (const tool of sub.tools ?? []) names.add(tool)
  }
  return names
}

function normalize(raw) {
  if (!raw || typeof raw !== 'object') return { ...EMPTY, customGroups: [], overrides: {}, removedGroups: [], purgedGroups: [] }
  const staticKeys = staticGroupKeys()
  const seen = new Set()
  const customGroups = []
  const purgedGroups = [...new Set((Array.isArray(raw.purgedGroups) ? raw.purgedGroups : [])
    .filter((id) => typeof id === 'string' && id.trim().length > 0)
    .map((id) => id.trim()))]
  const removedGroups = [...new Set((Array.isArray(raw.removedGroups) ? raw.removedGroups : [])
    .filter((id) => typeof id === 'string' && id.trim().length > 0)
    .map((id) => id.trim()))].filter((id) => !purgedGroups.includes(id))
  for (const group of Array.isArray(raw.customGroups) ? raw.customGroups : []) {
    if (!group || typeof group.id !== 'string' || typeof group.name !== 'string') continue
    const id = group.id.trim()
    const name = group.name.trim()
    if (!id || !name || staticKeys.has(id) || seen.has(id)) continue
    seen.add(id)
    customGroups.push({ id, name, order: Number(group.order) || 0 })
  }
  const allowedTargets = new Set([...staticKeys, ...seen, ''])
  for (const group of runtimeGroupsFor(undefined, coreToolNames())) allowedTargets.add(group.id)
  const overrides = {}
  if (raw.overrides && typeof raw.overrides === 'object' && !Array.isArray(raw.overrides)) {
    for (const [tool, target] of Object.entries(raw.overrides)) {
      if (typeof tool !== 'string' || !tool.trim()) continue
      if (typeof target !== 'string') continue
      const value = target === '__ungrouped__' ? '' : target
      if (!allowedTargets.has(value)) continue
      overrides[tool] = value
    }
  }
  return { version: 1, customGroups, overrides, removedGroups, purgedGroups }
}

export function loadGroupConfig() {
  if (testConfigOverride) return testConfigOverride
  let stat
  try {
    stat = statSync(GROUP_CONFIG_PATH)
  } catch {
    cachedConfig = EMPTY
    cachedMtime = -1
    return EMPTY
  }
  if (cachedConfig && cachedMtime === stat.mtimeMs) return cachedConfig
  try {
    cachedConfig = normalize(JSON.parse(readFileSync(GROUP_CONFIG_PATH, 'utf8')))
    cachedMtime = stat.mtimeMs
    return cachedConfig
  } catch {
    cachedConfig = EMPTY
    cachedMtime = -1
    return EMPTY
  }
}

export function saveGroupConfig(raw) {
  const config = normalize(raw)
  mkdirSync(SYSTEM_DIR, { recursive: true })
  if (existsSync(GROUP_CONFIG_PATH)) {
    try { copyFileSync(GROUP_CONFIG_PATH, `${GROUP_CONFIG_PATH}.bak`) } catch { /* best-effort */ }
  }
  writeFileSync(GROUP_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  cachedConfig = config
  try { cachedMtime = statSync(GROUP_CONFIG_PATH).mtimeMs } catch { cachedMtime = -1 }
  cachedGroups = null
  cachedGroupsConfig = null
  cachedRuntimeRevision = -1
  return config
}

function findTarget(groups, key) {
  for (const group of groups) {
    if (group.id === key) return group
    for (const sub of group.subgroups ?? []) {
      if (`${group.id}.${sub.id}` === key) return sub
    }
  }
  return undefined
}

function removeTool(groups, tool) {
  for (const group of groups) {
    group.tools = (group.tools ?? []).filter((name) => name !== tool)
    for (const sub of group.subgroups ?? []) {
      sub.tools = (sub.tools ?? []).filter((name) => name !== tool)
    }
  }
}

export function effectiveGroups(config = loadGroupConfig()) {
  const revision = runtimeRevision()
  if (cachedGroups && cachedGroupsConfig === config && cachedRuntimeRevision === revision) return cachedGroups
  const groups = structuredClone(GROUPS)
  if (config.customGroups !== undefined) {
    for (const customGroup of config.customGroups) {
      if (groups.some((group) => group.id === customGroup.id)) continue
      groups.push({ id: customGroup.id, name: customGroup.name, tools: [] })
    }
  }
  for (const group of runtimeGroupsFor(undefined, coreToolNames())) {
    if (groups.some((item) => item.id === group.id)) continue
    groups.push(group)
  }
  const hidden = new Set([...(config.removedGroups ?? []), ...(config.purgedGroups ?? [])])
  for (let i = groups.length - 1; i >= 0; i -= 1) {
    const group = groups[i]
    if (hidden.has(group.id)) {
      groups.splice(i, 1)
      continue
    }
    if (Array.isArray(group.subgroups)) {
      group.subgroups = group.subgroups.filter((sub) => !hidden.has(`${group.id}.${sub.id}`))
    }
  }
  for (const [tool, target] of Object.entries(config.overrides ?? {})) {
    removeTool(groups, tool)
    if (!target) continue
    const container = findTarget(groups, target)
    if (!container) continue
    container.tools = container.tools ?? []
    if (!container.tools.includes(tool)) container.tools.push(tool)
  }
  // Enforce the one-regular-group invariant even if a future static/custom
  // definition accidentally lists the same tool twice. Favorites are a
  // separate list and are intentionally not part of this scan.
  const assigned = new Set()
  for (const group of groups) {
    group.tools = (group.tools ?? []).filter((tool) => {
      if (assigned.has(tool)) return false
      assigned.add(tool)
      return true
    })
    for (const sub of group.subgroups ?? []) {
      sub.tools = (sub.tools ?? []).filter((tool) => {
        if (assigned.has(tool)) return false
        assigned.add(tool)
        return true
      })
    }
  }

  cachedGroups = groups
  cachedGroupsConfig = config
  cachedRuntimeRevision = revision
  return groups
}

export function groupKeyNames(groups = effectiveGroups()) {
  const names = new Map()
  for (const group of groups) {
    names.set(group.id, group.name)
    for (const sub of group.subgroups ?? []) names.set(`${group.id}.${sub.id}`, `${group.name}/${sub.name}`)
  }
  return names
}

// Tests must not depend on the user's live groups.json.
export function setGroupConfigForTests(config) {
  testConfigOverride = config
  cachedGroups = null
  cachedGroupsConfig = null
  cachedRuntimeRevision = -1
}
