// Restore the built-in default template while preserving custom templates.
// Usage: node scripts/reset-default-template.mjs
import { DEFAULT_TEMPLATES, loadTemplates, saveTemplates } from '../packages/workspace-scope/lib/store.js'

const templates = loadTemplates()
const next = templates.map((template) => (
  template.id === 'default' ? structuredClone(DEFAULT_TEMPLATES[0]) : template
))
saveTemplates(next)
console.log(`default restored; templates: ${next.map((template) => template.id).join(', ')}`)
