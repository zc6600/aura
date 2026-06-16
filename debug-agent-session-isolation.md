# Debug Session: agent-session-isolation [OPEN]

## Symptom
- `tests/system/cli-e2e/agentInteractive.test.ts` 中的交互式 session isolation 用例失败。
- 现象是切到另一个 session 后，隔离 session 的持久化内容里仍然出现上一个 session 的 token。

## Scope
- 先确认问题是否真实存在。
- 当前阶段不修改业务逻辑，只做假设、复现和证据收集。

## Hypotheses
- H1: `session switch` 命令没有真正切换 active session，新的交互 shell 仍绑定到旧 session。
- H2: daemon 在 `workspace/initialize` 或 runner 复用时缓存了旧 session 的 memory/store，导致新 shell 虽然 active session 变了，但底层仍读旧数据。
- H3: 测试读取的 `isolated` session 数据库本身就被错误写入了上一轮 prompt，说明写路径存在串 session 污染。
- H4: 交互 shell 或 session CLI 在同一 workspace 下共享了某个全局状态/环境变量，导致 session 激活对后续 agent 进程不生效。
- H5: 失败仍有可能是测试时序问题，`session switch` 完成与新 shell 启动之间存在竞争，导致新 shell 在切换前初始化。

## Plan
- 先用现有 system test 继续复现并收集更精确的持久化证据。
- 然后静态检查 `session switch`、daemon `workspace/initialize`、runner/session store 绑定路径。
- 最后判断是测试问题还是源代码问题。

## Evidence
- `SessionCmd.create()` 在 [session.ts](file:///Users/frank/Desktop/Towards%20AGI/aura/aura/src/cli/commands/session.ts#L56-L72) 中会自动执行 `sessionMgr.activate(name)`。
- 原 isolation test 先执行 `aura session create interactive_isolated`，因此后续“第一轮记住 token”的交互 shell 实际上很可能从一开始就跑在 `interactive_isolated` 上。
- daemon `workspace/initialize` 会销毁旧 runner、创建新 `Runner`，并在提供 `sessionName` 时调用 `runner.reconnectSession(sessionName)`；`Runner.reconnectSession()` 会重建 memory store。
- 结论：当前失败不能证明 session 泄漏，更符合“测试前置状态错误”。

## Fix
- 将 isolation test 改为直接用 `SessionManager.create()` 创建隔离 session，但不激活它。
- 第一轮交互 shell 保持默认 session。
- 第二轮前显式运行 `aura session switch interactive_isolated`，再启动新的交互 shell 验证隔离。
