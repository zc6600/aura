# Aura 项目指南

## 调试快速上手
- 打印上下文：
  - `bin/aura context .`
- 检查工具：
  - 结构化：`bin/aura tools inspect <tool>`
  - 美化 JSON：`bin/aura tools inspect <tool> --pretty`
  - 人类可读：`bin/aura tools inspect <tool> --human`
- 运行一次内核：
  - JSON 输出：
    - `bin/aura kernel once . -c '{"tool":"read_file","args":{"file_path":"config/config.yml","context_permissions":["."]}}'`
  - 人类可读：
    - `bin/aura kernel once . -H -n 8 -c '{"tool":"read_file","args":{"file_path":"config/config.yml","context_permissions":["."]}}'`

## LLM 集成 (OpenRouter)
- 设置配置：`config/config.yml` → `llm.provider: "openrouter"`，`llm.model: "openai/gpt-4o-mini"`（或你喜欢的模型）
- 在项目根创建 `.env`：
  - `OPENROUTER_API_KEY=sk-...`（不要提交到版本库）
- 运行规划阶段：
  - `bin/aura kernel plan . -H -n 8`（默认会把上下文与目标传给 LLM，输出下一步工具调用）
- 持续运行直到 final：
  - `bin/aura kernel loop . -g "你的目标" -m 10`（最大步数可选，达到后停止）

## 工作区与记忆
- 工作区就是项目根目录（默认 cwd），不是硬沙箱
- 隔离依赖 `security.strict_path_isolation` 与 sandbox 配置
- 可放置指令文件：`AGENTS.md`、`SOUL.md`、`USER.md`、`TOOLS.md`、`IDENTITY.md`、`MEMORY.md`
- 可选每日记忆：`memory/YYYY-MM-DD.md`（若存在会自动加载最近两天）

## 常见问题
- `权限被拒绝`：为工具调用补充 `args.context_permissions`，或在 `manifest.json` 配置权限
- `上下文过长`：调整 `config.yml` 的 `state_management.max_state_chars` 或触发代谢
- `能力不足`：你可以编辑 `tools/mcp/config.yml` 自主添加新的 MCP 服务器（支持 Stdio 和 SSE）来扩展你的工具集。

## 备份建议
- 建议将工作区放入私有 git 仓库进行备份
- 避免提交 `.env`、密钥、凭证等敏感信息

## 状态文件
- SQLite 数据库：`state/aura.db`（可通过 `config/config.yml` → `state_management.db_path` 覆盖）
- 查看最近事件：`sqlite3 state/aura.db "SELECT id, phase, tool, payload FROM events ORDER BY id DESC LIMIT 10;"`
- 查看最近摘要：`sqlite3 state/aura.db "SELECT id, content FROM summaries ORDER BY id DESC LIMIT 5;"`
