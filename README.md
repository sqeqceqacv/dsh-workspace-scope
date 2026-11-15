# dsh-workspace-scope（工作区扩展）

> 面向 DeepSeek Harness（DSH）的本地工作区策略与结构化记忆插件。

> **本项目为非官方社区插件**，由社区开发者独立维护，与 DeepSeek 及其关联公司
> 无任何隶属、合作或背书关系。DeepSeek Harness（DSH）及其相关商标归其权利人所有；
> 本项目仅在描述兼容性时使用这些名称。使用本插件产生的数据与后果由使用者自行承担。

**状态：v0.4.0 源码版，核心链路已实测通过（2026-11-08）。**

当前不是 npm 发布包；desktop profile 只注册 `workspace-scope` 一个插件，仓库用于源码审查与本地安装。

- `packages/workspace-scope`：工作区策略、工具/规则开关、设置页、侧栏入口 + 内嵌记忆 Host/Client；
- `packages/dsh-meow-scope`：按工作区扩展的结构化记忆库（`meow-memory` 的 fork）源码/构建源，不再作为独立 bundle 注册。

## 安装（源码版）

要求：

- DeepSeek Harness Desktop 已安装；
- Node.js >= 22.5；
- 可写 `~/.dsh/profiles/desktop/`。

1. 克隆仓库：

   ```powershell
   git clone https://github.com/sqeqceqacv/dsh-workspace-scope.git C:\path\dsh-workspace-scope
   ```

2. 备份当前 profile：

   ```powershell
   Copy-Item "$env:USERPROFILE\.dsh\profiles\desktop\package.json" `
     "$env:USERPROFILE\.dsh\profiles\desktop\package.json.bak"
   ```

3. 编辑 `~/.dsh/profiles/desktop/package.json`：

   ```json
   {
     "dependencies": {
       "@local/dsh-workspace-scope": "link:C:/path/dsh-workspace-scope/packages/workspace-scope"
     },
     "dsh": {
       "profile": {
         "bundles": [
           "@local/dsh-workspace-scope"
         ]
       }
     }
   }
   ```

   保留文件里已有的其他依赖和 bundle，不要整段覆盖。

4. 在 profile 目录安装依赖：

   ```powershell
   Set-Location "$env:USERPROFILE\.dsh\profiles\desktop"
   pnpm install
   ```

5. 完全退出并重启 DSH。

6. 打开设置，确认出现：

   ```text
   工作区扩展
   ```

> v0.4.0 只提供源码安装，暂不发布 npm 包。npm 包名与发布流程会在后续版本单独处理。

## 已实现

### 工作区策略

- policy-first：未托管工作区工具层完全 no-op、回到全开；唯一例外是 Agent Teams 的团队提示默认不注入，避免污染上下文；
- 按工作区控制能力组、单工具 allow/deny、收藏组、MCP section；
- 所有组都可删除；删除后组内工具进入未分组，并可在“管理分组”中恢复；已删除组还可永久删除（不再出现在恢复列表）；
- Agent Teams 的 `team:policy` 与 `team:identity` 只在启用 Agent 组或具体团队工具时注入；未托管工作区默认不注入团队提示；pre-step 与 refreshContext 都会去除团队 context；
- 外部插件工具运行时自动发现，按名前缀生成 `runtime:<prefix>` 组，默认关闭；不硬编码第三方工具名；
- 从旧版升级后，原先静态的第三方组不会自动迁移；对应的 `runtime:<prefix>` 组默认关闭，需要在新 UI 中手动启用；
- 新工作区自动建默认 all-off policy，2 秒内弹出 4 步向导；
- 公开发行版只带一个全关的占位默认模板；自定义模板仍可在 UI 中创建；
- 设置页、预览、锚点导航、吸底保存；
- 删除策略时弹窗询问是否同时删除记忆库；默认保留，勾选后删除 memory.db、WAL/SHM 与备份；
- 记忆插件完整内嵌到 workspace-scope；profile 只注册 workspace-scope，不再单独注册 dsh-meow-scope；
- 跨工作区权限与工具过滤由 Host 侧强制执行。

### 全局 RULE

- 原独立 `dsh-global-rules` bundle 已迁入本插件，随「工作区扩展」一起启用；
- 规则文件仍是 `~/.dsh/global-rules.md`；
- `/rule`、`global_rule` 工具保留；
- 每个工作区的 `rules.global` 开关同时控制全局 RULE section 和 `global_rule` 工具；
- 工作区自己的规则继续由记忆库的 `rules` 层承担，不再单独做一套工作区 RULE。

### 维护默认值

- 低重要性 active 记忆超过 180 天未访问 → 自动归档；
- 每层 active 上限 1000 条，超出时优先归档低重要性、最久未访问的条目；
- 每 24 小时写维护时做一次 WAL checkpoint，每 7 天尝试 VACUUM；
- 备份保留最近 5 份（`memory.db.bak` + `.bak.1`…`.bak.4`）；
- `rules` / `soul` 不参与自动归档。

### 记忆

- 每个工作区独立数据库：

  ```text
  <workspace>/.dsh-scope/memory.db
  ```

  SQLite WAL 模式；只复制 `memory.db` 可能看不到数据，需连同 `memory.db-wal` 一起处理。

- 只有开启记忆的工作区才注册工具、注入和建库；
- 不再有 `user` 层和 persona；身份统一走工作区 **SOUL**；
- 主题门：
  - judge 判定不匹配或不确定的记忆进入 **quarantine**，不进入自动注入；
  - 主题为空时首次实际写入生成候选主题，并通过提示词让 AI 主动询问用户；
  - 用户回答后由 `memory_theme` 写入主题或选择不设置；
  - 确认主题后对既有记忆重评估；
- 记忆项目管理由系统内部处理，不再暴露给用户；
- 记忆库的 `rules` 是**工作区级**：project 标记「全局」只表示本工作区跨项目通用，**不跨工作区**；跨工作区规则由 RULE 层 `/rule` 管理；
- 首轮快照注入、每 N 轮关键词命中（默认 N=2）、压缩后重注入、反思、dream；
- `memory_remember` / `memory_update` 等待主题判定后返回真实结果；
- 完整 id 写入结果；`memory_read` 支持读取暂存区条目。

### UI

- 设置页名称：**工作区扩展**；
- 记忆设置已合并进工作区设置，不再有独立「喵记忆」设置页；
- 工作区记忆管理：
  - 侧栏底部入口，打开仅包含暂存区与工作区选择的独立页面；
  - 设置页内的暂存区默认折叠；
  - 暂存区支持恢复主库、丢弃、刷新；
- judge / 反思模型从 Host 模型目录读取，使用下拉选择；
- 工作区 SOUL 编辑器。

## 仓库结构

```text
packages/
  workspace-scope/     # 工作区策略 + 设置页 + 侧栏 UI + 内嵌记忆插件
  dsh-meow-scope/      # 记忆实现源码/构建源；不再作为独立 bundle 注册
