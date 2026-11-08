import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isMemoryEnabled, memoryDbPath, workspaceScope } from './lib/index.js'

const root = mkdtempSync(join(tmpdir(), 'dsh-meow-scope-'))
function workspace(name) {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  return dir
}
function policy(dir, value) {
  mkdirSync(join(dir, '.dsh-scope'), { recursive: true })
  writeFileSync(join(dir, '.dsh-scope', 'policy.json'), JSON.stringify(value), 'utf8')
}

try {
  const unmanaged = workspace('unmanaged')
  assert.equal(workspaceScope(unmanaged).managed, false)
  assert.equal(isMemoryEnabled(unmanaged), false)

  const managedOff = workspace('managed-off')
  policy(managedOff, { version: 1, enabled: true, groups: {} })
  assert.equal(workspaceScope(managedOff).managed, true)
  assert.equal(isMemoryEnabled(managedOff), false)

  const memoryOff = workspace('memory-off')
  policy(memoryOff, { version: 1, enabled: true, memory: { enabled: false } })
  assert.equal(isMemoryEnabled(memoryOff), false)
  assert.equal(workspaceScope(memoryOff).memory.hitEveryN, 2)

  const memoryOn = workspace('memory-on')
  policy(memoryOn, { version: 1, enabled: true, memory: { enabled: true, theme: '插件开发', hitEveryN: 4, tools: { read: false } } })
  assert.equal(workspaceScope(memoryOn).managed, true)
  assert.equal(isMemoryEnabled(memoryOn), true)
  assert.equal(workspaceScope(memoryOn).memory.theme, '插件开发')
  assert.equal(workspaceScope(memoryOn).memory.tools.read, false)
  assert.equal(workspaceScope(memoryOn).memory.hitEveryN, 4)
  assert.equal(memoryDbPath(memoryOn), join(memoryOn, '.dsh-scope', 'memory.db'))

  const disabled = workspace('disabled')
  policy(disabled, { version: 1, enabled: false, memory: { enabled: true } })
  assert.equal(workspaceScope(disabled).managed, false)
  assert.equal(isMemoryEnabled(disabled), false)

  console.log('PASS scope gate: unmanaged/memory-off/disabled no-op; memory-on active')
} finally {
  rmSync(root, { recursive: true, force: true })
}
