# Testing Strategy

Aura tests are organized by the behavior they protect, not by implementation file. The suite has four practical layers: unit tests for local invariants, integration tests for command and subsystem wiring, system tests for agent workflows, and specialized daemon/runtime tests for long-lived execution.

## The Layers

### Unit Tests

Unit tests live under `tests/unit/`. They target one module or one narrow contract at a time.

Use unit tests for:

- Pure validation logic such as path, port, session-name, and config parsing.
- Parser and adapter behavior where inputs and outputs are deterministic.
- State-store operations that can be isolated with temporary files.
- Regression tests for a specific bug in one provider or command helper.

Unit tests should avoid real network calls, long-running processes, and whole CLI flows. If a test needs the CLI entrypoint or a real workspace layout, it is usually an integration test.

### Integration Tests

Integration tests live under `tests/integration/`. They verify that multiple modules work together through real command surfaces or realistic workspace state.

Use integration tests for:

- CLI commands such as `aura new`, `aura chat`, `aura doctor`, `aura tools`, and `aura web`.
- Context engineering, memory, MCP, LSP, and generator interactions.
- Behavior that depends on `.aura-workspace/`, config files, generated templates, or registered projects.

Integration tests can create temporary workspaces. They should still avoid relying on external services unless the test is explicitly marked for that environment.

### System Tests

System tests live under `tests/system/`. They protect complete agent-facing workflows and long-path behavior that requires a real LLM provider.

Use system tests for:

- Kernel loop behavior such as tool-call completion, no-tool final answers, and tool-error aborts.
- Planner contracts.
- Kernel single-tool behavior with a real LLM (`tests/system/kernel-tools/`).
- Kernel cross-tool or cross-agent workflows with a real LLM (`tests/system/kernel-workflows/`).
- User-facing `aura agent -g` entrypoints (`tests/system/cli-e2e/`).
- Session memory behavior across turns.
- Resilience cases such as missing API keys.

System tests are allowed to be more scenario-driven. Keep assertions focused on observable contract: final JSON shape, persisted state, selected tool calls, and workspace files. Behavior that does not need a real LLM belongs in unit or integration tests, even when it uses daemon IPC.

### Daemon Runtime Tests

Daemon tests are split between `tests/unit/daemon.test.ts`, `tests/integration/daemonAdvanced.test.ts`, and `tests/system/runtime/daemonRuntime.test.ts`.

Use daemon tests when behavior depends on:

- IPC lifecycle.
- Detached or long-lived server state.
- Runtime reuse across CLI clients.
- File watching or warm connections.

Do not cover daemon-only behavior with normal CLI tests unless the command contract is what matters.

## What Each Layer Should Catch

| Risk | Best Layer |
|------|------------|
| Invalid config schema behavior | Unit |
| CLI option dispatch or output shape | Integration |
| Workspace initialization and template copying | Integration |
| Agent loop termination and tool failure handling | System |
| Memory persistence across sessions | System |
| IPC socket lifecycle | Daemon runtime |
| LLM provider adapter formatting | Unit or integration |
| Real provider availability | Manual or smoke system test |

## When to Add Tests

Add a unit test when changing a parser, resolver, adapter, validator, store, provider, or small command helper.

Add an integration test when changing a CLI command, workspace layout, template behavior, MCP/LSP wiring, project registry behavior, or anything that crosses module boundaries.

Add a system test when changing planner-loop contracts, autonomous execution, tool execution semantics, session memory, or workflows where a user would describe the behavior as "the agent should..."

Add daemon coverage when the behavior only exists because execution is routed through the daemon.

## What Not to Put in CI

Keep these out of normal CI unless they have explicit opt-in guards:

- Tests that need paid LLM provider access.
- Benchmarks, quality ranking, or subjective model-output evaluation.
- Long-running performance sweeps.
- Tests requiring Docker images not built by the test setup.
- Tests depending on third-party MCP servers.

Those belong in manual evaluation, benchmark suites, or environment-gated smoke tests.

## Source Map

- Test command: `npm test` runs `vitest run`.
- Config: `vitest.config.ts`.
- Shared setup: `tests/globalSetup.ts`.
- Temporary sandbox helper: `tests/utils/testSandbox.ts`.
- System harness: `tests/system/utils/systemHarness.ts`.

See also [Test Aura](../how-to/test-aura.md) for commands and [Testing Reference](../reference/testing.md) for directory and helper details.
