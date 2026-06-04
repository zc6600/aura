# Testing & CI/CD

Guide for contributors to the Aura framework itself.

---

## Testing Strategy

The tests under `tests/` validate the framework code in this repository.

**Scope:**
- CLI entry and dispatch: `src/bin/aura.ts`, `src/cli/commands/`
- Workspace initializer: `src/cli/commands/new.ts` (creates `.aura/` by copying standard templates)
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
