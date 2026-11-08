/** Filter the final assembled tool list. DSH 0.2.2 adds `tools` after the
 *  system-prompt/assemble waterfall, so the waterfall cannot remove them. */
import { toolAllowed } from './policy.js'

export function filterAssemblyTools(result, policy) {
  if (!result || !Array.isArray(result.tools)) return result
  return {
    ...result,
    tools: result.tools.filter((schema) => toolAllowed(policy, schema?.name)),
  }
}
