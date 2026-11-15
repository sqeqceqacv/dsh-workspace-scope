# 变更记录

本文件从 0.4.0 起开始记录；更早的历史见 git log。本项目暂不发布 npm 包，版本号对应仓库快照。

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
