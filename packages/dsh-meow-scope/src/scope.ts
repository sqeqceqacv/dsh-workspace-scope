/**
 * Workspace-scope boundary for dsh-meow-scope.
 *
 * A workspace is "managed" only when <workspace>/.dsh-scope/policy.json exists
 * and policy.enabled !== false.  Unmanaged workspaces are a complete no-op:
 * no DB, no injection, no writes, no dream/reflect.
 *
 * Memory itself is additionally off by default.  It becomes active only when
 * the workspace policy carries memory.enabled === true (written by the
 * workspace-scope wizard/settings once the memory module is configured).
 */

import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

export interface MemoryDreamSettings {
  idleMinutes: number
  suppressWindows: Array<{ start: string; end: string }>
  suppressLeadMinutes: number
  checkMinutes: number
  timeZone: string
  rulesReviewDays: number
}

export interface MemorySwitchSet {
  enabled: boolean
  theme: string
  judgeModel: string
  judge: boolean
  reviewMode: 'auto' | 'off' | 'manual'
  hitTopK: number
  /** 每隔多少个真实用户轮触发一次关键词命中；默认 2（第 2/4/6…轮）。 */
  hitEveryN: number
  titleMax: number
  reflectTurns: number
  delegateModel: string
  inject: { snapshot: boolean; hits: boolean; reinject: boolean }
  tools: { read: boolean; write: boolean }
  auto: { reflect: boolean; dream: boolean; theme: boolean }
  dream: MemoryDreamSettings
  soulAiWritable: boolean
}

export interface WorkspaceScopeState {
  managed: boolean
  memory: MemorySwitchSet
  policyPath: string
  mtimeMs: number
}

const EMPTY: WorkspaceScopeState = {
  managed: false,
  memory: {
    enabled: false,
    theme: '',
    judgeModel: '',
    judge: true,
    reviewMode: 'auto',
    hitTopK: 6,
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
  },
  policyPath: '',
  mtimeMs: -1,
}

const cache = new Map<string, WorkspaceScopeState>()

function key(workspace: string): string {
  return workspace.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function switchSet(policy: Record<string, unknown>): MemorySwitchSet {
  const raw = (policy.memory && typeof policy.memory === 'object' ? policy.memory : {}) as Record<string, unknown>
  const inject = (raw.inject && typeof raw.inject === 'object' ? raw.inject : {}) as Record<string, unknown>
  const tools = (raw.tools && typeof raw.tools === 'object' ? raw.tools : {}) as Record<string, unknown>
  const auto = (raw.auto && typeof raw.auto === 'object' ? raw.auto : {}) as Record<string, unknown>
  const dream = (raw.dream && typeof raw.dream === 'object' ? raw.dream : {}) as Record<string, unknown>
  const suppress = Array.isArray(dream.suppressWindows)
    ? dream.suppressWindows.filter((item): item is { start: string; end: string } =>
        typeof item === 'object' && item !== null
        && typeof (item as { start?: unknown }).start === 'string'
        && typeof (item as { end?: unknown }).end === 'string')
    : [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }]
  const num = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
  return {
    enabled: raw.enabled === true,
    theme: typeof raw.theme === 'string' ? raw.theme.trim() : '',
    judgeModel: typeof raw.judgeModel === 'string' ? raw.judgeModel.trim() : '',
    judge: (typeof raw.reviewMode === 'string'
      ? raw.reviewMode
      : (bool(raw.judge, true) ? 'auto' : 'off')) === 'auto',
    reviewMode: (typeof raw.reviewMode === 'string' && ['auto', 'off', 'manual'].includes(raw.reviewMode)
      ? raw.reviewMode
      : (bool(raw.judge, true) ? 'auto' : 'off')) as MemorySwitchSet['reviewMode'],
    hitTopK: Math.round(num(raw.hitTopK, 6)),
    hitEveryN: Math.max(1, Math.round(num(raw.hitEveryN, 2))),
    titleMax: Math.round(num(raw.titleMax, 40)),
    reflectTurns: Math.round(num(raw.reflectTurns, 20)),
    delegateModel: typeof raw.delegateModel === 'string' ? raw.delegateModel.trim() : '',
    inject: {
      snapshot: bool(inject.snapshot, true),
      hits: bool(inject.hits, true),
      reinject: bool(inject.reinject, true),
    },
    tools: {
      read: bool(tools.read, true),
      write: bool(tools.write, true),
    },
    auto: {
      reflect: bool(auto.reflect, true),
      dream: bool(auto.dream, false),
      theme: bool(auto.theme, true),
    },
    dream: {
      idleMinutes: Math.round(num(dream.idleMinutes, 180)),
      suppressWindows: suppress,
      suppressLeadMinutes: Math.round(num(dream.suppressLeadMinutes, 15)),
      checkMinutes: Math.round(num(dream.checkMinutes, 15)),
      timeZone: typeof dream.timeZone === 'string' && dream.timeZone.trim() ? dream.timeZone.trim() : 'Asia/Shanghai',
      rulesReviewDays: Math.round(num(dream.rulesReviewDays, 2)),
    },
    soulAiWritable: bool(raw.soulAiWritable, false),
  }
}

/** Read (and cache by mtime) the workspace policy.  Any read/parse failure is
 * treated as unmanaged — the memory plugin must never fail open into an old DB. */
export function workspaceScope(workspace: string | null | undefined): WorkspaceScopeState {
  if (typeof workspace !== 'string' || workspace.length === 0) return EMPTY
  const policyPath = join(workspace, '.dsh-scope', 'policy.json')
  const cacheKey = key(workspace)
  let mtimeMs = -1
  try {
    mtimeMs = statSync(policyPath).mtimeMs
  } catch {
    cache.delete(cacheKey)
    return { ...EMPTY, policyPath }
  }
  const hit = cache.get(cacheKey)
  if (hit && hit.mtimeMs === mtimeMs) return hit
  try {
    const parsed = JSON.parse(readFileSync(policyPath, 'utf8')) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid policy')
    const managed = parsed.enabled !== false
    const state: WorkspaceScopeState = {
      managed,
      memory: switchSet(parsed),
      policyPath,
      mtimeMs,
    }
    cache.set(cacheKey, state)
    return state
  } catch {
    cache.delete(cacheKey)
    return { ...EMPTY, policyPath }
  }
}

/** Managed by workspace-scope (policy exists and is enabled). */
export function isManagedWorkspace(workspace: string | null | undefined): boolean {
  return workspaceScope(workspace).managed
}

/** Managed AND memory explicitly enabled for this workspace. */
export function isMemoryEnabled(workspace: string | null | undefined): boolean {
  const scope = workspaceScope(workspace)
  return scope.managed && scope.memory.enabled
}

export function memorySwitches(workspace: string | null | undefined): MemorySwitchSet {
  return workspaceScope(workspace).memory
}

/** Drop the cached policy after an external write (theme confirmation). */
export function invalidateScope(workspace: string | null | undefined): void {
  if (typeof workspace === 'string' && workspace.length > 0) cache.delete(key(workspace))
}
