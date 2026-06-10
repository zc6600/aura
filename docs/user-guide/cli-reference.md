# Aura CLI Command Reference

Complete reference for all Aura OS commands organized by category.

## Quick Reference

### System Commands

| Command | Description |
|---------|-------------|
| `aura doctor` | Run comprehensive environment checks |
| `aura info` | Display two-tier system and workspace information |
| `aura version` | Show Aura version |
| `aura help` | Display help information |

### Workspace Commands

| Command | Description |
|---------|-------------|
| `aura new <name>` | Initialize a new Aura workspace |
| `aura status` | Show workspace status |
| `aura add <path>` | Stage files in the workspace |
| `aura commit -m "msg"` | Commit changes |
| `aura pull` | Pull updates from global repo |
| `aura sync` | Push changes to global repo |
| `aura list` | List all registered projects |
| `aura delete <name>` | Delete a project |
| `aura prune` | Remove non-existent projects |
| `aura register <name>` | Register current directory |

### Configuration Commands

| Command | Description |
|---------|-------------|
| `aura config <key>` | Get a config value |
| `aura config <key> <value>` | Set a config value |
| `aura config <key> <value> --global` | Set global config |
| `aura branch` | List agent profiles |
| `aura branch <name>` | Switch to agent profile |

### Interaction Commands

| Command | Description |
|---------|-------------|
| `aura agent` | Start interactive agent session |
| `aura agent --goal "..."` | Run autonomous goal execution |
| `aura chat "question"` | Direct LLM query |
| `aura context` | Print project context |

### Management Commands

| Command | Description |
|---------|-------------|
| `aura tools list` | List available tools |
| `aura tools add` | Add a new tool |
| `aura skill list` | List installed skills |
| `aura skill install` | Install a skill |
| `aura kernel observe` | Observe workspace |
| `aura kernel plan` | Plan a task |
| `aura web` | Start web server |
| `aura completion` | Generate shell completion |
| `aura session list` | List all conversation sessions |
| `aura session switch <name>` | Switch active session |

---

## Detailed Command Documentation

### System Commands

#### `aura doctor`

Run comprehensive environment diagnostics to verify your Aura installation is properly configured.

**What it checks:**
- ✅ Node.js version
- ✅ Git installation
- ✅ Docker installation and daemon status
- ✅ Docker Buildx availability
- ✅ Sandbox image presence
- ✅ SQLite3 CLI (optional)
- ✅ Global repository initialization
- ✅ LLM provider configuration
- ✅ API key status

**Example output:**
```
Node: v20.11.1
Git: git version 2.39.5 (Apple Git-154)
Docker: Docker version 28.3.2, build 578ccf6
Docker Daemon: Running
Docker Buildx: v0.14.0
Sandbox Image: aura-sandbox found
SQLite3: 3.45.3
Global Repository (~/.aura/repo): OK
LLM Config (Provider: openai): OK
Aura CLI: OK
```

**When to use:**
- After initial installation
- When encountering runtime errors
- Before running Docker-dependent features
- To verify LLM configuration

#### `aura info`

Display comprehensive two-tier system information: **System-level** (global) and **Workspace-level** (local `.aura`).

**System-Level Information:**
- 📦 **System**: OS, Node version, architecture
- 🎯 **Aura Framework**: Version, CLI path
- 📁 **Global Environment**: Repository path, config, database
- 🤖 **Global LLM Configuration**: Provider, model, API key status
- 🐳 **Docker Environment**: Version, daemon status, container count
- 📋 **Registered Projects**: All projects and their paths

**Workspace-Level Information** (only when inside a `.aura` workspace):
- 📍 **Workspace**: Root path and `.aura` location
- ⚙️ **Workspace Configuration**: Local config overrides
- 💾 **Workspace Database**: Local `aura.db` status
- 🎨 **Workspace Skills**: Installed skills list
- 🔧 **Workspace Tools**: Configured tools count
- 🐳 **Sandbox Configuration**: Dockerfile and wrapper status
- 🌿 **Agent Profile**: Current git branch

**When to use:**
- Quick system status overview
- Debug environment issues
- Check workspace configuration
- Verify LLM settings

---

### Workspace Commands

#### `aura new <name>`

Initialize a new Aura workspace in the current directory.

**What it does:**
- Creates `.aura/` directory structure
- Clones universal templates from `~/.aura/repo`
- Registers the project globally
- Initializes Git repository

