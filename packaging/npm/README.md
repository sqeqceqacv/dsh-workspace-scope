# @sqeqceqacv/dsh-workspace-scope（工作区扩展）

> 给 DeepSeek Harness 按**工作区**控制 AI 能看到什么、能用什么、能记住什么、拥有什么样的 SOUL，并附带一个**完全本地**的工作区内跨会话记忆库。

**v{{version}}** ｜ MIT ｜ Node ≥ 22.15.0 ｜ 需要 DeepSeek Harness Desktop

> 本项目为非官方社区插件，由社区开发者独立维护，与 DeepSeek 及其关联公司无隶属、合作或背书关系；DSH 及相关商标归其权利人所有，本项目仅在描述兼容性时使用这些名称。

## 它能做什么

- **按工作区裁剪工具** —— 能力组、单工具 allow/deny、收藏组叠加；没有策略文件的工作区完全 no-op，行为与没装一致。
- **运行时工具发现** —— 第三方插件的工具按名字前缀自动成组（`runtime:<prefix>`），默认关闭，不在代码里硬编码别人的工具名。
- **本地记忆库** —— 每个工作区一个 SQLite，跨会话记住项目结构、决策与原话；主题门（judge）把跑题的记忆挡在自动注入之外，另有 quarantine 暂存区与 dream 定期整理。
- **全局 RULE** —— `/rule` 管理跨工作区规则，按工作区的 `rules.global` 开关生效。
- **本地优先** —— 无遥测、无自有服务器；数据都在你自己的磁盘上。

## 安装

前置：DeepSeek Harness Desktop 已安装、Node ≥ 22.15.0、`~/.dsh/profiles/desktop/` 可写。

编辑 `~/.dsh/profiles/desktop/package.json`，**保留已有内容**并加入（不要整段覆盖）：

```json
{
  "dependencies": {
    "@sqeqceqacv/dsh-workspace-scope": "^{{version}}"
  },
  "dsh": {
    "profile": {
      "bundles": ["@sqeqceqacv/dsh-workspace-scope"]
    }
  }
}
```

然后：

```powershell
Set-Location "$env:USERPROFILE\.dsh\profiles\desktop"
pnpm install
```

完全退出并重启 DSH，设置里出现「工作区扩展」即安装成功。

> 离线安装：`pnpm add <本地路径>\sqeqceqacv-dsh-workspace-scope-{{version}}.tgz`，同样把 bundle 名写进 `dsh.profile.bundles`。

## 数据与隐私

- **工作区策略**：`<workspace>/.dsh-scope/policy.json`，仅本工作区读取。
- **记忆库**：`<workspace>/.dsh-scope/memory.db`（SQLite + WAL，**未加密**，含个人记忆正文），默认不进入 git。
- **主题 judge / dream**：启用后，相关记忆片段、工作区名称与整理请求会通过**你配置的模型 provider** 发送；是否出网取决于该 provider，本插件不内置外部服务。
- **会话日志**：位于 `$DSH_HOME/sessions/`；dream 整理时会遍历本工作区对应的会话日志（用于恢复上次模型路由与整理上下文）。模型在对话中读取会话原文时，受系统提示中的会话访问与凭据约束。
- **HTTP API**：仅本地 Host API，依赖 DSH 的同源校验，不额外提供 token——请勿把 DSH 暴露到局域网。
- **遥测**：不内置遥测、不上报使用数据。

## 链接

- 仓库：https://github.com/sqeqceqacv/dsh-workspace-scope
- 开发文档：https://github.com/sqeqceqacv/dsh-workspace-scope/blob/main/docs/development.md
- 变更记录：https://github.com/sqeqceqacv/dsh-workspace-scope/blob/main/CHANGELOG.md

## 许可与归属

本包采用 MIT License，见 [LICENSE](LICENSE)。

`lib/memory/` 下的记忆实现（预构建 host bundle 与 prompt 资源）是 [Phant0Meow/dsh-meow-memory](https://github.com/Phant0Meow/dsh-meow-memory) 的 fork，遵循其 MIT 许可证，上游许可原文见 [LICENSE-UPSTREAM](LICENSE-UPSTREAM)；三段式归属说明见 [NOTICE](NOTICE)。

预构建产物内嵌的第三方 MIT 包（`@deepseek-ai/dsh-llm`、`dsh-timeout`、`schemastery`、`cosmokit`）的版权与许可全文见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 与 `THIRD_PARTY_LICENSES/`。
