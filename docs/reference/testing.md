# Testing Reference

This page is lookup material for Aura's test layout, commands, and helper files.

## Commands

| Command | Purpose |
|---------|---------|
| `npm test` | Run the full Vitest suite with `vitest run` |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run test:coverage` | Run Vitest with coverage |
| `npx vitest tests/unit/pathResolver.test.ts` | Run one test file |
| `npx vitest tests/integration/kernel.test.ts -t "pattern"` | Run matching tests in one file |

## Test Directories

| Path | Purpose |
|------|---------|
| `tests/unit/` | Narrow module and contract tests |
| `tests/integration/` | CLI and subsystem wiring tests |
| `tests/system/` | End-to-end agent workflow tests |
| `tests/system/smoke/` | Minimal real-provider availability checks |
| `tests/system/kernel-contracts/` | Kernel planner, loop, output, and failure contracts |
| `tests/system/kernel-tools/` | Single-tool capabilities driven through `aura kernel loop` with a real LLM |
| `tests/system/kernel-workflows/` | Cross-tool or cross-agent workflows driven through `aura kernel loop` |
| `tests/system/cli-e2e/` | User-facing CLI goal flows driven through `aura agent -g` |
| `tests/system/runtime/` | Daemon, IPC, session, and long-lived runtime behavior |
| `tests/system/failure-modes/` | Missing keys and degraded environments |
| `tests/utils/` | Shared test helpers |

## Important Files

| File | Role |
|------|------|
| `vitest.config.ts` | Vitest project configuration |
| `tests/globalSetup.ts` | Shared setup before tests |
| `tests/utils/testSandbox.ts` | Temporary workspace/sandbox utilities |
| `tests/utils/rmRetry.ts` | Retry helper for filesystem cleanup |
| `tests/system/utils/systemHarness.ts` | System-test harness for agent workflows |

## Naming Conventions

Use `*.test.ts` for all Vitest test files.

Prefer names that describe the user-facing contract:

- `sessionManager.test.ts`
- `workspaceInitializer.test.ts`
- `daemonRuntime.test.ts`
- `loopToolExecution.test.ts`

For system tool and workflow tests, prefer capability or scenario names:

- `fileReadModify.test.ts`
- `workspaceSearch.test.ts`
- `subagentBasic.test.ts`

## Environment Rules

Tests should not depend on a real user workspace. Use temporary directories and cleanup helpers.

Tests should not require real provider keys unless they are explicitly smoke tests. Keep paid or network-dependent tests out of default CI.

Tests that mutate global-ish state should isolate `HOME`, `AURA_HOME`, project registries, or filesystem roots through the provided helpers.

## Layer Selection

| Change Type | Test Location |
|-------------|---------------|
| Pure parser, resolver, store, adapter | `tests/unit/` |
| CLI command behavior | `tests/integration/` |
| Workspace initialization or template behavior | `tests/integration/` |
| Kernel planner, output, or loop contract | `tests/system/kernel-contracts/` |
| Single-tool behavior with a real LLM | `tests/system/kernel-tools/` |
| Cross-tool or cross-agent workflow behavior | `tests/system/kernel-workflows/` |
| User-facing `aura agent -g` behavior | `tests/system/cli-e2e/` |
| Daemon lifecycle, session, or IPC behavior | `tests/system/runtime/` |
| Provider configuration or degraded environment | `tests/system/failure-modes/` |

See [Testing Strategy](../explanation/testing-strategy.md) for the rationale and [Test Aura](../how-to/test-aura.md) for task-oriented commands.
