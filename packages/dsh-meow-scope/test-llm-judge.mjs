import assert from 'node:assert/strict'
import { judgeThemeMatch, requestThemeProposal, runTextCall } from './lib/index.js'

function fake(text) {
  return {
    async *stream() {
      yield { type: 'text-delta', text: text.slice(0, 2) }
      yield { type: 'text-delta', text: text.slice(2) }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
}

const route = { provider: 'p', model: 'm' }
assert.equal(await runTextCall(fake('hello'), route, { system: 's', user: 'u' }), 'hello')
assert.deepEqual(
  await requestThemeProposal(fake('{"theme":"插件开发","reason":"r"}'), route, { workspaceName: 'w', samples: ['x'] }),
  { theme: '插件开发', reason: 'r' },
)
assert.equal(await judgeThemeMatch(fake('{"match":"yes"}'), route, '插件开发', { level: 'fact', content: 'x' }), 'yes')
assert.equal(await judgeThemeMatch({ async *stream() { throw new Error('offline') } }, route, 't', { level: 'fact', content: 'x' }), 'uncertain')
console.log('PASS llm judge: text call + proposal + match fallback')
