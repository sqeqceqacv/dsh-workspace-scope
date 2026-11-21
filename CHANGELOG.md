# 变更记录

本文件从 0.4.0 起开始记录；更早的历史见 git log。版本号对应仓库快照，0.4.1 起同步发布到 npm。

## 0.4.1 — 2026-11-21

首个 npm 发布版本。

### 变更

- 发布到 npm：`@sqeqceqacv/dsh-workspace-scope`（scoped 公开包，`publishConfig.access = public`）。
- 包内自带 `README.md`、`LICENSE-UPSTREAM`（上游 Phant0Meow 的 MIT 原文）与 `THIRD_PARTY_LICENSES/`。
- 通知文件改用包内相对路径（`lib/memory/…`、`THIRD_PARTY_LICENSES/…`），修正原先指向不存在文件的路径。
- 包元数据补齐 `author` / `repository` / `homepage` / `bugs` / `keywords`，并移除无法运行的 `test:global-rules` 脚本。

### 修复

- 会话日志引导统一为「需用户明确同意」：`memory_project` 尾部提示与 `memory_search` 两处 hint 不再主动给出 `~/.dsh/sessions` 路径。
- judge 判定示例去掉内部技术栈（「DSH 开发 / pwsh ACL 报错」→「后端服务开发 / 构建脚本报错」）。
- `/rule ai on`：删除不可达的「已临时解锁」假分支（真正的解锁在命令 handler 中，会调用 `arm()`）。
- Node 版本声明统一为 `>=22.15.0`（内嵌记忆使用 `zlib.zstdDecompressSync`）。
- `cordis.patch.yml` 与 `lib/index.js` 去掉内部里程碑措辞（`P0 Host probe` / `P1 Host core`）。

## 0.4.0 — 2026-11-15

首个公开源码快照。

### 新增

- 工作区级工具裁剪：能力组 / 单工具 allow-deny / 收藏组叠加；未托管工作区完全 no-op。
- 组管理：列出、删除、恢复与**永久删除**能力组；删除后组内工具进入未分组。
- 运行时工具发现：外部插件工具按名字前缀生成 `runtime:<prefix>` 组，默认关闭，不硬编码第三方工具名。
- 全局 RULE 并入本插件（原独立的 `dsh-global-rules` bundle），规则文件仍是 `~/.dsh/global-rules.md`。
- Agent Teams 感知：`team:policy` / `team:identity` 只在启用 Agent 组或团队工具时注入；未托管工作区默认不注入。
- 内嵌记忆库：每工作区一个 SQLite，含主题门（judge）、quarantine 暂存区、SOUL、dream 整理。
- 第三方许可合规：随产物附 4 份 MIT 许可原文（`THIRD_PARTY_LICENSES/`），重写 NOTICE 三段式归属。

### 变更

- 工具可见性改由**每次装配时重算**（`system-prompt/assemble` + 装配后过滤），不再安装 agent 级粘性 deny 列表，避免新启用工具在旧会话里显示为未知。
- SOUL 作为数据注入：加边界标记、剥控制字符、限制长度；策略段不再拼接工作区绝对路径。
- 移除首轮语言引导与开发期诊断写入；`promptLang` 仅支持 `zh` / `en`，其他值静默回退 `zh`。
- 移除 `user` 记忆层与 persona，身份统一走工作区 SOUL；移除 `pt-br` 语言包。
- `archived` 语义明确为「归档（软删除，可恢复）」，不再是「删除」。
- domain=tooling 的描述改为中性的「不参与内容主题匹配」，去掉 bypass 类措辞。

### 修复

- 工具定义过滤：宿主在 waterfall 之后才追加 `tools`，改为在装配结果上再过滤一次。
- 团队上下文：pre-step 与 `refreshContext` 两条路径都会剥离，避免仅装配层过滤被还原。
- 区分「未知工具」与「被策略禁用的工具」，报错文案分开。
- 装配与守卫失败一律 fail-open，并写日志，不因单次异常改变工具集。
- 测试夹具不再使用作者本机路径。

### 文档

- README 重写：截图、架构图、快速开始、数据与隐私、FAQ、术语表；开发者内容移入 `docs/development.md`。
