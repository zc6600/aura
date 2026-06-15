# Configuration Guide

Aura OS uses a hierarchical configuration system with automatic LLM detection and flexible overrides.

## Configuration Hierarchy

Aura has **two configuration levels**:

### 1. Global Configuration

**Location**: `~/.aura-framework/repo/config/config.yml`

- Default settings for all workspaces
- Templates for new projects
- Set with `--global` flag

### 2. Workspace Configuration

**Location**: `<project>/.aura-workspace/config/config.yml`

- Project-specific overrides
- Takes precedence over global config
- Isolated per workspace

**Priority**: Workspace config > Global config

---

## Dot-Notation for Nested Keys

Access nested configuration using dot-notation:

```bash
# Read nested value
aura config llm.model
aura config security.strict_path_isolation

# Set nested value
aura config llm.provider openai
aura config llm.model gpt-4o
aura config state_management.max_state_chars 100000

# Set global value
aura config llm.provider anthropic --global
```

---

## LLM Configuration

### Automatic Detection

Aura automatically detects and configures LLM providers from `.env` files.

**Priority Order:**

| Environment Variable | Provider | Default Model |
|---------------------|----------|---------------|
| `OPENROUTER_API_KEY` | openrouter | openai/gpt-4o |
| `OPENAI_API_KEY` | openai | gpt-4o |
| `ANTHROPIC_API_KEY` | anthropic | claude-3-5-sonnet-20241022 |
| No keys found | local | (offline mock) |

**Setup:**

```bash
# Create .env file in your project
echo "OPENROUTER_API_KEY=sk-or-v1-your-key" > .env

# Run agent - automatically detects provider
aura agent
# Output: ℹ️ Auto-configured LLM provider: openrouter (from OPENROUTER_API_KEY)
```

**Environment File Locations:**

Aura loads `.env` from:
1. Project directory (`./.env`)
2. Global Aura directory (`~/.aura-framework/.env`)

### Manual Configuration

Override auto-detection by setting values in `config.yml`:

```yaml
llm:
  provider: "openrouter"
  model: "anthropic/claude-3-5-sonnet-20241022"
  api_base: ""  # Optional custom API endpoint
```

Manual configuration takes precedence over auto-detection.

### Setting API Keys

**Method 1: Via `.env` file (recommended)**
```bash
echo "OPENROUTER_API_KEY=your-key" > .env
```

**Method 2: Via Aura environment command**
```bash
# Set globally
aura env set OPENROUTER_API_KEY your-key --global

# Or set locally
aura env set OPENROUTER_API_KEY your-key
```

**Method 3: Via environment variable**
```bash
export OPENROUTER_API_KEY=your-key
```

---

## Agent Profiles (Branches)

Aura supports multiple agent profiles using Git branches within `.aura-workspace/`.

### List Profiles

```bash
aura branch
```

### Switch Profile

```bash
aura branch production
```

### Create Profile

```bash
aura branch experimental
```

**Use Cases:**
- `main` - Default agent behavior
- `production` - Conservative, safe operations
- `experimental` - Aggressive, creative operations
- `debug` - Verbose logging and inspection

---

## Common Configuration Examples

### Development Environment

```bash
# Use GPT-4 for development
aura config llm.provider openai
aura config llm.model gpt-4o

# Enable strict path isolation
aura config security.strict_path_isolation true

# Set moderate context limits
aura config state_management.max_state_chars 100000
```

### Production Environment

```bash
# Use Claude for production (better reasoning)
aura config llm.provider anthropic
aura config llm.model claude-3-5-sonnet-20241022

# Enable strict security
aura config security.strict_path_isolation true
aura config security.sandbox.provider docker

# Conservative context limits
aura config state_management.max_state_chars 50000
```

### Debug Mode

```bash
# Use local provider for testing
aura config llm.provider local

# Disable metabolism for debugging
aura config state_management.summarization.enabled false

# Keep all events
aura config state_management.max_state_chars 1000000
aura config state_management.recent_events_n 200
```

---

## Configuration File Structure

Example `config.yml`:

