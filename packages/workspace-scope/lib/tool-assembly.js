/** Filter the final assembled tool list. The host appends `tools` after the
 *  system-prompt/assemble waterfall, so the waterfall alone cannot remove them. */
import { toolAllowed } from './policy.js'

export function filterAssemblyTools(result, policy) {
  if (!result || !Array.isArray(result.tools)) return result
  return {
    ...result,
    tools: result.tools.filter((schema) => toolAllowed(policy, schema?.name)),
  }
}
