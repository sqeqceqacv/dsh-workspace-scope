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

## 文档与图

- `docs/images/*.png`：README 用的截图。截图里**不要出现真实工作区路径、项目名或个人记忆正文**；如无法避免，先打码再入库。
- `docs/diagrams/*.excalidraw`：图源，可直接用 [Excalidraw](https://excalidraw.com) 打开编辑；改完重新导出到 `docs/images/` 同名 PNG。