docs/                  # UI API 与文档索引
scripts/               # 测试、构建同步与校验脚本
.github/workflows/     # GitHub Actions（策略/规则/记忆测试）
.gitattributes         # 行尾与二进制文件规则
```

## 内嵌记忆同步

desktop profile 只 link `workspace-scope`，memory Host/Client 是它的内部编译产物。

修改 `packages/dsh-meow-scope` 源码后，必须重新同步：

```powershell
node scripts/embed-meow-scope.mjs
```

脚本会：

1. 构建 `dsh-meow-scope`；
2. 刷新 `workspace-scope/lib/memory/{index.js,prompts}`；
3. 替换 `workspace-scope/client.js` 里唯一的 memory Client 模块；
4. 校验 Host/Client 语法和模块数量。

同步后需要**完全重启 DSH**。

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
- 记忆 fork：scope / db / judge / llm-judge 4 组测试；
- 客户端页面与真实交互仍需人工验收；
- CI 使用 Node 22，运行上述测试。

## 已知限制

- 依赖 DSH 内部 Host/Client API；DSH 升级后可能需要适配；
- 还没有会话级“选择本次启用哪些工具/插件/记忆”的完整 UI；
- 新工作区保存时尚未立即建记忆库，仍是首次实际使用时懒创建；
- judge 默认路由使用 agent 默认模型，不一定等于当前对话模型；
- Ollama 等 provider 的模型列表尚未逐一实测；
- 侧栏底部入口保留；强制竖排布局属于本地补丁，不随公开发行；
- 本地 HTTP API 依赖 DSH 的同源校验，不额外提供 token；请勿将 DSH 暴露到局域网；
- 工具开关在每次 system-prompt 装配时重新计算；当前回合已加载的工具集可能要到下一轮消息才刷新，无需新开会话（推荐通过重启DSH刷新，此方式具有较强确定性）；
- 内嵌 memory Host/Client 是编译产物，改了 `dsh-meow-scope` 源码后必须运行 `scripts/embed-meow-scope.mjs`；
- CI 覆盖策略、全局 RULE 与记忆单元测试，不覆盖真实 DSH 页面交互；
- v0.4.0 暂不提供 npm 包。

## 数据流向

- **工作区策略**：保存在 `<workspace>/.dsh-scope/policy.json`，仅本工作区读取；
- **记忆库**：保存在 `<workspace>/.dsh-scope/memory.db`（SQLite + WAL，未加密，含个人记忆正文），默认不进入 git；
- **记忆工具**：读写本地 SQLite，不经过插件自有服务器；
- **主题 judge / dream**：启用后，相关记忆片段、工作区名称和整理请求会通过 DSH 当前配置的模型 provider 发送给该 provider；是否出网取决于 provider，插件本身不内置外部服务；
- **会话日志**：位于 `$DSH_HOME/sessions/`；dream 整理时会遍历本工作区对应的会话日志（用于恢复上次模型路由与整理上下文），不依赖用户询问；模型在对话中读取会话原文时，受系统提示中的会话访问与凭据约束；
- **HTTP API**：仅提供本地 Host API，依赖 DSH 的同源校验，不额外提供 token；不要将 DSH 暴露到局域网；
- **遥测**：插件不内置遥测、不主动上报使用数据；第三方依赖见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。

## 文档

- [`docs/ui-api.md`](docs/ui-api.md) — UI/Host API v1；
- [`docs/README.md`](docs/README.md) — 文档索引与状态。

## 上游与许可

`packages/dsh-meow-scope` 是 [`Phant0Meow/dsh-meow-memory`](https://github.com/Phant0Meow/dsh-meow-memory) 的工作区分支 fork，遵循其 MIT 许可证，详见 [`packages/dsh-meow-scope/LICENSE`](packages/dsh-meow-scope/LICENSE)。

本仓库采用 MIT License，详见根目录 [`LICENSE`](LICENSE)；上游归属与 fork 说明见 [`NOTICE`](NOTICE)。第三方依赖与许可文本见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。
