# System Test TODO

System tests use a real LLM provider and verify whether Aura can complete a
bounded end-to-end task. They should assert stable side effects and runtime
contracts, not subjective answer quality or model capability scores.

## P0 high-value coverage

- [x] Plan proposal flow: real LLM calls `plan_proposal` to create a small
  implementation plan with a fixed `run_id`; assert `plan.json`, `plan.md`,
  and pending status exist in workspace state.
- [x] Long-term task tracking: real LLM calls `plan_task` to create/update a
  checklist with a fixed `run_id`; assert `task.json`, `task.md`, and completed
  indices are persisted.
- [x] Context-aware read/modify: seed a small file, have the real loop read and
  update a unique token; assert only the target file changes.
- [x] Workspace search grounding: seed multiple files, have the real loop use
  `workspace_grep` or `chunk_search` to find a unique token; assert search tool
  usage and final token.
- [x] Tool self-discovery: have the real loop inspect a tool with
  `inspect_tool` before using it; assert both tool inspection and the target
  side effect.
- [x] Subagent basics: have the real loop call `subagent` for a tiny bounded
  task; assert the parent step includes `subagent` and the subtask output or
  artifact contains the expected token.

## P1 broader high-level behavior

- [ ] Anchor flow: submit an anchor and verify a later loop can use the anchored
  context.
- [x] Knowledge DB roundtrip: store a unique fact and retrieve it in a later
  loop.
- [x] Blackboard roundtrip: write a unique payload to the shared blackboard and
  read it back in the same loop.
- [ ] Background process awareness: start a short background process and assert
  returned pid/stdout/stderr metadata is visible to later context.
- [ ] Git/file-change audit: make a small file change and assert git diff or
  memory event rows capture the tool execution.

## P2 optional or environment-sensitive

- [ ] Garden context injection: enable a garden/skill context and verify it
  influences a bounded task with a stable side effect.
- [ ] MCP tool discovery: configure a tiny local MCP server and verify a real
  loop can discover and call its tool.
- [ ] LSP context: seed a small TypeScript file and verify the loop can use
  symbol context to perform a targeted edit.
- [ ] OCR/render image: verify a simple generated image or rendered artifact can
  be processed by the relevant tool path.

## Daemon integration coverage

- [x] Daemon agent progress stream: run `agent/runGoal` through real IPC and
  assert `agent/onProgress` notifications plus final result.
- [x] Daemon disconnect cancellation: disconnect the client during a running
  goal and assert the active job is aborted and daemon returns to idle.
- [x] Daemon concurrent goal rejection: while one client has a running goal,
  a second client must receive the "already running" error.
- [x] Daemon execute process RPC: cover `execute/listProcesses`,
  `execute/getProcessLogs`, `execute/subscribeLogs`, and `execute/killProcess`
  against tracked process metadata/log files over real IPC.
- [x] Daemon raw JSON-RPC protocol: malformed JSON, unknown method, missing
  `jsonrpc`, and batched line-by-line requests return stable errors without
  crashing the server.
- [x] Daemon workspace tree limits: dotfiles, ignored directories, depth limit,
  and large directory limits are enforced by `workspace/getFileTree`.
- [x] Daemon stale socket startup: a stale IPC path is removed so a new server
  can start cleanly.
- [x] Daemon client pending rejection: pending requests reject when the daemon
  socket closes mid-request.

## Daemon system coverage

- [x] Real LLM daemon smoke: `agent/runGoal` over daemon IPC completes a tiny
  final-answer task and emits progress notifications.
- [x] Real LLM daemon tool loop: daemon-driven `agent/runGoal` creates a token
  file via `write_file` and returns to idle.
- [x] Real LLM daemon confirmation: with dangerous-tool confirmation enabled,
  denial prevents the side effect and approval allows it.

## AutoKaggle Framework-Level Simplification & Upgrade (Declarative Workflow)

- [x] Item 1: Lightweight Python Tool SDK (`aura_tool_helpers`) providing standardized JSON input/output, safe YAML loading, CSV schema alignment checks, and simple sqlite runs registry.
- [x] Item 2: Core-level Defer/Resume state handling in `AgentLoop.run()` to natively pause on tool cooldown or rate limits without wasting LLM turns.
- [x] Item 3: Declarative transition gates in `workflow.yml` stages (assert_files, requires, problems).
- [x] Item 4: Scaffolding generator command (`aura create use-case`) to bootstrap custom workspace templates automatically.
