// Runtime tool discovery for workspace-scope.
//
// The public package must not contain the author's plugin/tool names. The Host
// knows which tools are actually registered; this module keeps that set and
// derives stable, runtime-only groups from tool-name prefixes.

let runtimeNames = []
let revision = 0

/** Replace the current runtime tool-name set. Called after every assembly and
 *  when the capabilities endpoint reads the live registry. */
export function setRuntimeToolNames(names) {
  const next = [...new Set((Array.isArray(names) ? names : [])
    .filter((name) => typeof name === 'string' && name.length > 0))]
  next.sort()
  if (next.length === runtimeNames.length && next.every((name, i) => name === runtimeNames[i])) return
  runtimeNames = next
  revision += 1
}

export function getRuntimeToolNames() {
  return runtimeNames
}

export function runtimeRevision() {
  return revision
}

/** Group external tools by their first name segment. MCP tools have their own
 *  protocol-shaped groups and are handled by the HTTP/UI layer. */
export function runtimeGroupsFor(names = runtimeNames, exclude = null) {
  const buckets = new Map()
  for (const name of names) {
    if (typeof name !== 'string' || name.startsWith('mcp__')) continue
    if (exclude !== null && exclude.has(name)) continue
    const separator = name.indexOf('_')
    if (separator <= 0) continue
    const prefix = name.slice(0, separator)
    if (!buckets.has(prefix)) buckets.set(prefix, [])
    buckets.get(prefix).push(name)
  }
  return [...buckets.entries()]
    .filter(([, tools]) => tools.length >= 2)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([prefix, tools]) => ({
      id: `runtime:${prefix}`,
      name: prefix,
      runtime: true,
      tools: [...tools].sort(),
    }))
}
