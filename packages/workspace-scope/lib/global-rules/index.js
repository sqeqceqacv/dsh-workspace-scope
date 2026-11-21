/**
 * dsh-global-rules — 跨工作区通用规则层
 *
 * - 注入：往 system prompt 挂一个全局 section（每次装配求值，改文件即生效）
 * - 命令：/rule 家族，命令平面直接写文件，不经过模型
 * - 工具：global_rule，默认只读；gate.enabled 打开后写操作需一次 /rule ai on 授权
 *
 * 运行期只依赖 node 内置模块，便于离线单测。
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_FILENAME,
  DEFAULT_MAX_CHARS,
  DEFAULT_MAX_ENTRIES,
  MAX_BODY_CHARS,
  parseRules,
  renderBlock,
  renderRules,
  readRulesFile,
  splitEntry,
  validateEntry,
  writeRulesFile,
} from './rules.js';

export const name = 'global-rules';
export const inject = [];

const DEFAULTS = {
  file: '',
  sectionOrder: 120,
  maxChars: DEFAULT_MAX_CHARS,
  maxEntries: DEFAULT_MAX_ENTRIES,
  gate: { enabled: true, ttlMinutes: 10 },
};

const LOG_PREFIX = 'global-rules:';

function normalizeConfig(raw) {
  const input = raw !== null && typeof raw === 'object' ? raw : {};
  const gateInput = input.gate !== null && typeof input.gate === 'object' ? input.gate : {};
  return {
    file: typeof input.file === 'string' ? input.file : DEFAULTS.file,
    sectionOrder: Number.isFinite(input.sectionOrder) ? input.sectionOrder : DEFAULTS.sectionOrder,
    maxChars: Number.isFinite(input.maxChars) && input.maxChars > 0 ? Math.floor(input.maxChars) : DEFAULTS.maxChars,
    maxEntries: Number.isFinite(input.maxEntries) && input.maxEntries > 0 ? Math.floor(input.maxEntries) : DEFAULTS.maxEntries,
    gate: {
      enabled: gateInput.enabled === undefined ? DEFAULTS.gate.enabled : gateInput.enabled === true,
      ttlMinutes: Number.isFinite(gateInput.ttlMinutes) && gateInput.ttlMinutes > 0 ? gateInput.ttlMinutes : DEFAULTS.gate.ttlMinutes,
    },
  };
}

function resolveRulesPath(config) {
  const configured = typeof config.file === 'string' ? config.file.trim() : '';
  if (configured) return configured;
  const home = process.env.DSH_HOME || join(homedir(), '.dsh');
  return join(home, DEFAULT_FILENAME);
}

function sessionIdOf(exec) {
  const header = exec?.agent?.session?.header ?? {};
  const id = typeof header.id === 'string' && header.id.length > 0 ? header.id : null;
  if (header.origin === 'subagent' && header.parentSession !== undefined) {
    const parent = header.parentSession;
    if (typeof parent === 'string' && parent.length > 0) return parent;
    if (parent !== null && typeof parent === 'object' && typeof parent.id === 'string' && parent.id.length > 0) return parent.id;
  }
  return id;
}

function sessionIdOfAgent(agent) {
  const header = agent?.session?.header ?? {};
  return typeof header.id === 'string' && header.id.length > 0 ? header.id : null;
}

export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig);
  const file = resolveRulesPath(config);

  let cache = { mtimeMs: -1, entries: [] };
  let lastError = null;

  function loadEntries() {
    const result = readRulesFile(file);
    if (!result.ok) {
      lastError = result.error;
      return cache.entries;
    }
    if (result.mtimeMs !== cache.mtimeMs) {
      cache = { mtimeMs: result.mtimeMs, entries: result.entries };
    }
    lastError = null;
    return cache.entries;
  }

  function sectionText() {
    try {
      return renderBlock(loadEntries(), { maxChars: config.maxChars, maxEntries: config.maxEntries });
    } catch (error) {
      ctx?.logger?.warn?.(`${LOG_PREFIX} render failed: ${error instanceof Error ? error.message : String(error)}`);
      return '';
    }
  }

  // ---- 写入门禁 ----
  const armedUntil = new Map();

  function isArmed(sessionId) {
    if (config.gate.enabled !== true) return true;
    if (!sessionId) return false;
    const until = armedUntil.get(sessionId) ?? 0;
    if (Date.now() > until) {
      armedUntil.delete(sessionId);
      return false;
    }
    return true;
  }

  function arm(sessionId) {
    if (!sessionId) return false;
    armedUntil.set(sessionId, Date.now() + config.gate.ttlMinutes * 60_000);
    return true;
  }

  function disarm(sessionId) {
    if (sessionId) armedUntil.delete(sessionId);
  }

  // ---- 读写 ----
  function listEntries() {
    return { path: file, entries: loadEntries(), error: lastError };
  }

  function formatList() {
    const { entries } = listEntries();
    if (entries.length === 0) {
      return `全局规则清单为空。\n文件：${file}\n用 /rule add 标题 | 正文 添加第一条。`;
    }
    const lines = entries.map((e, i) => {
      const first = e.body.split('\n').find((line) => line.trim().length > 0) ?? '';
      return `${i + 1}. ${e.title}${first ? ` — ${first.slice(0, 60)}` : ''}`;
    });
    return [`共 ${entries.length} 条 · ${file}`, '', ...lines].join('\n');
  }

  function applyWrite({ mode, title, body, sessionId }) {
    const entries = loadEntries();
    const ignoreTitle = mode === 'update' ? title : null;
    const validated = validateEntry({ title, body }, entries, {
      maxEntries: config.maxEntries,
      maxChars: config.maxChars,
      ignoreTitle,
    });
    if (!validated.ok) return { ok: false, error: validated.error };

    const next = mode === 'update'
      ? entries.map((e) => (e.title === title ? validated.entry : e))
      : entries.concat([validated.entry]);

    try {
      writeRulesFile(file, renderRules(next));
    } catch (error) {
      return { ok: false, error: `写入失败：${error instanceof Error ? error.message : String(error)}` };
    }
    cache = { mtimeMs: -1, entries: [] };
    loadEntries();
    if (mode !== 'update') disarm(sessionId);
    else disarm(sessionId);
    return { ok: true, entry: validated.entry, total: next.length };
  }

  function removeEntry(title, sessionId) {
    const entries = loadEntries();
    const target = typeof title === 'string' ? title.trim() : '';
    if (!target) return { ok: false, error: '需要提供标题' };
    const next = entries.filter((e) => e.title !== target);
    if (next.length === entries.length) return { ok: false, error: `没有找到「${target}」` };
    try {
      writeRulesFile(file, renderRules(next));
    } catch (error) {
      return { ok: false, error: `写入失败：${error instanceof Error ? error.message : String(error)}` };
    }
    cache = { mtimeMs: -1, entries: [] };
    loadEntries();
    disarm(sessionId);
    return { ok: true, title: target, total: next.length };
  }

  // ---- system prompt section ----
  const disposers = [];
  let sectionDisposer = null;
  let sectionTimer = 0;
  const tryRegisterSection = (attempt) => {
    if (sectionDisposer !== null) return;
    const service = ctx.get?.('systemPrompt');
    if (service === undefined || typeof service.section !== 'function') {
      if (attempt < 20) sectionTimer = setTimeout(() => tryRegisterSection(attempt + 1), 1_000);
      else ctx?.logger?.warn?.(`${LOG_PREFIX} systemPrompt 服务 20s 内未就绪，规则未注入`);
      return;
    }
    try {
      const dispose = service.section({ name: 'global-rules', order: config.sectionOrder, text: sectionText });
      sectionDisposer = typeof dispose === 'function' ? dispose : () => {};
      disposers.push(sectionDisposer);
      ctx?.logger?.info?.(`${LOG_PREFIX} section 已注入（order=${config.sectionOrder}, file=${file}）`);
    } catch (error) {
      sectionDisposer = () => {};
      ctx?.logger?.warn?.(`${LOG_PREFIX} section 注册失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };
  tryRegisterSection(0);

  // ---- 工具 ----
  const tool = {
    name: 'global_rule',
    description: [
      '跨工作区通用规则清单的查看与维护。',
      'action=list 随时可用；add/update/remove 是写操作，仅在用户执行 /rule ai on 授权后可用（一次性，写入成功即上锁）。',
      '写入被拒时不要重试，直接告诉用户需要先 /rule ai on，或用 /rule add 标题 | 正文 由用户自己写入。',
    ].join(''),
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: { type: 'string', enum: ['list', 'add', 'update', 'remove'], description: 'list=只读清单；add/update/remove=写操作（需授权）' },
        title: { type: 'string', description: '条目标题（add/update/remove 必填，唯一）' },
        body: { type: 'string', description: '条目正文，一到两句（add/update 必填）' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['ok', 'text'],
        properties: {
          ok: { type: 'boolean' },
          text: { type: 'string' },
          count: { type: 'integer' },
          path: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: String(value?.text ?? '') }],
    },
    async execute(args, exec) {
      const action = typeof args?.action === 'string' ? args.action : 'list';
      const sessionId = sessionIdOf(exec);
      const title = typeof args?.title === 'string' ? args.title.trim() : '';
      const body = typeof args?.body === 'string' ? args.body.trim() : '';

      if (action === 'list') {
        const { entries, error } = listEntries();
        const text = entries.length === 0
          ? `全局规则清单为空。文件：${file}`
          : [`共 ${entries.length} 条 · ${file}`, '', ...entries.map((e, i) => `${i + 1}. ${e.title}\n${e.body}`)].join('\n');
        return { ok: true, text, count: entries.length, path: file, ...(error ? { text: `${text}\n\n（读取告警：${error}）` } : {}) };
      }

      if (config.gate.enabled === true && !isArmed(sessionId)) {
        return {
          ok: false,
          text: '未授权写入：跨工作区通用规则默认只读。需要用户先执行 /rule ai on 解锁（一次性），或由用户用 /rule add 标题 | 正文 自己写入。',
          count: loadEntries().length,
          path: file,
        };
      }

      if (action === 'remove') {
        const result = removeEntry(title, sessionId);
        return result.ok
          ? { ok: true, text: `已删除「${result.title}」，当前 ${result.total} 条。`, count: result.total, path: file }
          : { ok: false, text: `删除失败：${result.error}`, count: loadEntries().length, path: file };
      }

      if (action === 'add' || action === 'update') {
        if (!title || !body) return { ok: false, text: 'add/update 需要同时提供 title 与 body。', count: loadEntries().length, path: file };
        const result = applyWrite({ mode: action, title, body, sessionId });
        return result.ok
          ? {
            ok: true,
            text: `${action === 'add' ? '已新增' : '已更新'}「${result.entry.title}」，当前 ${result.total} 条${config.gate.enabled ? '（已自动上锁）' : ''}。`,
            count: result.total,
            path: file,
          }
          : { ok: false, text: `写入失败：${result.error}`, count: loadEntries().length, path: file };
      }

      return { ok: false, text: `未知 action：${action}`, count: loadEntries().length, path: file };
    },
  };

  let toolTimer = 0;
  let toolRegistered = false;
  const tryRegisterTool = (attempt) => {
    if (toolRegistered) return;
    const service = ctx.get?.('tools');
    if (service === undefined || typeof service.register !== 'function') {
      if (attempt < 20) toolTimer = setTimeout(() => tryRegisterTool(attempt + 1), 1_000);
      else ctx?.logger?.warn?.(`${LOG_PREFIX} tools 服务 20s 内未就绪，global_rule 未注册`);
      return;
    }
    try {
      const dispose = service.register(tool);
      toolRegistered = true;
      if (typeof dispose === 'function') disposers.push(dispose);
      ctx?.logger?.info?.(`${LOG_PREFIX} tool global_rule registered`);
    } catch (error) {
      toolRegistered = true;
      ctx?.logger?.warn?.(`${LOG_PREFIX} tool 注册失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };
  tryRegisterTool(0);

  // ---- 命令 ----
  const HELP = [
    '用法：',
    '/rule                       列出全部规则',
    '/rule show 标题             查看某条',
    '/rule add 标题 | 正文       新增（命令直写，不经过模型）',
    '/rule update 标题 | 正文    覆盖某条正文',
    '/rule remove 标题           删除',
    '/rule ai on | off            解锁/上锁本会话的 AI 写入（一次性）',
    '/rule path                  显示规则文件路径',
  ].join('\n');

  function handleRule(rawInput) {
    const raw = typeof rawInput === 'string' ? rawInput.trim() : '';
    const space = raw.search(/\s/);
    const sub = (space < 0 ? raw : raw.slice(0, space)).toLowerCase() || 'list';
    const rest = space < 0 ? '' : raw.slice(space + 1).trim();

    switch (sub) {
      case 'list':
        return { kind: 'success', text: formatList() };
      case 'path':
        return { kind: 'success', text: file };
      case 'show': {
        const entries = loadEntries();
        const entry = entries.find((e) => e.title === rest);
        return entry
          ? { kind: 'success', text: `## ${entry.title}\n\n${entry.body}` }
          : { kind: 'error', text: `没有找到「${rest}」。可先 /rule 查看清单。` };
      }
      case 'add':
      case 'update': {
        const entry = splitEntry(rest);
        if (!entry.title || !entry.body) {
          return { kind: 'error', text: `格式：/rule ${sub} 标题 | 正文\n标题与正文用竖线分隔。` };
        }
        const result = applyWrite({ mode: sub, title: entry.title, body: entry.body, sessionId: null });
        return result.ok
          ? { kind: 'success', text: `✅ ${sub === 'add' ? '已新增' : '已更新'}「${result.entry.title}」，当前 ${result.total} 条。` }
          : { kind: 'error', text: `❌ ${result.error}` };
      }
      case 'remove': {
        const result = removeEntry(rest, null);
        return result.ok
          ? { kind: 'success', text: `✅ 已删除「${result.title}」，当前 ${result.total} 条。` }
          : { kind: 'error', text: `❌ ${result.error}` };
      }
      case 'ai':
        // 该路径拿不到会话 id，无法调用 arm()；真正的解锁在命令 handler 中完成。
        return { kind: 'error', text: '请在命令面板执行 /rule ai on（需要会话上下文），此处无法解锁。' };
      case 'help':
        return { kind: 'success', text: HELP };
      default:
        return { kind: 'error', text: `未知子命令 ${sub}\n\n${HELP}` };
    }
  }

  let commandTimer = 0;
  let commandRegistered = false;
  const tryRegisterCommand = (attempt) => {
    if (commandRegistered) return;
    const commands = ctx.get?.('commands');
    if (commands === undefined || typeof commands.register !== 'function') {
      if (attempt < 20) commandTimer = setTimeout(() => tryRegisterCommand(attempt + 1), 1_000);
      else ctx?.logger?.warn?.(`${LOG_PREFIX} commands 服务 20s 内未就绪，/rule 未注册`);
      return;
    }
    try {
      const dispose = commands.register({
        name: 'rule',
        description: '查看与维护跨工作区通用规则',
        input: { hint: 'list | show 标题 | add 标题 | 正文 | update 标题 | 正文 | remove 标题 | ai on|off | path' },
        handler(invocation) {
          const sessionId = sessionIdOfAgent(invocation?.agent);
          const raw = typeof invocation?.rawInput === 'string' ? invocation.rawInput.trim() : '';
          const space = raw.search(/\s/);
          const sub = (space < 0 ? raw : raw.slice(0, space)).toLowerCase();
          if (sub === 'ai') {
            const arg = space < 0 ? '' : raw.slice(space + 1).trim();
            if (arg === 'on') {
              if (config.gate.enabled !== true) {
                return { kind: 'success', text: '当前未启用写入门禁（config.gate.enabled=false），AI 写工具本来就可用。' };
              }
              if (!arm(sessionId)) return { kind: 'error', text: '无法识别当前会话，解锁失败。' };
              return { kind: 'success', text: `已临时解锁本会话的 AI 写入，有效期 ${config.gate.ttlMinutes} 分钟，成功写入一条后自动上锁。` };
            }
            if (arg === 'off') {
              disarm(sessionId);
              return { kind: 'success', text: '已上锁：本会话 AI 写入已关闭（用户用 /rule add 仍可写）。' };
            }
            return {
              kind: 'success',
              text: `写入门禁：${config.gate.enabled ? '已启用' : '未启用'}${isArmed(sessionId) ? '（当前会话已解锁）' : ''}。用法 /rule ai on | off`,
            };
          }
          return handleRule(raw);
        },
      });
      commandRegistered = true;
      if (typeof dispose === 'function') disposers.push(dispose);
      ctx?.logger?.info?.(`${LOG_PREFIX} command /rule registered`);
    } catch (error) {
      commandRegistered = true;
      ctx?.logger?.warn?.(`${LOG_PREFIX} /rule 注册失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };
  tryRegisterCommand(0);

  // ---- 生命周期 ----
  try {
    ctx.on?.('session/event', (session, event) => {
      if (event?.type === 'turn/end') disarm(session?.id);
    });
  } catch {
    /* 事件服务不可用不致命 */
  }

  try {
    ctx.on?.('dispose', () => {
      clearTimeout(sectionTimer);
      clearTimeout(commandTimer);
      clearTimeout(toolTimer);
      armedUntil.clear();
      for (const dispose of disposers) {
        try {
          dispose();
        } catch {
          /* 忽略 */
        }
      }
    });
  } catch {
    /* 忽略 */
  }

  ctx?.logger?.info?.(`${LOG_PREFIX} ready (file=${file}, gate=${config.gate.enabled ? 'on' : 'off'})`);
  return { file, config };
}
