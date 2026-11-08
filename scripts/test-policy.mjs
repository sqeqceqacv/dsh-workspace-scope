// Pure-function tests for the P1 policy layer. Run with:
//   node scripts/test-policy.mjs
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { allKnownToolNames, toolsFromGroups } from '../packages/workspace-scope/lib/groups.js'
import { effectiveGroups, setGroupConfigForTests } from '../packages/workspace-scope/lib/group-config.js'
import { setRuntimeToolNames } from '../packages/workspace-scope/lib/runtime-tools.js'

setGroupConfigForTests({ customGroups: [], overrides: {} })
import {
  fallbackPolicyPath,
  policyPathFor,
  policyText,
  contextAllowed,
  sectionAllowed,
  toolAllowed,
} from '../packages/workspace-scope/lib/policy.js'
import {
  DEFAULT_TEMPLATES,
  applyTemplate,
  fullOpenPolicy,
  loadTemplates,
  policyFromTemplate,
} from '../packages/workspace-scope/lib/store.js'
import { TOOL_DESCRIPTIONS } from '../packages/workspace-scope/lib/tool-descriptions.js'
import { stripTeamRuntimeContext } from '../packages/workspace-scope/lib/team-context.js'
import { filterAssemblyTools } from '../packages/workspace-scope/lib/tool-assembly.js'

const allOn = {
  file: true, web: true, shell: true, conversation: true,
  memory: true, agent: true, system: true,
}

