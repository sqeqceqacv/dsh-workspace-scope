import assert from 'node:assert/strict'
import { buildThemeMatchPrompt, buildThemeProposalPrompt, parseThemeMatch, parseThemeProposal } from './lib/index.js'

assert.match(buildThemeProposalPrompt({ workspaceName: 'demo', samples: ['a'] }).system, /JSON/)
assert.deepEqual(parseThemeProposal('{"theme":"插件开发","reason":"围绕插件"}'), { theme: '插件开发', reason: '围绕插件' })
assert.deepEqual(parseThemeProposal('```json\n{"theme":"DSH 插件"}\n```'), { theme: 'DSH 插件', reason: '' })
assert.deepEqual(parseThemeProposal('这是一个主题'), { theme: '这是一个主题', reason: '' })
assert.equal(parseThemeProposal('无主题'), null)
assert.equal(parseThemeProposal(''), null)
assert.equal(parseThemeMatch('{"match":"yes"}'), 'yes')
assert.equal(parseThemeMatch('{"match":"no"}'), 'no')
assert.equal(parseThemeMatch('不确定'), 'uncertain')
assert.equal(parseThemeMatch('乱说'), 'uncertain')
assert.match(buildThemeMatchPrompt('插件', { level: 'fact', content: 'x' }).user, /主题/)
assert.match(buildThemeMatchPrompt('插件', { level: 'fact', content: 'x' }).system, /通用技术经验/)
assert.match(buildThemeMatchPrompt('小说', { level: 'fact', content: 'x' }).system, /非技术主题/)
console.log('PASS judge helpers: prompt build + parse')
