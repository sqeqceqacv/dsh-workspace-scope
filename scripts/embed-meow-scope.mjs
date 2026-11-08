#!/usr/bin/env node
/**
 * Rebuild dsh-meow-scope and refresh the embedded copy inside workspace-scope.
 *
 * workspace-scope is now the single registered plugin. Its memory host/client is
 * a compiled copy of dsh-meow-scope, so changing memory source requires running
 * this script before restarting DSH.
 *
 * Run from anywhere:
 *   node scripts/embed-meow-scope.mjs
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const memoryRoot = join(root, 'packages', 'dsh-meow-scope')
const scopeRoot = join(root, 'packages', 'workspace-scope')
const memoryLib = join(memoryRoot, 'lib')
const embedRoot = join(scopeRoot, 'lib', 'memory')
const scopeClient = join(scopeRoot, 'client.js')

function fail(message) {
  console.error(`\n[embed-meow-scope] ${message}`)
  process.exit(1)
}

if (!existsSync(join(memoryRoot, 'build.mjs'))) fail(`missing ${join(memoryRoot, 'build.mjs')}`)
if (!existsSync(join(scopeRoot, 'client.js'))) fail(`missing ${scopeClient}`)

console.log('[embed-meow-scope] building dsh-meow-scope')
execFileSync(process.execPath, [join(memoryRoot, 'build.mjs')], { cwd: memoryRoot, stdio: 'inherit' })

const hostSource = join(memoryLib, 'index.js')
const clientSource = join(memoryLib, 'client.js')
if (!existsSync(hostSource)) fail(`missing built host: ${hostSource}`)
if (!existsSync(clientSource)) fail(`missing built client: ${clientSource}`)

console.log('[embed-meow-scope] copying host + prompts')
rmSync(embedRoot, { recursive: true, force: true })
mkdirSync(embedRoot, { recursive: true })
let host = readFileSync(hostSource, 'utf8')

// The bundle was built as a package root at dsh-meow-scope/lib/index.js.
// In its embedded location it is two levels below the owning package.
host = host.replace(
  'createRequire(import.meta.url)("../package.json")',
  'createRequire(import.meta.url)("../../package.json")',
)
host = host.replace(
  'return resolve2(dirname(fileURLToPath(import.meta.url)), "..");',
  'return resolve2(dirname(fileURLToPath(import.meta.url)), "../..");',
)

// Cordis exposes some services as context properties after a nested apply.
// Add a small bridge and route every service lookup through it.
const bridge = `// Compatibility bridge for running inside workspace-scope.
function internalService(ctx, name) {
  try {
    const got = typeof ctx.get === "function" ? ctx.get(name) : void 0;
    if (got !== void 0) return got;
  } catch {
  }
  try {
    return ctx[name];
  } catch {
    return void 0;
  }
}
`
host = bridge + host
host = host.replace(/ctx\.get\?\.\("([^"]+)"\)/g, 'internalService(ctx, "$1")')
host = host.replace(/ctx\.get\("([^"]+)"\)/g, 'internalService(ctx, "$1")')
writeFileSync(join(embedRoot, 'index.js'), host, 'utf8')
if (existsSync(join(memoryLib, 'index.js.map'))) {
  cpSync(join(memoryLib, 'index.js.map'), join(embedRoot, 'index.js.map'))
}
cpSync(join(memoryLib, 'prompts'), join(embedRoot, 'prompts'), { recursive: true })

console.log('[embed-meow-scope] refreshing workspace-scope client memory module')
const marker = /window\.__ModuleLoader__\.load\(\{\s*id:\s*"dsh-meow-scope"/
const current = readFileSync(scopeClient, 'utf8')
const markerMatch = marker.exec(current)
const markerIndex = markerMatch?.index ?? -1
const base = markerIndex >= 0 ? current.slice(0, markerIndex).trimEnd() : current.trimEnd()
if (markerIndex < 0) console.log('[embed-meow-scope] memory client block not found; appending a fresh one')
const memoryClient = readFileSync(clientSource, 'utf8')
writeFileSync(scopeClient, `${base}\n\n${memoryClient}`, 'utf8')

console.log('[embed-meow-scope] validating')
const embeddedHost = readFileSync(join(embedRoot, 'index.js'), 'utf8')
const embeddedClient = readFileSync(scopeClient, 'utf8')
if (!embeddedHost.includes('createRequire(import.meta.url)("../../package.json")')) fail('package.json path was not rewritten')
if (!embeddedHost.includes('internalService(ctx, "webServer")')) fail('webServer service bridge missing')
if (!embeddedHost.includes('internalService(ctx, "llm")')) fail('llm service bridge missing')
if (!existsSync(join(embedRoot, 'prompts', 'zh', 'system-guide.md'))) fail('prompts were not copied')
if ((embeddedClient.match(/id:\s*"dsh-meow-scope"/g) ?? []).length !== 1) fail('memory client module count is not exactly one')
execFileSync(process.execPath, ['--check', join(embedRoot, 'index.js')], { stdio: 'inherit' })
execFileSync(process.execPath, ['--check', scopeClient], { stdio: 'inherit' })
console.log('[embed-meow-scope] OK: embedded memory host + client are in sync')
