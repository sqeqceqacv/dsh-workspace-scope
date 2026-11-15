import { build } from 'esbuild'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const lib = join(root, 'lib')
rmSync(lib, { recursive: true, force: true })
mkdirSync(lib, { recursive: true })

// The upstream sources use .js ESM specifiers while the extracted source files
// are .ts; resolve the sibling .ts file for the bundle.
const tsFromJs = {
  name: 'ts-from-js',
  setup(buildApi) {
    buildApi.onResolve({ filter: /\.js$/ }, (args) => {
      if (!args.importer || !args.path.startsWith('.')) return undefined
      const jsPath = resolve(dirname(args.importer), args.path)
      const tsPath = jsPath.slice(0, -3) + '.ts'
      if (!existsSync(jsPath) && existsSync(tsPath)) return { path: tsPath }
      return undefined
    })
  },
}

await build({
  entryPoints: [join(root, 'src/index.ts')],
  outfile: join(lib, 'index.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: false,
  legalComments: 'none',
  plugins: [tsFromJs],
})

await build({
  entryPoints: [join(root, 'src/client.ts')],
  outfile: join(lib, 'client.cjs'),
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  target: 'es2020',
  external: ['react'],
  legalComments: 'none',
  plugins: [tsFromJs],
})

const clientCode = readFileSync(join(lib, 'client.cjs'), 'utf8')
const clientWrapped = `window.__ModuleLoader__.load({\n  id: "dsh-meow-scope",\n  factory: (require) => {\n    var module = { exports: {} };\n    var exports = module.exports;\n${clientCode}\n    return module.exports;\n  }\n});\n`
writeFileSync(join(lib, 'client.js'), clientWrapped, 'utf8')
rmSync(join(lib, 'client.cjs'), { force: true })

function copyPrompts(src, dest) {
  mkdirSync(dest, { recursive: true })
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (entry.name.includes('.bak')) continue
    const from = join(src, entry.name)
    const to = join(dest, entry.name)
    if (entry.isDirectory()) copyPrompts(from, to)
    else writeFileSync(to, readFileSync(from))
  }
}
copyPrompts(join(root, 'src/prompts'), join(lib, 'prompts'))

// The bundle embeds the packages below verbatim. esbuild's `legalComments`
// cannot carry their notices: the upstream lib/*.js files contain no
// `/*! */`, `@license` or `@preserve` banners (verified), so the MIT copyright
// and permission texts have to ship as separate files next to the artifact.
const LICENSE_DIR = join(root, 'THIRD_PARTY_LICENSES')
rmSync(LICENSE_DIR, { recursive: true, force: true })
mkdirSync(LICENSE_DIR, { recursive: true })
const BUNDLED_PACKAGES = [
  ['@deepseek-ai/dsh-llm', 'dsh-llm.LICENSE.txt'],
  ['@deepseek-ai/cosmokit', 'cosmokit.LICENSE.txt'],
  ['@deepseek-ai/schemastery', 'schemastery.LICENSE.txt'],
  ['@deepseek-ai/dsh-timeout', 'dsh-timeout.LICENSE.txt'],
]
for (const [pkg, filename] of BUNDLED_PACKAGES) {
  const from = join(root, 'node_modules', ...pkg.split('/'), 'LICENSE')
  if (!existsSync(from)) throw new Error(`third-party license missing: ${pkg} (${from})`)
  writeFileSync(join(LICENSE_DIR, filename), readFileSync(from))
}

console.log('built', relative(root, join(lib, 'index.js')), relative(root, join(lib, 'client.js')))
console.log('copied third-party licenses to', relative(root, LICENSE_DIR))
