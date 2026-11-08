/**
 * The Team plugin registers its identity as a required runtime context, so
 * assembly-level context filtering is restored later by refreshContext. Strip
 * the team sections from the accepted pre-step decision instead.
 */
export function stripTeamRuntimeContext(decision) {
  if (!decision || !Array.isArray(decision.messages)) return decision
  const messages = []
  for (const message of decision.messages) {
    const source = message?.source
    if (source?.kind !== 'runtime-context' || !Array.isArray(source.sections)) {
      messages.push(message)
      continue
    }
    const removed = source.sections.filter((section) => typeof section?.name === 'string' && section.name.startsWith('team:'))
    if (removed.length === 0) {
      messages.push(message)
      continue
    }
    const sections = source.sections.filter((section) => !removed.includes(section))
    if (sections.length === 0) continue
    const removedTexts = removed.map((section) => section.text).filter((text) => typeof text === 'string' && text.length > 0)
    const content = (Array.isArray(message.content) ? message.content : []).map((block) => {
      if (block?.type !== 'text' || typeof block.text !== 'string') return block
      let text = block.text
      for (const removedText of removedTexts) text = text.replace(removedText, '')
      text = text.replace(/\n{3,}/g, '\n\n').trim()
      return { ...block, text }
    }).filter((block) => block?.type !== 'text' || block.text.length > 0)
    if (content.length === 0) continue
    messages.push({ ...message, source: { ...source, sections }, content })
  }
  return { ...decision, messages }
}
