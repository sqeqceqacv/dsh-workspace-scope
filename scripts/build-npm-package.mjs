#!/usr/bin/env node
/**
 * build-npm-package.mjs —— 从源码仓库装配可直接发布的 npm 包
 *
 * 背景：仓库里的 packages/workspace-scope 是私有开发包（@local/dsh-workspace-scope），
 * 而发布到 npm 的是一个独立装配出来的发行包（@sqeqceqacv/dsh-workspace-scope）。
 * 两者有 6 处「发布必需的设计差异」，历史上靠手工拼装，容易漏改、容易漂移。
 * 本脚本把这套装配固化下来，并在装配完做自检。
 *
 * 用法（在仓库根目录执行）：
 *   node scripts/build-npm-package.mjs                 # 装配到 dist-npm/package 并打 tgz
 *   node scripts/build-npm-package.mjs --no-pack       # 只装配目录，不打包
 *   node scripts/build-npm-package.mjs --out <dir>     # 指定输出目录（默认 dist-npm）
 *   node scripts/build-npm-package.mjs --ref <x.tgz>   # 装配后与参考 tarball 逐文件比对
 *
 * 退出码：0 成功；1 装配或自检失败。任何自检不通过都不会留下可发布的假象——
 * 失败时输出目录会被标记为 FAILED-<原因>.txt。
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'packages', 'workspace-scope') // 宿主插件（私有开发包）
const MEOW = path.join(ROOT, 'packages', 'dsh-meow-scope') // 记忆实现（内嵌进 lib/memory）
const ASSETS = path.join(ROOT, 'packaging', 'npm') // 发行包专用文件（README/NOTICE/…）

// 发行包里必须存在的文件（发布/法务关键项，缺一个就失败）
const REQUIRED = [
  'package.json',
  'README.md',
  'LICENSE',
  'LICENSE-UPSTREAM',
  'NOTICE',
  'THIRD_PARTY_NOTICES.md',
  'THIRD_PARTY_LICENSES/cosmokit.LICENSE.txt',
  'THIRD_PARTY_LICENSES/dsh-llm.LICENSE.txt',
  'THIRD_PARTY_LICENSES/dsh-timeout.LICENSE.txt',
  'THIRD_PARTY_LICENSES/schemastery.LICENSE.txt',
  'client.js',
  'cordis.patch.yml',
  'icon.svg',
  'locale/en.json',
  'locale/zh.json',
  'lib/index.js',
  'lib/memory/index.js',
]

// 只读文本，用于扫描残留（二进制/大文件跳过）
const TEXT_EXT = new Set(['.js', '.mjs', '.json', '.yml', '.yaml', '.md', '.txt', '.svg'])

const args = process.argv.slice(2)
const opt = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const noPack = args.includes('--no-pack')
const outDir = path.resolve(ROOT, opt('--out') ?? 'dist-npm')
const refTgz = opt('--ref')

const fail = (msg) => {
  console.error(`\n✗ 失败：${msg}`)
  mkdirSync(outDir, { recursive: true })
  writeFileSync(path.join(outDir, `FAILED-${Date.now()}.txt`), `build-npm-package 失败：${msg}\n`, 'utf8')
  process.exit(1)
}

const sha1 = (file) => createHash('sha1').update(readFileSync(file)).digest('hex')
const isText = (file) => TEXT_EXT.has(path.extname(file).toLowerCase())

/** 沿目录树列出全部文件（相对路径，posix 分隔符） */
function walk(dir, base = dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full, base))
    else out.push(path.relative(base, full).split(path.sep).join('/'))
  }
  return out.sort()
}

/** 字节级替换：以 latin1 往返，保证非 ASCII 字节不被改写 */
function replaceBytes(srcFile, dstFile, from, to) {
  const buf = readFileSync(srcFile)
  const text = buf.toString('latin1')
  if (!text.includes(from)) fail(`${path.relative(ROOT, srcFile)} 中找不到 "${from}"，无法做发行版替换`)
  writeFileSync(dstFile, Buffer.from(text.split(from).join(to), 'latin1'))
}

function put(rel, content) {
  const target = path.join(pkgDir, rel)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, content)
}

console.log('装配 npm 发行包')
console.log(`  仓库根 : ${ROOT}`)
console.log(`  输出   : ${outDir}`)

rmSync(outDir, { recursive: true, force: true })
const pkgDir = path.join(outDir, 'package')
mkdirSync(pkgDir, { recursive: true })

// ── 1. 代码与运行时资源：逐字节复制 ─────────────────────────────────────────
const copied = []
for (const rel of ['lib', 'client.js', 'cordis.patch.yml', 'icon.svg', 'locale']) {
  const from = path.join(SRC, rel)
  if (!existsSync(from)) fail(`源码缺失：packages/workspace-scope/${rel}`)
  cpSync(from, path.join(pkgDir, rel), { recursive: true })
}

// ── 2. 法务文件：根 LICENSE、上游许可原文、第三方许可全文 ────────────────────
cpSync(path.join(ROOT, 'LICENSE'), path.join(pkgDir, 'LICENSE'))
cpSync(path.join(MEOW, 'LICENSE'), path.join(pkgDir, 'LICENSE-UPSTREAM'))
cpSync(path.join(MEOW, 'THIRD_PARTY_LICENSES'), path.join(pkgDir, 'THIRD_PARTY_LICENSES'), {
  recursive: true,
})

