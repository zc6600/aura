# Testing & CI/CD

Guide for contributors to the Aura framework itself.

---

## Testing Strategy

The tests under `tests/` validate the framework code in this repository.

**Scope:**
- CLI entry and dispatch: `src/bin/aura.ts`, `src/cli/commands/`
- Workspace initializer: `src/utils/workspaceInitializer.ts` (mapped to `aura new` in `src/bin/aura.ts`, creates `.aura-workspace/` by copying templates)
- Templates: `src/generators/aura/app/templates/config.yml` and tool templates
- Isolation verification: many tests generate a temporary Agent project via `aura new <tmp_path>` and assert files/databases under that generated project.

---

## Running Tests Locally

We use **Vitest** for fast, concurrent test execution.

### Basic Commands

```bash
# Run all tests (single run)
npm test

# Run tests in interactive watch mode
npx vitest

# Run a specific test file
npx vitest run tests/unit/agentLoop.test.ts

# Run a specific test suite or test name
npx vitest run -t "AgentLoop"
```

### Type-based Test Layers (unit / integration)

The repository uses a **type-first** test structure under `tests/`:
- `tests/unit/**`: fast, deterministic, mocks external subprocesses/API keys where possible.
- `tests/integration/**`: multi-module integration, spins up subprocesses, runs git status, initializes workspaces.
- `tests/system/**`: opt-in real-system checks that use a real LLM provider and validate whether end-to-end tasks can be completed.
- `tests/evals/**`: capability evaluation tasks, model comparisons, and agent performance measurements.

```bash
# Run unit tests only
npx vitest run tests/unit/

# Run integration tests only
npx vitest run tests/integration/
```

Notes:
- Integration tests mock LLM responses where appropriate but may verify SQLite database writing, file staging/commits, and LSP/MCP communication hooks.
- Unit and integration tests should **never** make real LLM API calls. Set mock environment keys when writing tests:
  ```bash
  export OPENROUTER_API_KEY=mock-key-for-testing
  ```

### Test Environment Isolation

Most unit/integration tests run with an isolated environment configured at the Vitest level:
- `HOME`, `USERPROFILE`, `TMPDIR`, `TEMP`, `TMP` point to `tests/.sandbox/**`
- `AURA_HOME`, `AURA_GLOBAL_REPO_PATH`, `AURA_GLOBAL_PROJECTS_CONFIG_PATH`, `AURA_DAEMON_SOCKET_DIR` are set to sandboxed paths

Some tests also create per-test temporary sandboxes (mkdtemp) for stronger isolation and easier cleanup, especially for socket paths.

### System Tests

System tests are intentionally separate from unit/integration tests. They use a
real LLM provider and answer: "can the real runtime chain complete this task?"

They are pass/fail runtime checks, not capability scores. A system test should
verify that Aura can complete a bounded task and produce the expected stable
side effect. It should not grade how elegant, optimal, creative, or high quality
the model's solution is. If a task requires subjective evaluation, multiple
models, scoring rubrics, long-horizon autonomy, or comparison against baselines,
put it under `tests/evals/**` instead.

```bash
# Run only system tests (requires: RUN_SYSTEM_TESTS=1, a real provider key, and AURA_SYSTEM_LLM_MODEL)
RUN_SYSTEM_TESTS=1 \
  AURA_SYSTEM_LLM_MODEL=... \
  OPENROUTER_API_KEY=... \
  npx vitest run tests/system/

# Or copy the root env template and run without exporting keys in the shell
cp .env.example .env
$EDITOR .env
RUN_SYSTEM_TESTS=1 npx vitest run tests/system/

# Override provider/model discovery
RUN_SYSTEM_TESTS=1 \
  AURA_SYSTEM_LLM_PROVIDER=openai \
  AURA_SYSTEM_LLM_API_KEY_ENV=OPENAI_API_KEY \
  AURA_SYSTEM_LLM_MODEL=gpt-4o-mini \
  OPENAI_API_KEY=... \
  npx vitest run tests/system/
```

System tests should:
- Assert stable side effects: exit codes, files, event payloads, SQLite rows, and JSON shapes.
- Prefer "did it happen?" assertions over "how well was it done?" assertions.
- Avoid asserting exact natural-language output from the model unless the prompt asks for a unique token or exact small value.
- Use tiny temporary workspaces and bounded `max_steps`, `max_tokens`, retries, and timeouts.
- Stay opt-in with `RUN_SYSTEM_TESTS=1`; ordinary CI should not call real LLM APIs.
- Keep real keys in shell environment variables or the repository root `.env`, which is ignored by git.
- Leave capability scoring, hard tasks, and model-to-model comparisons to `tests/evals/**`.

Good system test assertions include:
- A command exits with the expected success or failure code.
- A requested file is created, modified, or left untouched.
- A JSON response has the expected shape.
- A chat session or kernel run persists expected state.
- A loop stops for the expected runtime reason, such as max tool errors.
- A missing configuration path fails with a clear diagnostic.

Avoid system test assertions like:
- "The answer is concise, helpful, and well structured."
- "The implementation uses the best algorithm."
- "The model chooses the most efficient plan."
- "Model A performs better than Model B."
- Large exact-output snapshots of natural-language responses.

