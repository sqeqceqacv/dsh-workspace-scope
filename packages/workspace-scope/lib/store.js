// System-side store for templates, favorites and the known-workspace set.
// All files live under $DSH_HOME/workspace-scope. Writes keep a .bak copy.

import { existsSync, mkdirSync, readFileSync, copyFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { GROUPS } from './groups.js'
import { runtimeGroupsFor } from './runtime-tools.js'

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
export const SYSTEM_DIR = join(DSH_HOME, 'workspace-scope')
export const TEMPLATES_PATH = join(SYSTEM_DIR, 'templates.json')
export const FAVORITES_PATH = join(SYSTEM_DIR, 'favorites.json')
export const KNOWN_WORKSPACES_PATH = join(SYSTEM_DIR, 'known-workspaces.json')

export const DEFAULT_FAVORITES = [
  'group:file',
  'group:web',
  'group:shell',
  'tool:ask_user_question',
  'group:memory',
]

// The public release ships one placeholder template: everything off.
export const DEFAULT_TEMPLATES = [
  {
    id: 'default',
    name: '默认',
    description: '占位模板：所有能力默认关闭',
    order: 1,
    switches: { groups: {}, tools: { allow: [], deny: [] } },
  },
]

function ensureDir() {
  mkdirSync(SYSTEM_DIR, { recursive: true })
}

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return fallback
  }
}

export function writeJson(path, value) {
  ensureDir()
  if (existsSync(path)) {
    try { copyFileSync(path, `${path}.bak`) } catch { /* best-effort backup */ }
  }
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

export function loadTemplates() {
  const stored = readJson(TEMPLATES_PATH, null)
  if (!Array.isArray(stored) || stored.length === 0) return structuredClone(DEFAULT_TEMPLATES)
  const byId = new Map(DEFAULT_TEMPLATES.map((template) => [template.id, template]))
  for (const template of stored) {
    if (template && typeof template.id === 'string') byId.set(template.id, template)
  }
  return [...byId.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}

export function saveTemplates(templates) {
  if (!Array.isArray(templates)) throw new Error('templates must be an array')
  // The default template is the fallback anchor: it can be edited but never
  // removed. Accepting an empty/missing default here would make the UI and new
  // workspace path depend on an empty list.
  const normalized = templates.filter((template) => template && typeof template.id === 'string')
  if (!normalized.some((template) => template.id === 'default')) {
    normalized.unshift(structuredClone(DEFAULT_TEMPLATES[0]))
  }
  writeJson(TEMPLATES_PATH, normalized)
  return loadTemplates()
}

export function loadFavorites() {
  const stored = readJson(FAVORITES_PATH, null)
  if (!Array.isArray(stored)) return [...DEFAULT_FAVORITES]
  return stored.filter((item) => typeof item === 'string')
}

export function saveFavorites(favorites) {
  if (!Array.isArray(favorites)) throw new Error('favorites must be an array')
  writeJson(FAVORITES_PATH, favorites.filter((item) => typeof item === 'string'))
  return loadFavorites()
}

export function loadKnownWorkspaces() {
  const stored = readJson(KNOWN_WORKSPACES_PATH, null)
  return Array.isArray(stored) ? stored : []
}

export function saveKnownWorkspaces(ids) {
  writeJson(KNOWN_WORKSPACES_PATH, [...new Set(ids)])
}

const DEFAULT_MEMORY = {
  enabled: false,
  project: '',
  theme: '',
  judgeModel: '',
  judge: true,
  reviewMode: 'auto',
  hitTopK: 6,
  hitEveryN: 2,
  titleMax: 40,
  reflectTurns: 20,
  delegateModel: '',
  inject: { snapshot: true, hits: true, reinject: true },
  tools: { read: true, write: true },
  auto: { reflect: true, dream: false, theme: true },
  dream: {
    idleMinutes: 180,
    suppressWindows: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }],
    suppressLeadMinutes: 15,
    checkMinutes: 15,
    timeZone: 'Asia/Shanghai',
    rulesReviewDays: 2,
  },
  soulAiWritable: false,
}

function freshMemory() {
  return {
    ...DEFAULT_MEMORY,
    inject: { ...DEFAULT_MEMORY.inject },
    tools: { ...DEFAULT_MEMORY.tools },
    auto: { ...DEFAULT_MEMORY.auto },
    dream: {
      ...DEFAULT_MEMORY.dream,
      suppressWindows: DEFAULT_MEMORY.dream.suppressWindows.map((item) => ({ ...item })),
    },
  }
}

function coreToolNames() {
  const names = new Set()
  for (const group of GROUPS) {
    for (const tool of group.tools ?? []) names.add(tool)
    for (const sub of group.subgroups ?? []) for (const tool of sub.tools ?? []) names.add(tool)
  }
  return names
}

/** A fresh policy pre-filled from one template (used when creating a workspace). */
export function policyFromTemplate(template) {
  const switches = template?.switches ?? {}
  return {
    version: 1,
    enabled: true,
    template: template?.id ?? 'default',
    groups: { ...(switches.groups ?? {}) },
    favorites: false,
    tools: {
      allow: [...(switches.tools?.allow ?? [])],
      deny: [...(switches.tools?.deny ?? [])],
    },
    sections: { allow: [], deny: [] },
    rules: { global: true },
    identity: { persona: '', soulEnabled: false, soul: '' },
    memory: freshMemory(),
  }
}

/** The state an unmanaged workspace actually has: everything open. */
export function fullOpenPolicy() {
  return {
    version: 1,
    enabled: true,
    template: 'default',
    groups: {
      ...Object.fromEntries(GROUPS.map((group) => [group.id, true])),
      ...Object.fromEntries(runtimeGroupsFor(undefined, coreToolNames()).map((group) => [group.id, true])),
    },
    favorites: false,
    tools: { allow: [], deny: [] },
    sections: { allow: [], deny: [] },
    rules: { global: true },
    identity: { persona: '', soulEnabled: false, soul: '' },
    memory: freshMemory(),
  }
}

/** Apply a template's switches to an existing policy, keeping identity/memory/rules. */
export function applyTemplate(policy, template) {
  const switches = template?.switches ?? {}
  return {
    ...policy,
    template: template?.id ?? policy?.template ?? 'default',
    groups: { ...(switches.groups ?? {}) },
    tools: {
      allow: [...(switches.tools?.allow ?? [])],
      deny: [...(switches.tools?.deny ?? [])],
    },
  }
}
