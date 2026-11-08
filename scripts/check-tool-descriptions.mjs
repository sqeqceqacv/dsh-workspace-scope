// Reports grouped tools that lack a curated Chinese description.
// New tools are still visible in the UI through their own tool-schema
// description (captured at assembly) and appear under 未分组; this script is
// the maintenance check that asks for a proper one-line Chinese entry.

import { allKnownToolNames } from '../packages/workspace-scope/lib/groups.js'
import { TOOL_DESCRIPTIONS } from '../packages/workspace-scope/lib/tool-descriptions.js'

const grouped = allKnownToolNames()
const missing = [...grouped].filter((name) => !TOOL_DESCRIPTIONS[name]).sort()
const stale = Object.keys(TOOL_DESCRIPTIONS)
  .filter((name) => !grouped.has(name))
  .sort()

console.log(`grouped tools: ${grouped.size}`)
console.log(`curated descriptions: ${Object.keys(TOOL_DESCRIPTIONS).length}`)
if (missing.length > 0) console.log(`missing curated description:\n  ${missing.join('\n  ')}`)
if (stale.length > 0) console.log(`description for a tool no longer in a group:\n  ${stale.join('\n  ')}`)
if (missing.length === 0 && stale.length === 0) console.log('OK: every grouped tool has a curated description')

if (missing.length > 0 || stale.length > 0) process.exitCode = 1
