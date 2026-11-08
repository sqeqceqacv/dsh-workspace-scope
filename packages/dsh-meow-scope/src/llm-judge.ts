/**
 * Thin LLM call layer for theme proposal/judge.
 *
 * The host supplies an LlmRuntime-compatible `stream` service and a concrete
 * provider/model route.  This module stays free of Cordis so it can be tested
 * with a fake stream and wired into the plugin later.
 */

import { createUserMessage } from '@deepseek-ai/dsh-llm'
import {
  buildThemeMatchPrompt,
  buildThemeProposalPrompt,
  parseThemeMatch,
  parseThemeProposal,
  type TextPrompt,
  type ThemePromptInput,
} from './judge.js'

export interface JudgeRoute {
  provider: string
  model: string
}

export interface LlmStreamLike {
  stream(options: {
    provider: string
    model: string
    system?: string
    messages: ReturnType<typeof createUserMessage>[]
    temperature?: number
    maxTokens?: number
  }): AsyncIterable<{ type?: string; text?: string }>
}

export async function runTextCall(llm: LlmStreamLike, route: JudgeRoute, prompt: TextPrompt, maxTokens = 300): Promise<string> {
  let text = ''
  const messages = [createUserMessage({ content: [{ type: 'text', text: prompt.user }] })]
  for await (const chunk of llm.stream({
    provider: route.provider,
    model: route.model,
    system: prompt.system,
    messages,
    temperature: 0.2,
    maxTokens,
  })) {
    if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
  }
  return text.trim()
}

export async function requestThemeProposal(llm: LlmStreamLike, route: JudgeRoute, input: ThemePromptInput): Promise<{ theme: string; reason: string } | null> {
  try {
    const text = await runTextCall(llm, route, buildThemeProposalPrompt(input), 300)
    return parseThemeProposal(text)
  } catch {
    return null
  }
}

export async function judgeThemeMatch(
  llm: LlmStreamLike,
  route: JudgeRoute,
  theme: string,
  entry: { level: string; content: string },
): Promise<'yes' | 'no' | 'uncertain'> {
  try {
    const text = await runTextCall(llm, route, buildThemeMatchPrompt(theme, entry), 120)
    return parseThemeMatch(text)
  } catch {
    return 'uncertain'
  }
}