```yaml
# System Configuration
system:
  max_steps: 30                # Maximum steps per loop run
  max_format_errors: 5         # Tolerated JSON format error retries
  max_tool_errors: 3           # Tolerated tool blockages

# LLM Configuration
llm:
  provider: "openrouter"
  model: "openai/gpt-4o"
  api_base: ""
  api_key: ""  # Prefer .env file
  temperature: 0.2
  max_tokens: 20000
  max_retries: 2

# Embedding Configuration
embedding:
  provider: ""
  model: ""
  api_base: ""
  api_key_env: ""

# Image Generation Configuration
image_generation:
  provider: ""                 # options: openai, stability
  model: ""
  size: ""
  api_key_env: ""

# Knowledge DB Configuration
knowledge_db:
  storage: "local"

# State Management
state_management:
  database_type: "sqlite"
  # Runtime session databases live under state/sessions/<session>.db.
  # db_path is a legacy escape hatch; leave it unset for normal session-aware operation.
  max_state_chars: 100000
  recent_events_n: 20
  keep_last_summary_n_steps: 20
  
  summarization:
    enabled: true
    max_chars: 500
    focus_on:
      - "key_files_modified"
      - "critical_test_results"
      - "blockers_encountered"
      - "cumulative_result"
  
  retention:
    execution: { max_steps: 5, summarize: true }
    observe: { max_steps: 3, summarize: false }
    plan: { max_steps: 50, summarize: false }
    user: { max_steps: 100, summarize: false }
    learn: { max_steps: 200, summarize: true }
    interception: { max_steps: 100, summarize: false }
    milestone: { permanent: true }

# Tool Protocol
tool_protocol:
  allow_dependency_install: true
  test_timeout: 30
  default_timeout_seconds: 300
  max_timeout_seconds: 1200
  agent_can_modify_timeout: true
  
  call_summary:
    max_chars: 256
  
  runtimes:
    python: "python3"
    ruby: "ruby"
    shell: "bash"
    nodejs: "node"
  required_files:
    - "logic.py"
    - "manifest.json"

# Security
security:
  strict_path_isolation: true
  forbidden_extensions:
    - ".env"
    - ".key"
    - ".db-journal"
  read_only_directories:
    - "system_tools"
    - "core_protocols"
  sandbox:
    enabled: false
    provider: "local"          # or "docker"
    image: "aura-sandbox:latest"
  
# Hints
hints:
  auto_inject_readme: true
  scan_dot_hint_files: true
  include_error_traceback: true
  max_hint_chars: 1000
  max_file_chars: 10000
  ignore_list: []

# Ralph Loop Configuration
ralph:
  max_steps: 100
  verify_command: ""
  use_critic: false
  critic_mode: "light"

# Directory Tree
directory_tree:
  max_depth: 3
  max_files_per_dir: 10

# Context Compression
context_compression:
  event_max_chars: 800          # Max length for a single event in compiled context
  event_min_count_threshold: 10 # Retain at least 10 events before trimming summaries
  summary_trim_step: 5          # Number of lines to discard when trimming
```

---

## Context Compression

To optimize context window usage, Aura OS uses a state-aware compression policy configured under the `context_compression` section of `config.yml`.

* **`context_compression.event_max_chars`**: The maximum characters displayed in compiled context for a single event payload (default: `800`).
* **`context_compression.event_min_count_threshold`**: The minimum number of recent events that must be kept before summary trimming starts (default: `10`).
* **`context_compression.summary_trim_step`**: The approximate number of lines discarded at each step when trimming events to fit within limits (default: `5`).

---

## Inspecting Configuration

### Check Current Config

```bash
# View workspace info (includes config)
aura info

# Check specific value
aura config llm.provider
```

### Compare Global vs Workspace

```bash
# View workspace config
aura info
# Look for "Workspace Configuration" section

# View global config
cat ~/.aura-framework/repo/config/config.yml
```

---

## Best Practices

### 1. Use `.env` for Secrets

Never commit API keys to Git. Use `.env` files:

```bash
# Add to .env
echo "OPENROUTER_API_KEY=your-key" >> .env

# Ensure .env is in .gitignore
echo ".env" >> .gitignore
```

### 2. Set Global Defaults

Configure defaults for all future projects:

```bash
aura config llm.provider openrouter --global
aura config security.strict_path_isolation true --global
```

### 3. Override Per-Project

Customize for specific projects:

```bash
cd my-project
aura config llm.model claude-3-5-sonnet-20241022
```

### 4. Use Agent Profiles

Create profiles for different use cases:

```bash
# Production profile
aura branch production
aura config llm.model claude-3-5-sonnet-20241022
aura config security.strict_path_isolation true

# Development profile
aura branch development
aura config llm.model gpt-4o
```

---

## Troubleshooting

### Config not taking effect

```bash
# Check if workspace config overrides global
aura info

# Verify config file syntax
cat .aura-workspace/config/config.yml
```

### LLM provider not detected

```bash
# Check .env file
cat .env

# Verify environment variable
echo $OPENROUTER_API_KEY

# Run diagnostics
aura doctor
```

### Reset configuration

```bash
# Remove workspace config override
rm .aura-workspace/config/config.yml

# Re-run with global defaults
aura info
```

---

## See Also

- [Getting Started](../tutorials/getting-started.md) - Installation and LLM setup
- [CLI Reference](../reference/cli.md) - Config commands
- [Configuration Reference](../reference/configuration.md) - Config schema and field types
- [Configuration Model](../explanation/configuration-model.md) - How config, `.env`, and sessions fit together
- [Memory Management](../explanation/memory-management.md) - State configuration
