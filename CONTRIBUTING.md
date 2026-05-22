# Contributing to Aura OS

Thank you for your interest in contributing to Aura OS! This guide will help you get started.

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

- Be respectful and inclusive
- Welcome newcomers and help them get started
- Focus on constructive feedback
- Assume good intentions

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
bundle install

# Verify setup
ruby -v  # Should be 3.0+
aura doctor
```

### 3. Create a Feature Branch

```bash
git checkout -b feature/your-feature-name
```

---

## Development Setup

### Prerequisites

- **Ruby 3.0+** (3.4+ recommended)
- **Git 2.0+**
- **SQLite3** (system library)
- **Bundler**

### Install Dependencies

```bash
bundle install
```

### Run Tests

```bash
# Run all tests
rake test

# Run with coverage
rake coverage

# Run specific test file
ruby test/cli/test_cli_routing.rb
```

---

## Testing

### Test Organization

Tests are organized under `test/` by component:

```
test/
├── cli/              # CLI command tests
├── context/          # Context and state tests
├── kernel/           # Kernel and execution tests
├── llm/              # LLM integration tests
├── generators/       # Generator tests
├── integration/      # Integration tests
└── test_helper.rb    # Test utilities
```

### Writing Tests

**Use Minitest:**

```ruby
require "test_helper"

class TestMyFeature < Minitest::Test
  def setup
    # Setup code
  end

  def teardown
    # Cleanup code
  end

  def test_something
    assert_equal expected, actual
  end
end
```

**Test Naming:**
- Prefix test files with `test_`
- Use descriptive method names: `test_should_handle_empty_input`
- Test one behavior per method

### Running Tests

```bash
# All tests
rake test

# With coverage
COVERAGE=true rake test

# Specific file
ruby test/cli/test_cli_routing.rb

# Specific test method
ruby test/cli/test_cli_routing.rb -n test_help_routes_to_application
```

### Mock API Calls

Tests should **never** make real LLM API calls. Use mock keys:

```bash
# In CI, mock API keys are set automatically
# Locally, set mock keys for testing
export OPENROUTER_API_KEY=mock-key-for-testing
```

---

## Code Style

### Ruby Style

We use RuboCop for code style enforcement.

**Check style:**
```bash
bundle exec rubocop
```

**Auto-fix safe violations:**
```bash
bundle exec rubocop -A
```

**Check specific file:**
```bash
bundle exec rubocop lib/aura/kernel/runner.rb
```

### Style Guidelines

- **Line length**: Max 150 characters
- **Method length**: Max 50 lines
- **Indentation**: 2 spaces
- **Naming**: snake_case for methods, PascalCase for classes
- **Comments**: English only (Chinese allowed in business logic)

### File Organization

```
lib/aura/
├── cli/                    # CLI commands
│   └── commands/           # Individual command classes
├── context/                # Context assembly
├── kernel/                 # Core execution
├── llm/                    # LLM adapters
└── ext/                    # External integrations
```

---

## Pull Request Process

### 1. Before Submitting

- [ ] Write tests for new features
- [ ] All tests pass: `rake test`
- [ ] Code style passes: `bundle exec rubocop`
- [ ] Update documentation if needed
- [ ] Rebase on latest main branch

### 2. Commit Messages

Use conventional commits:

```
type: description

Optional body explaining the change.

type: feat, fix, docs, style, refactor, test, chore
```

**Examples:**
```
feat: add session export functionality
fix: handle nil payload in state recorder
docs: update CLI reference with new commands
test: add coverage for memory metabolizer
```

### 3. Pull Request Template

```markdown
## Description
Brief description of changes.

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
- [ ] Added/updated tests
- [ ] All tests pass
- [ ] Manual testing completed

## Documentation
- [ ] Updated docs if needed
- [ ] Added examples if applicable
```

### 4. Review Process

1. Submit PR to `main` branch
2. CI must pass (tests, build, coverage)
3. At least one maintainer review required
4. Address review feedback
5. Merge after approval

---

## Documentation

### Documentation Structure

```
docs/
├── README.md                    # Documentation index
├── user-guide/                  # For end users
├── developer-guide/             # For contributors
└── changelog/                   # Development history
```

### Writing Documentation

**User Guide:**
- Focus on tasks and workflows
- Include concrete examples
- Use clear, simple language
- Avoid implementation details

**Developer Guide:**
- Explain architecture decisions
- Include code references
- Document APIs and contracts
- Provide examples for contributors

**Style:**
- Use Markdown format
- Keep files under 500 lines
- Use headings consistently
- Include code blocks with language tags

---

## Reporting Issues

### Bug Reports

Include:

1. **Environment**: Ruby version, OS, Aura version
2. **Steps to reproduce**: Clear, numbered steps
3. **Expected behavior**: What should happen
4. **Actual behavior**: What actually happens
5. **Logs/output**: Error messages, stack traces

**Example:**
```markdown
## Environment
- Ruby: 3.4.8
- OS: macOS 15.6.1
- Aura: 0.1.0

## Steps to Reproduce
1. Run `aura new test-project`
2. Run `aura chat --goal "Create hello.txt"`
3. Observe error

## Expected
File created successfully

## Actual
Error: uninitialized constant Aura::Kernel::Runner

## Logs
lib/aura/kernel/runner.rb:42:in `observe': ...
```

### Feature Requests

Include:

1. **Problem**: What problem does this solve?
2. **Proposed solution**: How should it work?
3. **Alternatives**: What other approaches considered?
4. **Examples**: Concrete usage examples

---

## Architecture Overview

See [docs/developer-guide/architecture.md](docs/developer-guide/architecture.md) for system architecture.

### Key Components

- **Kernel**: Core execution engine (`lib/aura/kernel/`)
- **Context**: State and context assembly (`lib/aura/context/`)
- **CLI**: Command interface (`lib/aura/cli/`)
- **LLM**: Provider adapters (`lib/aura/llm/`)

### Design Principles

1. Layered architecture
2. Event-driven communication
3. Read-write separation for state
4. Session isolation
5. Configuration-driven behavior

---

## Development Workflow

### Typical Workflow

```bash
# 1. Update from main
git checkout main
git pull origin main

# 2. Create feature branch
git checkout -b feat/my-feature

# 3. Make changes
# ... edit files ...

# 4. Run tests
rake test

# 5. Check style
bundle exec rubocop

# 6. Commit changes
git add .
git commit -m "feat: add my feature"

# 7. Push and create PR
git push origin feat/my-feature
```

### Branch Naming

- `feat/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation changes
- `refactor/` - Code refactoring
- `test/` - Test additions/changes
- `chore/` - Maintenance tasks

---

## Questions?

- Check [docs/](docs/) for existing documentation
- Review open/closed issues on GitHub
- Submit a new issue with your question

---

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