**Example:**
```bash
aura new my_project
cd my_project
```

#### `aura status`

Show the current workspace status, including modified and untracked files.

**Example:**
```bash
aura status
```

#### `aura add <path>`

Stage files in the workspace for commit.

**Example:**
```bash
aura add tools/my_custom_tool
```

#### `aura commit -m "message"`

Commit staged changes to the workspace Git repository.

**Example:**
```bash
aura commit -m "Added standard enterprise search tool"
```

#### `aura pull`

Pull template updates from the global repository (`~/.aura/repo`) into your active workspace.

**Example:**
```bash
aura pull
```

#### `aura sync`

Push (sync) local workspace changes back to the global templates (`~/.aura/repo`).

**Example:**
```bash
aura sync
```

#### `aura list`

List all globally registered active and missing workspaces.

**Example:**
```bash
aura list
```

#### `aura delete <name>`

Delete and unregister a workspace environment.

**Example:**
```bash
aura delete old_project
```

#### `aura prune`

Remove non-existent projects from the global registry.

**Example:**
```bash
aura prune
```

#### `aura register <name>`

Register the current directory as a project with the specified name in the global registry.

**Example:**
```bash
aura register my_project
```

---

### Configuration Commands

#### `aura config`

Get or set configuration values using dot-notation for nested keys.

**Examples:**
```bash
# Get a config value
aura config llm.model

# Set a local config value
aura config llm.model claude-3-5-sonnet
aura config security.strict_path_isolation true

# Set a global config value (applies to all future projects)
aura config llm.provider anthropic --global
```

**Configuration Hierarchy:**

Aura uses a **two-level configuration system**:

1. **Global Config** (`~/.aura/repo/config/config.yml`)
   - Default settings for all workspaces
   - Set with `--global` flag
   - Templates for new workspaces

2. **Workspace Config** (`<project>/.aura/config/config.yml`)
   - Project-specific overrides
   - Takes precedence over global config
   - Isolated per workspace

**Example:**
```bash
# Set global default
aura config llm.provider openai --global

# Override in specific workspace
aura config llm.provider anthropic

# Workspace `aura info` will show:
# LLM Provider: anthropic (workspace override)
# ⚠️  Note: Workspace config overrides global LLM settings
```

#### `aura branch`

List, switch, or create customized agent profiles (Git branches) inside `.aura/`.

**Examples:**
```bash
# List all agent profiles
aura branch

# Switch to a profile
aura branch production

# Create a new profile
aura branch experimental
```

---

### Interaction Commands

#### `aura agent`

Start an interactive agent shell session with automatic LLM configuration.

**Examples:**
```bash
# Start interactive session
aura agent

# Run in autonomous goal execution mode
aura agent --goal "Create a file named hello.txt containing hello world"

# Run in non-interactive mode (for automation/cron)
aura agent --goal "Find the count of files in the current folder" --non-interactive
```

**Options:**
- `--goal "..."` - Run autonomous goal execution (exits when goal is achieved)
- `--non-interactive` - Print final summary to stdout, bypass interactive prompts
- `--verbose` - Show detailed session information

#### `aura chat`

Directly query the active LLM from any workspace without agent wrappers. Supports conversation memory.

**Examples:**
```bash
# Ask a question
aura chat "What is the capital of France?"

# Ask a follow-up (recalls previous conversation)
aura chat "What is its population?"

# Use a specific session for isolated memory
aura chat "Remember my name is Alice" --session user_info
aura chat "What is my name?" --session user_info

# Clear session memory
aura chat "Start over" --session user_info --clear
```

**Options:**
- `--session <name>` or `-s <name>` - Save/load conversation history (default: `default`)
- `--clear` or `-c` - Clear memory for the specified session
- `--system <text>` - Provide a custom system prompt

#### `aura context`

Print the current project context that would be sent to the LLM.

**Example:**
```bash
aura context
```

---

### Management Commands

#### `aura tools`

Manage workspace tools.

**Examples:**
```bash
# List available tools
aura tools list

# Add a new tool
aura tools add
```

#### `aura skill`

Manage workspace skills.

**Examples:**
```bash
# List installed skills
aura skill list

# Install a skill
aura skill install <url_or_path> [name]
```

#### `aura kernel`

Run kernel operations directly.

