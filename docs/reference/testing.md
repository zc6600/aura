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
| `tests/system/daemon/` | Runtime daemon behavior |
| `tests/system/loop/` | Kernel loop completion and failure behavior |
| `tests/system/planner/` | Planner contract behavior |
| `tests/system/resilience/` | Missing keys and degraded environments |
| `tests/system/state/` | Session and state behavior |
| `tests/system/workflows/` | Scenario-level agent workflows |
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
- `toolLoop.test.ts`

For system workflow tests, prefer scenario names:

- `contextReadModify.test.ts`
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
| Kernel planner or tool loop behavior | `tests/system/loop/` or `tests/system/planner/` |
| Agent workflow behavior | `tests/system/workflows/` |
| Daemon lifecycle or IPC behavior | `tests/system/daemon/` |

See [Testing Strategy](../explanation/testing-strategy.md) for the rationale and [Test Aura](../how-to/test-aura.md) for task-oriented commands.
