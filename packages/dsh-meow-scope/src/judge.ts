/**
 * Theme proposal / judge helpers (pure, no LLM dependency).
 *
 * The actual model call is wired by the host; these functions build the
 * prompts and parse the model output so the gate is testable in isolation.
 */

export interface ThemePromptInput {
  workspaceName: string
  samples: string[]
}

export interface TextPrompt {
  system: string
  user: string
}

const MAX_THEME_LENGTH = 40

function cleanText(value: string): string {
  return value.replace(/\r\n/g, '\n').trim()
}

export function buildThemeProposalPrompt(input: ThemePromptInput): TextPrompt {
  const samples = input.samples.map((s) => `- ${s}`).filter((s) => s.trim() !== '-')
  return {
    system: [
      '你是记忆主题命名器。根据一个工作区里刚写入的记忆，提出一个稳定的中文主题。',
      '主题要像“项目/领域”而不是一句话；2-12 个字，不超过 40 字；不要标点结尾。',
      '只输出 JSON：{"theme":"...","reason":"一句话理由"}。不要 Markdown，不要额外解释。',
    ].join('\n'),
    user: [
      `工作区：${input.workspaceName}`,
      '刚写入的记忆样本：',
      ...(samples.length > 0 ? samples : ['- （暂无样本）']),
    ].join('\n'),
  }
}

/** Parse {"theme":"...","reason":"..."} or a plain first line. */
export function parseThemeProposal(text: string): { theme: string; reason: string } | null {
  const raw = cleanText(text).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  if (raw === '') return null
  let theme = ''
  let reason = ''
  try {
    const parsed = JSON.parse(raw) as { theme?: unknown; reason?: unknown }
    if (typeof parsed.theme === 'string') theme = parsed.theme
    if (typeof parsed.reason === 'string') reason = parsed.reason
  } catch {
    theme = raw.split('\n')[0] ?? ''
  }
  theme = theme.replace(/^["'「『\s]+|["'」』\s]+$/g, '').replace(/[。！？!?；;，,]+$/g, '').trim()
  if (theme === '' || theme.length > MAX_THEME_LENGTH) return null
  if (/^(无主题|没有主题|none|null|n\/a)$/i.test(theme)) return null
  return { theme, reason: reason.trim() }
}

export function buildThemeMatchPrompt(theme: string, entry: { level: string; content: string }): TextPrompt {
  return {
    system: [
      '你是记忆主题审核器。判断一条记忆是否属于给定工作区主题。',
      '先根据主题名判断领域，再决定判断口径：',
      '1) 技术/工程/工具/开发类主题（如 DSH 开发、插件开发、MCP 接入）：与主题相关的工具、配置、部署、故障排查、外部集成、通用技术经验，通常判 yes。',
      '2) 创作/写作/艺术/研究/生活等非技术主题（如长篇小说创作、角色设计）：只判断记忆是否真正服务于该主题的内容或工作流；操作系统报错、环境故障、通用工具链配置、模型设置等，通常不属于该主题记忆，应判 no；只有记忆明确说明它直接影响该主题的创作/研究工作流时才判 yes。',
      '不要机械套用“通用技术经验”：只有主题本身是技术类，才把技术经验和环境问题放宽为 yes。',
      '示例：主题「DSH 开发」+「pwsh ACL 报错」→ yes；主题「长篇小说创作」+同一条 → no 或 uncertain，不能因为它是通用技术经验就判 yes。',
      '只有确实无法从记忆内容判断与主题关系时，才输出 uncertain；uncertain 会交给用户人工决定。',
      '只输出 JSON：{"match":"yes"|"no"|"uncertain","reason":"一句话"}。',
      '不要猜测。',
    ].join('\n'),
    user: [
      `主题：${theme}`,
      `层级：${entry.level}`,
      `记忆：${entry.content}`,
    ].join('\n'),
  }
}

export function parseThemeMatch(text: string): 'yes' | 'no' | 'uncertain' {
  const raw = cleanText(text).toLowerCase()
  try {
    const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) as { match?: unknown }
    if (parsed.match === 'yes' || parsed.match === 'no' || parsed.match === 'uncertain') return parsed.match
  } catch { /* fall through */ }
  if (/uncertain|不确定|无法判断|无法确定/.test(raw)) return 'uncertain'
  if (/^\s*(no|false|不匹配|不属于)\b/.test(raw) || /"match"\s*:\s*"no"/.test(raw)) return 'no'
  if (/^\s*(yes|true|匹配|属于)\b/.test(raw) || /"match"\s*:\s*"yes"/.test(raw)) return 'yes'
  return 'uncertain'
}
