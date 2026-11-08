# dsh-meow-scope

[`dsh-workspace-scope`](../../README.md) 的工作区级记忆包，是 [`Phant0Meow/dsh-meow-memory`](https://github.com/Phant0Meow/dsh-meow-memory) 的 fork。

> 状态：本地开发版。原 `meow-memory` 的独立设置页和 `user` 层已被移除；记忆配置合并到「工作区扩展」设置页。

## 与原版的区别

- 数据库路径改为 `<workspace>/.dsh-scope/memory.db`，不再使用 `.dsh-meow`；
- 没有 `user` 层，没有 persona；身份统一由工作区 SOUL 承担；
- 工作区未托管，或未开启记忆时，完全 no-op；
- 主题门 + theme judge + quarantine：
  - 只注入主题匹配的主库记忆；
  - 不匹配或无法判定的记忆进入暂存区；
  - 主题为空时，首次实际写入生成候选主题，并由 AI 在下一轮主动询问用户（不再弹 UI）；
- 主题确认后重评估既有记忆；
- `memory_remember` / `memory_update` 会等待分类结果，返回真实的主库/暂存区状态；
- `memory_read` 可以用完整 id 读取暂存区条目；
- 记忆的 `project` 字段仍保留给系统内部使用，但不再作为用户配置项展示；
- 设置入口从原「喵记忆」页迁移到「工作区扩展 → 规则、SOUL 与记忆」。

原版已有的首轮注入、关键词命中（默认每 2 个真实用户轮触发一次）、压缩重注入、反思、dream、项目全景、检索留痕等能力保留。

## 数据布局

```text
<workspace>/
  .dsh-scope/
    policy.json       # 工作区策略（由 workspace-scope 维护）
    memory.db         # SQLite 主库
    memory.db-wal     # WAL 数据；查看数据库时需要保留
    memory.db-shm
```

- 数据库为 SQLite WAL 模式；
- 主库文件可能很小，因为新数据在 `memory.db-wal`；
- 旧的 `~/.dsh-meow/memory.db` 或 `<workspace>/.dsh-meow` **不会被读取、迁移或删除**。

## 记忆层级

- `soul` — 工作区 SOUL，用户可编辑，是否允许 AI 写入由工作区开关控制；
- `rules` — 工作区级设计原则/准则，不参与主题门；project 标记「全局」只表示本工作区跨项目通用，不跨工作区；
- `project` — 项目信息，带 `subcategory`；
- `fact` / `lesson` / `topic` — 事实、教训、进行中的话题；
- 主题不匹配的 `project` / `fact` / `lesson` / `topic` 会进入 quarantine。

`memory_project`、`memory_find_similar`、`memory_search`、`memory_read`、`memory_update`、`memory_dream` 等工具保留。

## 主题流程

1. 工作区开启记忆且主题为空；
2. 首次实际写入（`remember` / `update`）生成候选主题；
3. 下一次注入通过提示词让 AI 主动询问用户想用哪个主题；
4. 用户回答后，AI 调用 `memory_theme`（`set`）写回 `policy.json`；不想设置则调用 `skip`；
5. 已有记忆重新判定，匹配的留主库，不匹配的进暂存区。

不再使用 UI 主题提案弹窗。

主题 judge 与反思/dream 模型都可以在工作区设置里从模型目录选择；留空使用默认模型。

## 维护

- 低重要性 active 条目超过 180 天未访问会自动归档；
- 每层 active 上限 1000 条，超出时优先归档低重要性、最久未访问的条目；
- 每 24 小时写维护时 checkpoint WAL，每 7 天尝试 VACUUM；
- 备份保留最近 5 份；
- `rules` / `soul` 不参与自动归档；
- 写入仍走相似度合并去重，dream 产生的重复写入会尽量合并。

## 构建与测试

```powershell
npm install
npm run build
npm test
```

当前测试：

- `test-scope.mjs` — 未托管 / 记忆关闭 / 禁用时 no-op；
- `test-db.mjs` — `.dsh-scope` 库、quarantine、theme 表；
- `test-judge.mjs` — 主题判断 prompt 和解析；
- `test-llm-judge.mjs` — 文本调用、提案、match 回退。

## 上游与许可

本项目基于 [`Phant0Meow/dsh-meow-memory`](https://github.com/Phant0Meow/dsh-meow-memory)，其原始代码与文档版权归原作者及贡献者所有。

本 fork 沿用 MIT 许可证，见 [LICENSE](LICENSE)。若计划公开发布，需要在上游 LICENSE 基础上保留版权与归属说明。