let passed = 0
function check(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}`)
    console.error(error)
    process.exitCode = 1
  }
}

check('core groups expose a non-empty tool set', () => assert.ok(allKnownToolNames().size > 0))
check('no groups = no tools', () => assert.equal(toolsFromGroups({}).size, 0))
check('all core groups expose every core tool', () => assert.equal(toolsFromGroups(allOn).size, allKnownToolNames().size))
check('runtime prefix groups are discovered and default off', () => {
  setRuntimeToolNames(['read', 'example_read', 'example_write', 'other_one', 'other_two'])
  const groups = effectiveGroups({ customGroups: [], overrides: {} })
  const example = groups.find((group) => group.id === 'runtime:example')
  assert.ok(example, 'missing runtime:example group')
  assert.deepEqual(example.tools, ['example_read', 'example_write'])
  assert.ok(!groups.some((group) => group.id === 'runtime:read'), 'core tools must not become runtime groups')
  assert.equal(toolsFromGroups({}, groups).size, 0)
  assert.ok(toolsFromGroups({ 'runtime:example': true }, groups).has('example_read'))
  setRuntimeToolNames([])
})
check('agent subgroup enables only its tools', () => {
  const tools = toolsFromGroups({ 'agent.planning': true })
  assert.equal(tools.size, 5)
  assert.ok(tools.has('todo_write'))
  assert.ok(!tools.has('schedule_list'))
})

const allPolicy = {
  enabled: true,
  groups: allOn,
  tools: { allow: [], deny: ['schedule_list'] },
  sections: { allow: [], deny: ['app:web-surface'] },
  rules: { global: true },
}

check('deny wins over group', () => assert.equal(toolAllowed(allPolicy, 'schedule_list'), false))
check('allow can add an off tool', () => {
  const policy = { ...allPolicy, groups: {}, tools: { allow: ['read', 'mcp__*'], deny: [] } }
  assert.equal(toolAllowed(policy, 'read'), true)
  assert.equal(toolAllowed(policy, 'write'), false)
  assert.equal(toolAllowed(policy, 'mcp__game__move'), true)
})
check('base sections always allowed', () => {
  assert.equal(sectionAllowed(allPolicy, 'harness:identity'), true)
  assert.equal(sectionAllowed(allPolicy, 'workspace-scope:policy'), true)
  assert.equal(sectionAllowed(allPolicy, 'context:file-reference'), true)
})
check('file reference drops when no file tool is available', () => {
  const noTools = { ...allPolicy, groups: {} }
  assert.equal(sectionAllowed(noTools, 'context:file-reference'), false)
  const fileOnly = { ...allPolicy, groups: { file: true } }
  assert.equal(sectionAllowed(fileOnly, 'context:file-reference'), true)
})
check('no-tools policy text warns against tool calls', () => {
  const text = policyText({ ...allPolicy, groups: {} }, { title: 't', path: 'p' })
  assert.ok(text.includes('没有启用任何工具'))
  assert.ok(text.includes('不要输出工具调用标签'))
  assert.ok(text.includes('新开一个对话'))
})
check('policy text reserves policy changes for the user', () => {
  const text = policyText(allPolicy, { title: 't', path: 'p' })
  assert.ok(text.includes('不得直接修改'))
  assert.ok(text.includes('用户在工作区设置中确认'))
  assert.ok(text.includes('安装/注册插件成功不等于'))
})
check('SOUL is injected only when enabled', () => {
  const off = policyText({ ...allPolicy, identity: { persona: '', soulEnabled: false, soul: 'SOUL-X' } }, { title: 't', path: 'p' })
  const on = policyText({ ...allPolicy, identity: { persona: '', soulEnabled: true, soul: 'SOUL-X' } }, { title: 't', path: 'p' })
  assert.ok(!off.includes('SOUL-X'))
  assert.ok(on.includes('## 工作区 SOUL'))
  assert.ok(on.includes('SOUL-X'))
})
check('policy text exposes disabled theme judge', () => {
  const text = policyText({ ...allPolicy, memory: { judge: false, theme: 'should-not-show' } }, { title: 't', path: 'p' })
  assert.ok(text.includes('主题 judge：关闭'))
  assert.ok(text.includes('不要主动询问或设置主题'))
  assert.ok(text.includes('记忆主题：（未设置）'))
  assert.ok(!text.includes('should-not-show'))
})
check('MCP resources follow the MCP tool allowlist', () => {
  assert.equal(sectionAllowed({ ...allPolicy, tools: { allow: [], deny: [] } }, 'mcp-resource-servers'), false)
  assert.equal(sectionAllowed({ ...allPolicy, tools: { allow: ['mcp__matlab__*'], deny: [] } }, 'mcp-resource-servers'), true)
  assert.equal(sectionAllowed({ ...allPolicy, tools: { allow: ['mcp__matlab__*'], deny: ['mcp__*'] } }, 'mcp-resource-servers'), false)
})
check('D18 is dropped, D19/D20 follow system group', () => {
  assert.equal(sectionAllowed(allPolicy, 'ui:deliverable-file-references'), false)
  assert.equal(sectionAllowed(allPolicy, 'app:web-surface'), false)
  assert.equal(sectionAllowed({ ...allPolicy, sections: { allow: [], deny: [] } }, 'app:web-surface'), true)
})
check('tool guidance follows allowlist', () => {
  assert.equal(sectionAllowed(allPolicy, 'tool:read'), true)
  assert.equal(sectionAllowed(allPolicy, 'tool:jobs'), true)
  assert.equal(sectionAllowed(allPolicy, 'tool:goal'), true)
  assert.equal(sectionAllowed({ ...allPolicy, groups: {} }, 'tool:read'), false)
})
check('global rules switch', () => {
  assert.equal(sectionAllowed({ ...allPolicy, rules: { global: false } }, 'global-rules'), false)
  assert.equal(sectionAllowed(allPolicy, 'global-rules'), true)
  assert.equal(toolAllowed({ ...allPolicy, rules: { global: false } }, 'global_rule'), false)
  assert.equal(toolAllowed(allPolicy, 'global_rule'), true)
})
check('memory guide follows memory group', () => {
  assert.equal(sectionAllowed(allPolicy, 'meow-memory:guide'), true)
  assert.equal(sectionAllowed({ ...allPolicy, groups: {} }, 'meow-memory:guide'), false)
})
check('templates default to all-off', () => {
  for (const template of DEFAULT_TEMPLATES) {
    assert.deepEqual(template.switches.groups, {})
    assert.deepEqual(template.switches.tools.allow, [])
  }
})
check('policy from template is managed with no groups', () => {
  const policy = policyFromTemplate(DEFAULT_TEMPLATES[0])
  assert.equal(policy.enabled, true)
  assert.equal(policy.template, 'default')
  assert.deepEqual(policy.groups, {})
})
check('memory config defaults off with detailed switches on', () => {
  const policy = policyFromTemplate(DEFAULT_TEMPLATES[0])
  assert.equal(policy.memory.enabled, false)
  assert.deepEqual(policy.memory.inject, { snapshot: true, hits: true, reinject: true })
  assert.deepEqual(policy.memory.tools, { read: true, write: true })
  assert.deepEqual(policy.memory.auto, { reflect: true, dream: false, theme: true })
  assert.equal(policy.memory.hitTopK, 6)
  assert.equal(policy.memory.titleMax, 40)
  assert.equal(policy.memory.reflectTurns, 20)
  assert.equal(policy.memory.dream.idleMinutes, 180)
  assert.equal(policy.memory.soulAiWritable, false)
})
check('full open policy enables every core group', () => {
  const policy = fullOpenPolicy()
  assert.equal(Object.keys(policy.groups).length, 7)
  assert.equal(toolsFromGroups(policy.groups).size, allKnownToolNames().size)
  assert.deepEqual(policy.tools, { allow: [], deny: [] })
})
check('a tool belongs to exactly one regular group', () => {
  const groups = effectiveGroups({
    customGroups: [{ id: 'custom-test', name: '测试组', order: 99 }],
    overrides: { read: 'custom-test', write: 'custom-test' },
  })
  const containers = []
  for (const group of groups) {
    if ((group.tools ?? []).includes('read')) containers.push(group.id)
    for (const sub of group.subgroups ?? []) {
      if ((sub.tools ?? []).includes('read')) containers.push(`${group.id}.${sub.id}`)
    }
  }
  assert.deepEqual(containers, ['custom-test'])
  const file = groups.find((group) => group.id === 'file')
  assert.ok(!file.tools.includes('read'))
})
check('deleted groups disappear and their tools become ungrouped', () => {
  setGroupConfigForTests({ customGroups: [], overrides: {}, removedGroups: ['file'] })
  const groups = effectiveGroups()
  assert.ok(!groups.some((group) => group.id === 'file'))
  assert.ok(!toolsFromGroups({ file: true }, groups).has('read'))
  setGroupConfigForTests({ customGroups: [], overrides: {}, removedGroups: [], purgedGroups: ['file'] })
  const purged = effectiveGroups()
  assert.ok(!purged.some((group) => group.id === 'file'))
  assert.ok(!toolsFromGroups({ file: true }, purged).has('read'))
  setGroupConfigForTests({ customGroups: [], overrides: {} })
})
check('team section and identity follow enabled team tools', () => {
  assert.equal(sectionAllowed(null, 'team:policy'), false)
  assert.equal(contextAllowed(null, 'team:identity'), false)
  assert.equal(sectionAllowed(null, 'harness:identity'), true)
  const conversationOnly = { enabled: true, groups: { conversation: true }, tools: { allow: [], deny: [] } }
  assert.equal(sectionAllowed(conversationOnly, 'team:policy'), false)
  assert.equal(contextAllowed(conversationOnly, 'team:identity'), false)
  const explicitTeamTool = { enabled: true, groups: {}, tools: { allow: ['spawn_teammate'], deny: [] } }
  assert.equal(sectionAllowed(explicitTeamTool, 'team:policy'), true)
  assert.equal(contextAllowed(explicitTeamTool, 'team:identity'), true)
  const agentGroup = { enabled: true, groups: { agent: true }, tools: { allow: [], deny: [] } }
  assert.equal(sectionAllowed(agentGroup, 'team:policy'), true)
  assert.equal(contextAllowed(agentGroup, 'team:identity'), true)
})
check('team runtime-context sections are stripped', () => {
  const decision = {
    kind: 'enter',
    messages: [{
      source: {
        kind: 'runtime-context',
        form: 'snapshot',
        sections: [
          { name: 'working-directory:current', text: 'Working: F:\\onlyChat_dsh' },
          { name: 'team:identity', text: 'You are the Team Lead named "lead".' },
        ],
      },
      content: [{ type: 'text', text: 'Current runtime context.\n\nWorking: F:\\onlyChat_dsh\n\nYou are the Team Lead named "lead".' }],
    }],
  }
  const stripped = stripTeamRuntimeContext(decision)
  assert.deepEqual(stripped.messages[0].source.sections.map((section) => section.name), ['working-directory:current'])
  assert.ok(!stripped.messages[0].content[0].text.includes('Team Lead'))
  const teamOnly = stripTeamRuntimeContext({
    messages: [{ source: { kind: 'runtime-context', sections: [{ name: 'team:identity', text: 'team' }] }, content: [{ type: 'text', text: 'team' }] }],
  })
  assert.equal(teamOnly.messages.length, 0)
})
check('final assembled tools respect the workspace policy', () => {
  const policy = { enabled: true, groups: { conversation: true }, tools: { allow: [], deny: [] } }
  const filtered = filterAssemblyTools({
    sections: [],
    contexts: [],
    tools: [{ name: 'ask_user_question' }, { name: 'read' }, { name: 'comfyui_server' }],
  }, policy)
  assert.deepEqual(filtered.tools.map((tool) => tool.name), ['ask_user_question'])
})
check('every grouped tool has a curated description', () => {
  for (const name of allKnownToolNames()) assert.ok(TOOL_DESCRIPTIONS[name], `missing description: ${name}`)
})
check('apply template keeps identity and memory', () => {
  const base = { ...policyFromTemplate(DEFAULT_TEMPLATES[0]), identity: { persona: 'x' }, memory: { theme: 't', project: 'p' } }
  const applied = applyTemplate(base, { id: 'custom', switches: { groups: { file: true }, tools: { allow: ['read'], deny: [] } } })
  assert.equal(applied.template, 'custom')
  assert.deepEqual(applied.groups, { file: true })
  assert.deepEqual(applied.identity, { persona: 'x' })
  assert.deepEqual(applied.memory, { theme: 't', project: 'p' })
})
check('default template is the all-off placeholder', () => {
  const templates = loadTemplates()
  assert.equal(DEFAULT_TEMPLATES.length, 1)
  assert.ok(templates.some((item) => item.id === 'default'))
  assert.deepEqual(DEFAULT_TEMPLATES[0].switches, { groups: {}, tools: { allow: [], deny: [] } })
})
check('fallback policy path is outside the workspace', () => {
  const workspacePath = join(tmpdir(), 'workspace-scope-policy-test')
  const path = fallbackPolicyPath({ path: workspacePath })
  assert.ok(!path.startsWith(workspacePath))
  assert.ok(path.endsWith('.json'))
})

console.log(`\n${passed} checks passed`)