### Candidate System Test Tasks

Use this list when expanding `tests/system/**`. Keep each task small, cheap, and
bounded. The goal is broad runtime coverage, not difficult agent evaluation.

**Smoke and configuration**
- Real chat smoke: one non-empty response is returned and persisted to the default chat session.
- Provider override: `AURA_SYSTEM_LLM_PROVIDER`, `AURA_SYSTEM_LLM_API_KEY_ENV`, `AURA_SYSTEM_LLM_MODEL`, and optional API base are reflected in the generated workspace config.
- Missing key: a configured provider with an empty key fails before a successful LLM response and prints a clear missing-key diagnostic.
- Invalid model or provider: the CLI exits non-zero and surfaces the provider error without corrupting workspace state.

**Planner and parser contracts**
- `kernel plan` returns parser-compatible JSON with either a text final answer or a valid tool call.
- Natural-language completion: `kernel loop` can finish without tool calls when the task only needs a final answer.
- Format recovery: if the first model response is malformed, the loop either recovers within `max_format_errors` or fails with a clear format-error reason.

**Tool loop execution**
- File creation: the loop uses `write_file` to create a small file containing a unique token.
- File readback: after creating a file, the loop reads it and includes the token in the final answer.
- Shell command success: the loop runs a harmless command such as `pwd` or `printf` and records a successful tool result.
- Shell command failure: with `max_tool_errors=1`, a failing command such as `false` causes the loop to stop with a max-tool-errors reason.
- Max steps: a deliberately underspecified task with `--max-steps 1` stops with a bounded failure instead of running indefinitely.

**State and memory**
- Chat session memory: a token stored in one chat turn is available in a later turn in the same session.
- Session isolation: a token stored in one session is not expected in another session's history file.
- Kernel memory recording: a loop run records user input, plan events, execution results, and final status in the expected state store.
- Workspace cleanup: temporary system workspaces are removed after each test, even after command failure.

**User-facing agent entrypoints**
- Multi-step `aura agent -g`: the default daemon-backed entrypoint completes a bounded tool-driven task such as read then write, and leaves the expected file side effects.
- Daemon parity: the same bounded `aura agent -g` goal produces the same stable workspace side effects with and without `--no-daemon`.
- User-visible session memory: a fact stored in one session can be recalled in a later turn in that same session.
- Session isolation: content remembered in one session is not available in a different session.
- `agent --mode ralph`: the CLI entrypoint succeeds with a passing verify command, fails clearly when verification fails, and rejects missing-goal invocation.
- Agent workflow reachability: one representative capability already protected through `aura kernel loop`, such as file read/modify, blackboard, or subagent dispatch, is also reachable through `aura agent -g`.

**Workspace and filesystem boundaries**
- Workspace initialization: a fresh temporary workspace contains config, tools, prompts, and state directories needed by the runtime.
- Path safety: attempts to write outside the workspace fail clearly and do not create files outside the temporary root.
- Existing file update: the loop can update a small existing file while preserving unrelated files.
- Read-only or forbidden path behavior: protected paths fail with stable diagnostics.

**CLI output contracts**
- `kernel observe` emits valid JSON in machine mode.
- `kernel once --call` executes a deterministic tool call and returns valid JSON.
- `kernel loop` emits a stable JSON object containing `steps` and `final` in machine mode.
- Human mode may print prose, but machine mode should remain parseable even when stderr contains progress logs.

**Resilience**
- Timeout: a long-running command is bounded by the test timeout and reports failure clearly.
- Retry budget: provider retry settings are honored for transient LLM failures where the provider adapter can expose them.
- Cleanup after abort: partial loop failure leaves the workspace readable and the next command can still run.

Do not add system tasks that require broad code generation quality, subjective
review, multi-file refactors, large external downloads, web browsing, or model
ranking. Those belong in benchmark or manual evaluation suites.

---

## Compilation & Type Safety

Aura compiles using `tsup` and TypeScript to target ECMAScript 2022.

### Commands

```bash
# Compile and build files into dist/
npm run build

# Run TypeScript compilation check without emitting files
npx tsc --noEmit
```

---

## CI/CD Workflow

### GitHub Actions Configuration

**File**: `.github/workflows/ci.yml`

**Triggered On:**
- Push to `main` branch
- Pull requests to `main` branch

### Jobs Structure

Runs a test matrix in parallel on Ubuntu:
- Node.js 20
- Node.js 22

The CI runs the following steps:
1. Checkout source code.
2. Setup Node.js.
3. Install dependencies (`npm ci`).
4. Compile the project (`npm run build`).
5. Run tests (`npm test`).

---

## See Also

- [Architecture Overview](../explanation/architecture.md) - System-wide architecture
- [Kernel Reference](../reference/kernel.md) - Execution engine details
- [Testing Reference](../reference/testing.md) - Test directories, helpers, and commands
- [Testing Strategy](../explanation/testing-strategy.md) - Why the test layers exist
- [Context & State](../explanation/context-and-state.md) - State management
