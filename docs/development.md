# 开发与构建

面向想改代码、重新构建产物或跑测试的人。普通安装请看根目录 [README](../README.md)。

## 仓库结构

```text
packages/
  workspace-scope/     # 工作区策略 + 设置页 + 侧栏 UI + 内嵌记忆插件
    lib/               # 手写宿主代码（不是构建产物）
    client.js          # 设置页/侧栏 bundle：手写部分 + 内嵌的 memory Client
    locale/ icon.svg   # 界面资源
  dsh-meow-scope/      # 记忆实现：TS 源码 + 构建产物
    src/               # 真源（含 zh/en prompts）
    lib/               # 由 build.mjs 生成，勿手改
    THIRD_PARTY_LICENSES/  # 由 build.mjs 从 node_modules 复制
docs/
  ui-api.md            # UI / Host HTTP API v1
  images/              # README 用的截图
  diagrams/            # Excalidraw 图源（.excalidraw，可直接编辑）
scripts/               # 测试、构建同步与校验脚本
.github/workflows/     # CI
```

## 构建链

desktop profile 只 link `workspace-scope`，记忆插件的 Host/Client 是它的**内部编译产物**——所以改 `dsh-meow-scope` 后必须重新嵌入：

```powershell
node scripts/embed-meow-scope.mjs
```

脚本会：

1. 在 `packages/dsh-meow-scope` 跑 `build.mjs`（esbuild 打包 + 复制 prompts + 复制第三方 LICENSE）；
2. 刷新 `workspace-scope/lib/memory/{index.js,prompts}`；
3. 替换 `workspace-scope/client.js` 里唯一的 memory Client 模块；
4. 校验 Host/Client 语法与模块数量。

同步后需要**完全重启 DSH**。

### 关于 `legalComments`

`build.mjs` 里保持 `legalComments: 'none'`：被内嵌的上游 `lib/*.js` 里没有 `/*! */`、`@license`、`@preserve` 形式的注释，esbuild 没有可搬运的内容。第三方许可义务改由 `THIRD_PARTY_LICENSES/`（构建时从 `node_modules` 复制，缺失即报错）与根目录 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) 履行。

### 关于 prompt 文案

`packages/dsh-meow-scope/src/prompts/<lang>/` 是**数据文件**，改完重新构建即可生效，不需要改代码。`zh/` 是 key 集合的真源；`labels.md` / `tools.md` 的 key 必须与 `zh/` 完全一致，否则 `keyedValue()` 会抛错。

## 测试

```powershell
node scripts/test-policy.mjs
node --check packages/workspace-scope/client.js
node packages/workspace-scope/test/global-rules-smoke.mjs

node scripts/embed-meow-scope.mjs

cd packages/dsh-meow-scope
npm test
```

当前口径：

- 工作区策略：31 项检查；
- 全局 RULE：20 项 smoke 检查；
- 记忆 fork：scope / db / judge / llm-judge 4 组；
- 客户端页面与真实交互仍需人工验收；
- CI 使用 Node 22，跑上述测试（不含真实页面交互）。

## 发布 npm 包

仓库里有两套包名：`packages/workspace-scope` 是私有开发包 `@local/dsh-workspace-scope`，发到 npm 的是装配出来的 `@sqeqceqacv/dsh-workspace-scope`。装配**不要手工拼**，用脚本：

```powershell
node scripts/build-npm-package.mjs                     # 装配到 dist-npm/package 并打 tgz
node scripts/build-npm-package.mjs --ref <上一版>.tgz   # 顺带与上一版逐文件比对（回归用）
node scripts/build-npm-package.mjs --no-pack           # 只装配目录，不打包
```

脚本自动处理发行版的固定差异：模块 id / bundle 名称改用发行包名；`package.json` 换成 npm 元数据（去 `private` / `scripts`，补 `publishConfig` / `repository` / `keywords`）；`README.md`、`NOTICE`、`THIRD_PARTY_NOTICES.md` 取自 `packaging/npm/` 的模板（`{{version}}` 自动替换）；`LICENSE-UPSTREAM` 取 `packages/dsh-meow-scope/LICENSE`；第三方许可取 `packages/dsh-meow-scope/THIRD_PARTY_LICENSES/`。装配完自检：必需文件齐全、无 `@local/` 残留、无未替换占位符、无 `private` / `scripts`、无 `src/` 或 `node_modules/`。

发布步骤：

1. 改 `packages/workspace-scope/package.json` 的 `version`（npm 上已发布的版本永久不可覆盖，必须升号）；
2. `node scripts/build-npm-package.mjs`
3. `cd dist-npm\package` 然后 `npm publish --registry=https://registry.npmjs.org --access public`
4. 打 tag 并推送：`git tag -a v<version> -m "v<version>"; git push origin v<version>`
5. 把公共文件集同步到发布仓 `dsh-workspace-scope` 并推送（这步目前仍是手工复制，未脚本化）。

`packaging/npm/` 下的三个文档是**发行版专用**，内容与仓库根的同名文件不同（面向装包的人、路径按包内布局写）。改文案时两边都要改，否则两边会漂移。

## 文档与图

- `docs/images/*.png`：README 用的截图。截图里**不要出现真实工作区路径、项目名或个人记忆正文**；如无法避免，先打码再入库。
- `docs/diagrams/*.excalidraw`：图源，可直接用 [Excalidraw](https://excalidraw.com) 打开编辑；改完重新导出到 `docs/images/` 同名 PNG。