**Examples:**
```bash
# Observe the workspace (performs context compilation)
aura kernel observe .

# Plan a task (requires LLM integration)
aura kernel plan .

# Run a specific tool manually
aura kernel run_call read_file '{"file_path": "README.md"}' .
```

#### `aura web`

Start the web server (if available).

**Example:**
```bash
aura web
```

#### `aura session`

Manage conversation sessions (isolated SQLite memory databases).

**Subcommands:**
* `list`: List all available sessions.
* `create <name>`: Create and activate a new session.
* `switch <name>`: Switch to an existing session.
* `current`: Show details of the currently active session.
* `delete <name>`: Delete a session database (requires confirmation).
* `duplicate <source> <name>`: Duplicate an existing session database for branching experiments.
* `export <name> <dest_path>`: Export a session to a backup file.
* `import <path> <name>`: Import a session from a backup file.
* `rename <old_name> <new_name>`: Rename a session.

**Examples:**
```bash
# List all sessions
aura session list

# Create a new session
aura session create feature-branch

# Switch active session
aura session switch default
```

---

### Update Commands

#### `aura update`

Manage framework, template, and sub-project updates.

**Subcommands:**

##### `aura update framework`

Update Aura CLI itself.

**Behavior:**
- Prints the recommended upgrade command for the TypeScript CLI
- Also triggers template sync to the global repository

**Examples:**
```bash
# From anywhere
aura update framework
```

##### `aura update status`

Check current sub-project's template update status.

**Example:**
```bash
aura update status
```

**Output:**
```
📊 Template Update Status
============================================================
Local (.aura):
  Commit: abc1234 Initial template commit

Global (~/.aura/repo):
  Commit: def5678 Template update from framework v0.1.0

⚠️  Updates available from global repo!
Run 'aura pull' or 'aura update merge' to update.
```

##### `aura update merge`

Smart merge template updates with conflict resolution.

**Options:**
- `--stash` or `-s` - Stash local changes before merging
- `--force` or `-f` - Force merge (use remote version)

**Examples:**
```bash
# Normal merge (aborts if conflicts)
aura update merge

# Stash local changes, then merge
aura update merge --stash

# Force merge (remote overwrites local)
aura update merge --force
```

##### `aura update all`

Batch update all registered sub-projects.

**Options:**
- `--merge` or `-m` - Use smart merge instead of simple pull

**Examples:**
```bash
# Simple pull for all projects
aura update all

# Smart merge for all projects
aura update all --merge
```

##### `aura update project <path_or_name>`

Update a single project by name or workspace directory path.

**Options:**
- `--merge` or `-m` - Use smart merge instead of simple pull

**Examples:**
```bash
# Simple pull for project named my_project
aura update project my_project

# Smart merge for project at specific path
aura update project /path/to/my_project --merge
```

##### `aura update current` (or `aura update .`)

Update the current active workspace templates.

**Options:**
- `--merge` or `-m` - Use smart merge instead of simple pull

**Examples:**
```bash
# Simple pull for current workspace
aura update current

# Smart merge for current workspace
aura update . --merge
```

#### `aura template`

Manage template synchronization.

**Subcommands:**

##### `aura template sync`

Sync framework templates to global repository `~/.aura/repo`.

**What it does:**
1. Backs up user custom modifications
2. Removes old global repository
3. Copies latest templates from framework
4. Reinitializes Git repository
5. Commits as new version

**Example:**
```bash
aura template sync
```

##### `aura template status`

View template sync status.

**Example:**
```bash
aura template status
```

##### `aura template diff`

Compare framework templates vs global repository.

**Example:**
```bash
aura template diff
```

---

## Shell Completion

Generate autocompletion scripts for your shell:

```bash
# Bash
aura completion bash >> ~/.bashrc

# Zsh
aura completion zsh >> ~/.zshrc
```

---

## Troubleshooting

### Common Issues

**Issue: `aura doctor` shows Docker not running**
```bash
# macOS
open -a Docker

# Linux
sudo systemctl start docker
```

**Issue: LLM API Key missing**
```bash
# Set via config
aura config llm.api_key your-key-here

# Or via .env file
echo "OPENAI_API_KEY=your-key-here" >> .env
```

**Issue: Not in workspace**
```bash
# Create a new workspace
aura new my-project
cd my-project

# Or register existing directory
aura register my-project
```

---

## See Also

- [Getting Started](getting-started.md) - Installation and setup
- [Configuration](configuration.md) - Configuration system
- [Workflows](workflows.md) - Update workflows