// ── 3. 发行版专用文件（模板）：版本号占位替换 ───────────────────────────────
const srcPkg = JSON.parse(readFileSync(path.join(SRC, 'package.json'), 'utf8'))
const version = srcPkg.version
if (!/^\d+\.\d+\.\d+/.test(version ?? '')) fail(`packages/workspace-scope/package.json 的 version 非法：${version}`)

const templateText = (name) => readFileSync(path.join(ASSETS, name), 'utf8').split('{{version}}').join(version)

put('README.md', templateText('README.md'))
put('NOTICE', templateText('NOTICE'))
put('THIRD_PARTY_NOTICES.md', templateText('THIRD_PARTY_NOTICES.md'))
const pubPkg = JSON.parse(templateText('package.template.json'))
if (pubPkg.version !== version) fail(`模板版本 ${pubPkg.version} 与仓库版本 ${version} 不一致`)
put('package.json', templateText('package.template.json'))

// ── 4. 差异① ②：模块 id / bundle 名称改为发行包名 ──────────────────────────
const pubName = pubPkg.name
replaceBytes(path.join(SRC, 'client.js'), path.join(pkgDir, 'client.js'), srcPkg.name, pubName)
replaceBytes(path.join(SRC, 'cordis.patch.yml'), path.join(pkgDir, 'cordis.patch.yml'), srcPkg.name, pubName)

// ── 5. 自检 ────────────────────────────────────────────────────────────────
const problems = []
for (const rel of REQUIRED) {
  if (!existsSync(path.join(pkgDir, rel))) problems.push(`缺少必需文件：${rel}`)
}
for (const rel of walk(pkgDir)) {
  if (!isText(path.join(pkgDir, rel))) continue
  const text = readFileSync(path.join(pkgDir, rel), 'utf8')
  if (text.includes('@local/')) problems.push(`残留私有包名 @local/：${rel}`)
  if (text.includes('{{version}}')) problems.push(`残留未替换的占位符：${rel}`)
}
if (pubPkg.private) problems.push('发行包 package.json 含 private:true（无法发布）')
if (pubPkg.scripts && Object.keys(pubPkg.scripts).length) problems.push('发行包 package.json 仍带 scripts（包内无测试文件）')
for (const rel of walk(pkgDir)) {
  if (/(^|\/)(research|local-ui|node_modules|src)\//.test(rel)) problems.push(`不该出现的目录：${rel}`)
}
const files = walk(pkgDir)
if (problems.length) {
  console.error('\n自检未通过：')
  for (const p of problems) console.error('  - ' + p)
  fail(problems.join('; '))
}

console.log(`\n✓ 装配完成：${files.length} 个文件，版本 ${version}，包名 ${pubName}`)

// ── 6. 打包（npm pack 会按 package.json 的 files 白名单再过滤一次） ─────────
let tgz
if (!noPack) {
  const r = spawnSync('npm', ['pack', '--pack-destination', outDir], {
    cwd: pkgDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (r.status !== 0) fail(`npm pack 退出码 ${r.status}`)
  tgz = path.join(outDir, `sqeqceqacv-dsh-workspace-scope-${version}.tgz`)
  if (!existsSync(tgz)) {
    const cand = readdirSync(outDir).filter((n) => n.endsWith('.tgz'))
    if (cand.length !== 1) fail(`未找到产出的 tgz（候选：${cand.join(', ')}）`)
    tgz = path.join(outDir, cand[0])
  }
  const size = statSync(tgz).size
  console.log(`✓ 打包完成：${path.basename(tgz)}  ${size.toLocaleString()} B  sha1=${sha1(tgz)}`)
}

// ── 7. 可选：与参考 tarball 逐文件比对（上线前的回归验证） ──────────────────
if (refTgz) {
  if (!existsSync(refTgz)) fail(`参考 tarball 不存在：${refTgz}`)
  const tmp = mkdtempSync(path.join(tmpdir(), 'npmref-'))
  const r = spawnSync('tar', ['-xzf', refTgz, '-C', tmp], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (r.status !== 0) fail(`解包参考 tarball 失败（tar 退出码 ${r.status}）`)
  const refDir = path.join(tmp, 'package')
  const refFiles = walk(refDir)
  const diffs = []
  for (const rel of refFiles) {
    if (!files.includes(rel)) { diffs.push(`仅参考包有：${rel}`); continue }
    if (sha1(path.join(refDir, rel)) !== sha1(path.join(pkgDir, rel))) diffs.push(`内容不同：${rel}`)
  }
  for (const rel of files) if (!refFiles.includes(rel)) diffs.push(`仅本次装配有：${rel}`)
  rmSync(tmp, { recursive: true, force: true })
  if (diffs.length) {
    console.error(`\n参考包比对有 ${diffs.length} 处差异：`)
    for (const d of diffs.slice(0, 30)) console.error('  - ' + d)
    fail('与参考 tarball 不一致')
  }
  console.log(`✓ 与参考 tarball 逐文件一致（${refFiles.length}/${refFiles.length}）`)
}

console.log('\n下一步：')
console.log('  npm publish --registry=https://registry.npmjs.org --access public   # 在 dist-npm/package 中执行')
console.log('  发布后：git tag -a v' + version + ' -m "v' + version + '" && git push origin v' + version)
