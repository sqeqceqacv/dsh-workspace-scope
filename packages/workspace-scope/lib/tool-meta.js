// Runtime tool metadata captured from the assembled tool schemas.
//
// The Host's root `tools.schemas()` can be empty on some builds, so the
// assembly listener — where the full schema set is already resolved — records
// each tool's model-facing description. The HTTP API reads this cache and
// falls back to the curated Chinese map for known tools.

import { setRuntimeToolNames } from './runtime-tools.js'

const runtimeDescriptions = new Map()

export function rememberToolSchemas(tools) {
  if (!Array.isArray(tools)) return
  const names = []
  for (const schema of tools) {
    if (!schema || typeof schema.name !== 'string') continue
    names.push(schema.name)
    runtimeDescriptions.set(
      schema.name,
      typeof schema.description === 'string' ? schema.description.trim() : '',
    )
  }
  setRuntimeToolNames(names)
}

export function runtimeToolDescriptions() {
  return Object.fromEntries(runtimeDescriptions)
}
