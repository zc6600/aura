# Testing & CI/CD

Guide for contributors to the Aura framework itself.

---

## Testing Strategy

The tests under `tests/` validate the framework code in this repository.

**Scope:**
- CLI entry and dispatch: `src/bin/aura.ts`, `src/cli/commands/`
- Workspace initializer: `src/utils/workspaceInitializer.ts` (mapped to `aura new` in `src/bin/aura.ts`, creates `.aura/` by copying templates)
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
- `tests/system/**`: opt-in real-system checks that may call a real LLM provider and validate end-to-end runtime contracts.
- `tests/benchmark/**`: capability evaluation tasks, model comparisons, and agent performance measurements.

```bash
# Run unit tests only
npx vitest run tests/unit/

# Run integration tests only
npx vitest run tests/integration/
```

Notes:
- Integration tests mock LLM responses where appropriate but may verify SQLite database writing, file staging/commits, and LSP/MCP communication hooks.
- Tests should **never** make real LLM API calls. Set mock environment keys when writing tests:
  ```bash
  export OPENROUTER_API_KEY=mock-key-for-testing
  ```

### System Tests

System tests are intentionally separate from unit/integration tests. They answer
"does the real runtime chain work?" rather than "how capable is the agent?".

```bash
# Run only system tests with a real provider key
RUN_SYSTEM_TESTS=1 OPENROUTER_API_KEY=... npx vitest run tests/system/

# Or copy the local env template and run without exporting keys in the shell
cp tests/system/.env.example tests/system/.env
$EDITOR tests/system/.env
npx vitest run tests/system/

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
- Avoid asserting exact natural-language output from the model.
- Use tiny temporary workspaces and bounded `max_steps`, `max_tokens`, retries, and timeouts.
- Stay opt-in with `RUN_SYSTEM_TESTS=1`; ordinary CI should not call real LLM APIs.
- Keep real keys in shell environment variables or `tests/system/.env`, which is ignored by git.
- Leave capability scoring, hard tasks, and model-to-model comparisons to `tests/benchmark/**`.

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
- Node.js 18
- Node.js 20

The CI runs the following steps:
1. Checkout source code.
2. Setup Node.js.
3. Install dependencies (`npm ci`).
4. Compile the project (`npm run build`).
5. Run tests (`npm test`).

---

## See Also

- [Architecture Overview](architecture.md) - System-wide architecture
- [Kernel Documentation](kernel.md) - Execution engine details
- [Context & State](context-and-state.md) - State management
