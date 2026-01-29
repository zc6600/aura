# Aura 项目指南

## 工作空间规则
- /tools：工具目录，每个子目录包含 `manifest.json`、`logic.py`、`test.py`
- /knowledge：知识资产目录，使用 `.hint` 提供上下文提示
- /state：内核写入的事件日志与代谢摘要
- `config/config.yml`：系统、工具、权限与代谢配置

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

## 常见问题
- `权限被拒绝`：为工具调用补充 `args.context_permissions`，或在 `manifest.json` 配置权限
- `工具未激活`：补齐 `logic.py`、`manifest.json`、`test.py`，并确保 `test.py` 通过
- `上下文过长`：调整 `config.yml` 的 `state_management.max_state_chars` 或触发代谢

## 状态文件
- 事件日志：`state/events.log`
- 代谢摘要：`state/summary.txt`

