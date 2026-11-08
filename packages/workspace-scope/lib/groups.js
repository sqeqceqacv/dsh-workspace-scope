// Core capability groups used by the workspace-scope policy.
//
// Only DSH built-in tools and tools owned by this plugin belong here. Tools
// supplied by other plugins are discovered at runtime and grouped by prefix
// in runtime-tools.js; they must never be hard-coded in this file.

import { getRuntimeToolNames } from './runtime-tools.js'

export const GROUPS = [
  {
    id: 'file',
    name: '文件操作',
    tools: ['read', 'write', 'edit', 'read_image', 'glob', 'grep', 'working_directory', 'create_worktree'],
  },
  { id: 'web', name: '网络', tools: ['web_search', 'web_fetch'] },
  { id: 'shell', name: '命令', tools: ['pwsh', 'load_workspace_dependencies'] },
  { id: 'conversation', name: '对话', tools: ['ask_user_question', 'present'] },
  {
    id: 'memory',
    name: '记忆',
    tools: [
      'memory_search', 'memory_read', 'memory_remember', 'memory_update',
      'memory_find_similar', 'memory_project', 'memory_dream', 'memory_home',
      'memory_theme',
    ],
  },
  {
    id: 'agent',
    name: 'Agent 能力',
    tools: [],
    subgroups: [
      { id: 'skills', name: '技能', tools: ['skill'] },
      {
        id: 'delegation',
        name: '子代理与团队',
        tools: [
          'subagent', 'subagent_fork', 'workflow', 'spawn_teammate', 'send_message',
          'list_agents', 'wait_agent', 'interrupt_agent', 'team_task_create',
          'team_task_get', 'team_task_list', 'team_task_update',
        ],
      },
      {
        id: 'planning',
        name: '计划与目标',
        tools: ['todo_write', 'create_goal', 'get_goal', 'update_goal', 'exit_plan_mode'],
      },
      {
        id: 'background',
        name: '后台任务',
        tools: ['job_list', 'job_output', 'job_kill', 'schedule_create', 'schedule_list', 'schedule_view', 'schedule_edit'],
      },
    ],
  },
  {
    id: 'system',
    name: '系统',
    tools: ['cordis_inspect_list', 'cordis_inspect_query', 'plugin_manager', 'global_rule'],
  },
]

function coreToolNames(groups = GROUPS) {
  const names = new Set()
  for (const group of groups) {
    for (const tool of group.tools ?? []) names.add(tool)
    for (const sub of group.subgroups ?? []) for (const tool of sub.tools ?? []) names.add(tool)
  }
  return names
}

export function allKnownToolNames(groups = GROUPS) {
  const names = coreToolNames(groups)
  for (const name of getRuntimeToolNames()) names.add(name)
  return names
}

/** Tools enabled by the group switch map. Top-level true enables all subgroups. */
export function toolsFromGroups(groupState = {}, groups = GROUPS) {
  const enabled = new Set()
  for (const group of groups) {
    const groupOn = groupState[group.id] === true
    for (const tool of group.tools ?? []) if (groupOn) enabled.add(tool)
    for (const sub of group.subgroups ?? []) {
      const key = `${group.id}.${sub.id}`
      if (groupOn || groupState[key] === true) {
        for (const tool of sub.tools ?? []) enabled.add(tool)
      }
    }
  }
  return enabled
}

export function groupStateSummary(groupState = {}, groups = GROUPS) {
  const out = []
  for (const group of groups) {
    if (groupState[group.id] === true) { out.push(group.id); continue }
    for (const sub of group.subgroups ?? []) {
      if (groupState[`${group.id}.${sub.id}`] === true) out.push(`${group.id}.${sub.id}`)
    }
  }
  return out
}
