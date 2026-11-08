import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import {
  parseRules,
  renderRules,
  renderBlock,
  validateEntry,
  splitEntry,
  readRulesFile,
  writeRulesFile,
} from '../lib/global-rules/rules.js';
import { apply } from '../lib/global-rules/index.js';

const dir = mkdtempSync(join(tmpdir(), 'gr-smoke-'));
const file = join(dir, 'rules.md');
writeFileSync(file, '# 全局规则\n\n## 甲\n- 第一条正文\n\n## 乙\n- 第二条正文\n', 'utf8');

let pass = 0;
const t = async (name, fn) => {
  try {
    await fn();
    pass += 1;
    console.log(`  ok  ${name}`);
  } catch (error) {
    console.error(`  FAIL ${name}\n       ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
};

console.log('== rules.js 纯逻辑 ==');
await t('parseRules 解析两条', () => {
  const entries = parseRules(readFileSync(file, 'utf8'));
  assert.equal(entries.length, 2);
  assert.equal(entries[0].title, '甲');
  assert.equal(entries[1].body, '- 第二条正文');
});
await t('parseRules 容忍 CRLF 与首部说明', () => {
  const entries = parseRules('# 说明\r\n\r\n## 标题 \r\n正文\r\n');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].title, '标题');
  assert.equal(entries[0].body, '正文');
});
await t('renderRules 往返一致', () => {
  const entries = [{ title: 'A', body: 'x' }, { title: 'B', body: 'y' }];
  assert.deepEqual(parseRules(renderRules(entries)), entries);
});
await t('renderBlock 空清单返回空串', () => {
  assert.equal(renderBlock([]), '');
});
await t('renderBlock 含标题与清单说明', () => {
  const block = renderBlock([{ title: 'T', body: 'B' }]);
  assert.ok(block.includes('【跨工作区通用规则】'));
  assert.ok(block.includes('## T'));
  assert.ok(block.includes('B'));
});
await t('renderBlock 受 maxChars 截断并提示', () => {
  const block = renderBlock([{ title: 'T', body: 'B'.repeat(200) }], { maxChars: 150 });
  assert.equal(block, '');
});
await t('validateEntry 拒绝空标题/空正文/重复标题', () => {
  const entries = [{ title: '甲', body: 'x' }];
  assert.equal(validateEntry({ title: '', body: 'x' }, entries).ok, false);
  assert.equal(validateEntry({ title: '乙', body: '' }, entries).ok, false);
  assert.equal(validateEntry({ title: '甲', body: 'y' }, entries).ok, false);
  assert.equal(validateEntry({ title: '甲', body: 'y' }, entries, { ignoreTitle: '甲' }).ok, true);
});
await t('validateEntry 拒绝超长正文与超条数', () => {
  assert.equal(validateEntry({ title: 'x', body: 'B'.repeat(501) }, []).ok, false);
  const many = Array.from({ length: 20 }, (_, i) => ({ title: `t${i}`, body: 'b' }));
  assert.equal(validateEntry({ title: 'new', body: 'b' }, many, { maxEntries: 20 }).ok, false);
});
await t('splitEntry 以竖线切分', () => {
  assert.deepEqual(splitEntry('标题 | 正文内容'), { title: '标题', body: '正文内容' });
  assert.deepEqual(splitEntry('只有标题'), { title: '只有标题', body: '' });
});
await t('writeRulesFile 原子写并留 .bak', () => {
  writeRulesFile(file, renderRules([{ title: '新', body: '正文' }]));
  assert.equal(readFileSync(file, 'utf8').includes('## 新'), true);
  const bak = readFileSync(`${file}.bak`, 'utf8');
  assert.ok(bak.includes('## 甲'));
});

console.log('\n== index.js 插件行为 ==');
function makeCtx() {
  const captured = { section: null, command: null, tool: null, events: [], warnings: [] };
  const ctx = {
    logger: { info: () => {}, warn: (m) => captured.warnings.push(String(m)) },
    get: (name) => {
      if (name === 'systemPrompt') return { section: (def) => { captured.section = def; return () => {}; } };
      if (name === 'commands') return { register: (def) => { captured.command = def; return () => {}; } };
      if (name === 'tools') return { register: (def) => { captured.tool = def; return () => {}; } };
      return undefined;
    },
    on: (event, handler) => { captured.events.push({ event, handler }); },
  };
  return { ctx, captured };
}

writeFileSync(file, '# 全局规则\n\n## 甲\n- 第一条正文\n', 'utf8');
const { ctx, captured } = makeCtx();
apply(ctx, { file, gate: { enabled: false } });
const sid = 'session-test';
const exec = (id = sid) => ({ agent: { session: { header: { id } } } });

await t('section 注册为 global-rules 且 order=120', () => {
  assert.equal(captured.section.name, 'global-rules');
  assert.equal(captured.section.order, 120);
  assert.ok(captured.section.text().includes('## 甲'));
});
await t('工具已注册且 list 只读可用', async () => {
  assert.ok(captured.tool, '工具未注册');
  const r = await captured.tool.execute({ action: 'list' }, exec());
  assert.equal(r.ok, true);
  assert.equal(r.count, 1);
});
await t('命令已注册，list 返回条目', () => {
  const r = captured.command.handler({ rawInput: 'list', agent: { session: { header: { id: sid } } } });
  assert.equal(r.kind, 'success');
  assert.ok(r.text.includes('甲'));
});
await t('命令 add 直接写文件', () => {
  const r = captured.command.handler({ rawInput: 'add 乙 | 第二条正文', agent: { session: { header: { id: sid } } } });
  assert.equal(r.kind, 'success', r.text);
  assert.ok(readFileSync(file, 'utf8').includes('## 乙'));
});
await t('重复标题写入被拒', async () => {
  const r = await captured.tool.execute({ action: 'add', title: '乙', body: '重复' }, exec());
  assert.equal(r.ok, false);
});
await t('未启用门禁时工具可直接写', async () => {
  const r = await captured.tool.execute({ action: 'add', title: '丙', body: '第三条' }, exec());
  assert.equal(r.ok, true, r.text);
});

console.log('\n== 门禁开启 ==');
writeFileSync(file, '# 全局规则\n\n## 甲\n- 第一条正文\n', 'utf8');
const gated = makeCtx();
apply(gated.ctx, { file, gate: { enabled: true, ttlMinutes: 10 } });

await t('未解锁时写入被拒且文件不变', async () => {
  const before = readFileSync(file, 'utf8');
  const r = await gated.captured.tool.execute({ action: 'add', title: '丁', body: '不该写进去' }, exec());
  assert.equal(r.ok, false);
  assert.ok(r.text.includes('/rule ai on'));
  assert.equal(readFileSync(file, 'utf8'), before);
});
await t('/rule ai on 解锁后写入成功并立刻上锁', async () => {
  const on = gated.captured.command.handler({ rawInput: 'ai on', agent: { session: { header: { id: sid } } } });
  assert.equal(on.kind, 'success', on.text);
  const first = await gated.captured.tool.execute({ action: 'add', title: '戊', body: '一次写入' }, exec());
  assert.equal(first.ok, true, first.text);
  const second = await gated.captured.tool.execute({ action: 'add', title: '己', body: '第二次应被拒' }, exec());
  assert.equal(second.ok, false);
});
await t('turn/end 会清锁', async () => {
  const on = gated.captured.command.handler({ rawInput: 'ai on', agent: { session: { header: { id: sid } } } });
  assert.equal(on.kind, 'success', on.text);
  const turnEnd = gated.captured.events.find((e) => e.event === 'session/event');
  assert.ok(turnEnd, '未注册 session/event');
  turnEnd.handler({ id: sid }, { type: 'turn/end' });
  const r = await gated.captured.tool.execute({ action: 'add', title: '庚', body: '应被拒' }, exec());
  assert.equal(r.ok, false);
});
await t('命令写入不受门禁影响', () => {
  const r = gated.captured.command.handler({ rawInput: 'add 辛 | 用户直写', agent: { session: { header: { id: sid } } } });
  assert.equal(r.kind, 'success', r.text);
});

console.log(`\n通过 ${pass} 项`);
rmSync(dir, { recursive: true, force: true });

