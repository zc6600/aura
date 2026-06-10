# Contributing to Aura OS

Thank you for your interest in contributing to Aura OS! This guide will help you get started with the TypeScript implementation of the Aura framework.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Testing](#testing)
- [Code Style](#code-style)
- [Pull Request Process](#pull-request-process)
- [Documentation](#documentation)
- [Reporting Issues](#reporting-issues)

---

## Code of Conduct

- Be respectful and inclusive.
- Welcome newcomers and help them get started.
- Focus on constructive feedback.
- Assume good intentions.

---

## Getting Started

### 1. Fork the Repository

```bash
# Fork on GitHub, then clone your fork
git clone https://github.com/YOUR_USERNAME/aura.git
cd aura
```

### 2. Set Up Development Environment

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Verify setup
aura doctor
```

### 3. Create a Feature Branch

```bash
git checkout -b feature/your-feature-name
```

---

## Development Setup

### Prerequisites

- **Node.js 18+** (20+ recommended)
- **npm 9+**
- **Git 2.0+**
- **SQLite3** (system library)

### Install Dependencies & Build

```bash
# Install all required npm packages
npm install

# Compile the TypeScript files using tsup
npm run build
```

### Development Mode

You can run the CLI directly from source using `tsx` without building first:

```bash
# Run command directly from source
npm run dev -- doctor
```

---

## Testing

We use **Vitest** for testing the framework.

### Test Organization

Tests are organized under `tests/` by type:

```
tests/
├── unit/              # Unit tests for individual classes/functions
├── integration/       # Multi-module and system integration tests
└── utils/             # Test setup and helper utilities
```

### Running Tests

```bash
# Run all tests
npm test

# Run a specific test file
npx vitest run tests/unit/agentLoop.test.ts

# Run a specific test matching a pattern/name
npx vitest run -t "Context Engineering"
```

### Mock API Calls

Tests should **never** make real LLM API calls. Use mock keys or configure mock LLM responses during testing:

```bash
# Local environment test keys
export OPENROUTER_API_KEY=mock-key-for-testing
```

---

## Code Style

### TypeScript & Style Guidelines

- **Line length**: Max 150 characters.
- **Indentation**: 2 spaces.
- **Naming**: camelCase for variables/functions, PascalCase for classes, UPPER_SNAKE_CASE for constants.
- **Async/Await**: Always use async/await instead of raw promises or callbacks.
- **Strong Typing**: Avoid `any` where possible; use explicit types/interfaces.
- **Comments**: Keep comments clear and in English.

### File Structure

The project has a modular layout under `src/`:

```
src/
├── bin/                    # CLI binary entrypoints
├── cli/                    # CLI commands and UI helpers
│   ├── commands/           # Individual sub-commands (new, run, config, etc.)
│   └── shell/              # Web Server and session shell controllers
├── core/                   # Core agent runtime logic
│   ├── context/            # Context builders and prompt providers
│   ├── ext/                # External protocols (MCP, LSP client)
│   ├── interface/          # TypeScript interface definitions
│   ├── kernel/             # Execution runner, hooks, and agent loops
│   ├── llm/                # LLM client adapters (OpenAI, Anthropic, Gemini, etc.)
│   └── memory/             # State recording, metabolizer, and sqlite storage
└── utils/                  # Common workspace and config utility functions
```

---

## Pull Request Process

### 1. Before Submitting

- [ ] Write tests for new features/bugfixes.
- [ ] Ensure all tests pass: `npm test`
- [ ] Ensure the project builds successfully: `npm run build`
- [ ] Update CHANGELOG.md if adding features or fixing bugs.
- [ ] Update documentation under `docs/` if needed.
- [ ] Rebase on latest main branch.

### 2. Commit Messages

Use conventional commits:

```
type: description

Optional body explaining the change.

Types: feat, fix, docs, style, refactor, test, chore
```

**Examples:**
```
feat: add session export functionality
fix: handle null payload in state recorder
docs: update CLI reference with new commands
test: add coverage for memory metabolizer
```

---

## Reporting Issues

### Bug Reports

Include:

1. **Environment**: Node.js version, OS, Aura version.
2. **Steps to reproduce**: Clear, numbered steps.
3. **Expected behavior**: What should happen.
4. **Actual behavior**: What actually happens.
5. **Logs/output**: Error messages, stack traces.

**Example:**
```markdown
## Environment
- Node: v20.11.0
- OS: macOS 15.6.1
- Aura: 0.1.0

## Steps to Reproduce
1. Run `aura new test-project`
2. Run `aura agent --goal "Create hello.txt"`
3. Observe error

## Expected
File created successfully

## Actual
Error: Could not resolve session DB connection

## Logs
src/core/memory/sqliteStore.ts:42:in `connect`: ...
```

---

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
