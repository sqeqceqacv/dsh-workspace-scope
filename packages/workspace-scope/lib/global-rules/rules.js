/**
 * dsh-global-rules — 纯逻辑层（不依赖 DSH / Cordis，可离线单测）
 *
 * 规则文件格式（Markdown 条目式）：
 *   # 全局规则
 *
 *   ## 标题
 *   正文（一到两句，可多行）
 */

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const DEFAULT_FILENAME = 'global-rules.md';
export const DEFAULT_MAX_CHARS = 6000;
export const DEFAULT_MAX_ENTRIES = 20;
export const MAX_TITLE_CHARS = 40;
export const MAX_BODY_CHARS = 500;

const HEADING = /^##\s+(.+?)\s*$/;

/** 把文件文本解析成条目数组。容错：忽略第一个 ## 之前的内容、忽略空标题。 */
export function parseRules(text) {
  const entries = [];
  let current = null;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    const m = HEADING.exec(line);
    if (m) {
      if (current !== null) entries.push(current);
      current = { title: m[1].trim(), lines: [] };
      continue;
    }
    if (current !== null) current.lines.push(line);
  }
  if (current !== null) entries.push(current);
  return entries
    .map((e) => ({ title: e.title, body: e.lines.join('\n').trim() }))
    .filter((e) => e.title.length > 0);
}

/** 条目数组 → 文件文本。 */
export function renderRules(entries) {
  const parts = ['# 全局规则', ''];
  for (const e of entries) {
    parts.push(`## ${e.title}`, '');
    if (e.body) parts.push(e.body, '');
  }
  return `${parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

/** 条目数组 → 注入 system prompt 的文本块；无条目时返回空串（不注入）。 */
export function renderBlock(entries, options = {}) {
  const maxChars = normalizeLimit(options.maxChars, DEFAULT_MAX_CHARS);
  const maxEntries = normalizeLimit(options.maxEntries, DEFAULT_MAX_ENTRIES);
  if (!Array.isArray(entries) || entries.length === 0) return '';

  const head = [
    '【跨工作区通用规则】',
    '以下规则适用于所有工作区，是默认值；若与当前工作区自己的记忆/规则冲突，一律以工作区规则为准。',
    `共 ${entries.length} 条。需要完整清单可调用 global_rule 工具；用户可用 /rule 命令管理。`,
  ].join('\n');

  let out = head;
  let included = 0;
  for (const entry of entries.slice(0, maxEntries)) {
    const segment = `\n\n## ${entry.title}\n${entry.body}`;
    if (out.length + segment.length > maxChars) break;
    out += segment;
    included += 1;
  }
  if (included === 0) return '';
  if (included < entries.length) {
    out += `\n\n…（受注入上限限制，另有 ${entries.length - included} 条未注入；如需完整清单请调用 global_rule）`;
  }
  return out;
}

/** 校验一条待写入的规则。ignoreTitle 用于 update（允许沿用原标题）。 */
export function validateEntry(entry, entries, options = {}) {
  const maxEntries = normalizeLimit(options.maxEntries, DEFAULT_MAX_ENTRIES);
  const maxChars = normalizeLimit(options.maxChars, DEFAULT_MAX_CHARS);
  const ignoreTitle = options.ignoreTitle ?? null;

  const title = typeof entry?.title === 'string' ? entry.title.trim() : '';
  const body = typeof entry?.body === 'string' ? entry.body.trim() : '';

  if (!title) return { ok: false, error: '标题不能为空' };
  if (/[\r\n]/.test(title)) return { ok: false, error: '标题必须是单行' };
  if (title.startsWith('#')) return { ok: false, error: '标题不要以 # 开头' };
  if (title.length > MAX_TITLE_CHARS) return { ok: false, error: `标题不能超过 ${MAX_TITLE_CHARS} 字（当前 ${title.length}）` };
  if (!body) return { ok: false, error: '正文不能为空' };
  if (body.length > MAX_BODY_CHARS) return { ok: false, error: `正文不能超过 ${MAX_BODY_CHARS} 字（当前 ${body.length}）` };
  if (/^\s*#/m.test(body)) return { ok: false, error: '正文里不要再出现标题行（# 或 ##）' };
  if (entries.some((e) => e.title === title && e.title !== ignoreTitle)) {
    return { ok: false, error: `已存在同名条目「${title}」，改用 update` };
  }

  const next = entries.filter((e) => e.title !== ignoreTitle).concat([{ title, body }]);
  if (next.length > maxEntries) return { ok: false, error: `条目数不能超过 ${maxEntries}（当前会到 ${next.length}）` };
  const size = renderRules(next).length;
  if (size > maxChars) return { ok: false, error: `规则文件总长度不能超过 ${maxChars} 字（当前会到 ${size}）` };

  return { ok: true, entry: { title, body } };
}

/** 读文件；ENOENT 视为空清单。永不抛异常。 */
export function readRulesFile(file) {
  try {
    const st = statSync(file);
    const text = readFileSync(file, 'utf8');
    return { ok: true, text, entries: parseRules(text), mtimeMs: st.mtimeMs };
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { ok: true, text: '', entries: [], mtimeMs: 0, missing: true };
    }
    return { ok: false, error: error instanceof Error ? error.message : String(error), text: '', entries: [], mtimeMs: 0 };
  }
}

/** 原子写：先写临时文件再 rename；覆盖前留一份 .bak。 */
export function writeRulesFile(file, text) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(tmp, text, 'utf8');
  try {
    if (existsSync(file)) writeFileSync(`${file}.bak`, readFileSync(file, 'utf8'), 'utf8');
  } catch {
    /* 备份失败不影响主写入 */
  }
  renameSync(tmp, file);
}

/** 解析 `标题 | 正文` 形式；没有分隔符时正文为空（交由校验报错）。 */
export function splitEntry(raw) {
  const text = typeof raw === 'string' ? raw : '';
  const idx = text.indexOf('|');
  if (idx < 0) return { title: text.trim(), body: '' };
  return { title: text.slice(0, idx).trim(), body: text.slice(idx + 1).trim() };
}

function normalizeLimit(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}
