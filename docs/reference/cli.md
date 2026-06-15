# Aura CLI Command Reference

Complete reference for all Aura OS commands organized by category.

## Quick Reference

### System Commands

| Command | Description |
|---------|-------------|
| `aura doctor` | Run comprehensive environment checks |
| `aura info` | Display two-tier system and workspace information |
| `aura daemon` | Start the background daemon server |
| `aura web` | Start the Aura web interface server |
| `aura version` | Show Aura version |
| `aura help` | Display help information |
| `aura completion [bash|zsh]` | Generate shell completion |

### Workspace Commands

| Command | Description |
|---------|-------------|
| `aura new [path]` | Initialize a new Aura workspace |
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
| `aura env set <key> <value>` | Set a local environment variable |
| `aura env set <key> <value> --global` | Set a global environment variable |
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
| `aura tools inspect <name>` | Inspect a tool by name |
| `aura tools add <name_or_url>` | Install a library tool by name or URL/path |
| `aura tools install <url_or_path> [name]` | Install a tool from a Git URL or local directory |
| `aura tools generate_group <name> [subtools...]` | Generate a hierarchical tool group |
| `aura skill list` | List installed skills |
| `aura skill install <url_or_path> [name]` | Install a skill from a Git URL or local directory |
| `aura kernel observe` | Observe workspace |
| `aura kernel plan` | Plan a task |
| `aura kernel once` | Run Kernel once with a provided call payload |
| `aura kernel loop` | Run an autonomous kernel loop |
| `aura kernel run_call <tool> <args_json>` | Run a specific tool call |
| `aura session list` | List all conversation sessions |
| `aura session create <name>` | Create and activate a session |
| `aura session switch <name>` | Switch active session |
| `aura session current` | Show current active session |
| `aura session delete <name>` | Delete a session |
| `aura session duplicate <source> <name>` | Duplicate a session |
| `aura session export <name> <dest_path>` | Export a session database |
| `aura session import <path> <name>` | Import a session database |
| `aura session rename <old> <new>` | Rename a session |
| `aura garden list` | List all available Garden Playbooks |
| `aura garden status` | Show workspace health and metrics |
| `aura garden init <playbook>` | Initialize a Garden Playbook template |
| `aura hints list` | List files parsed for hint injection |
| `aura hints toggle <path>` | Toggle hint injection status for a file |
| `aura hints global` | Show global operational guidance file |
| `aura update framework` | Update framework templates and print CLI upgrade guidance |
| `aura update status` | Check template update status |
| `aura update merge` | Merge template updates into current workspace |
| `aura update all` | Update all registered projects |
| `aura update project <path_or_name>` | Update one project |
| `aura update current` / `aura update .` | Update current workspace |
| `aura template sync` | Sync framework templates to global repo |
| `aura template status` | Show template sync status |
| `aura template diff` | Diff framework templates against global repo |

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
Global Repository (~/.aura-framework/repo): OK
LLM Config (Provider: openai): OK
Aura CLI: OK
```

**Options:**
- `-p,--prompts` - Run doctor checks with interactive environment setup prompts (e.g. to prompt for missing API keys).

**When to use:**
- After initial installation
- When encountering runtime errors
- Before running Docker-dependent features
- To verify LLM configuration

#### `aura info`

Display comprehensive two-tier system information: **System-level** (global) and **Workspace-level** (local `.aura-workspace`).

**System-Level Information:**
- 📦 **System**: OS, Node version, architecture
- 🎯 **Aura Framework**: Version, CLI path
- 📁 **Global Environment**: Repository path, config, database
- 🤖 **Global LLM Configuration**: Provider, model, API key status
- 🐳 **Docker Environment**: Version, daemon status, container count
- 📋 **Registered Projects**: All projects and their paths

**Workspace-Level Information** (only when inside a `.aura-workspace` workspace):
- 📍 **Workspace**: Root path and `.aura-workspace` location
- ⚙️ **Workspace Configuration**: Local config overrides
- 💾 **Workspace Database**: Active session database status
- 🎨 **Workspace Skills**: Installed skills list
- 🔧 **Workspace Tools**: Configured tools count
- 🐳 **Sandbox Configuration**: Dockerfile and wrapper status
- 🌿 **Agent Profile**: Current git branch

**When to use:**
- Quick system status overview
- Debug environment issues
- Check workspace configuration
- Verify LLM settings

#### `aura daemon`

Start the long-lived Aura daemon background server. The daemon manages IPC socket/named pipe communication, maintains warm database and tool connections, and reactively watches filesystem changes to eliminate CLI startup latency and observe overhead.

**Example:**
```bash
aura daemon
```

**When to use:**
- Usually spawned automatically in detached background mode by the CLI client.
- Can be run manually in the foreground to monitor daemon logs or troubleshoot socket/connection issues.

---

### Workspace Commands

#### `aura new [path]`

Initialize a new Aura workspace at the specified target path (defaults to the current directory `.`).

**What it does:**
- Creates `.aura-workspace/` directory structure
- Clones universal templates from `~/.aura-framework/repo`
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

Pull template updates from the global repository (`~/.aura-framework/repo`) into your active workspace.

**Example:**
```bash
aura pull
```

#### `aura sync`

Push (sync) local workspace changes back to the global templates (`~/.aura-framework/repo`).

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

1. **Global Config** (`~/.aura-framework/repo/config/config.yml`)
   - Default settings for all workspaces
   - Set with `--global` flag
   - Templates for new workspaces

2. **Workspace Config** (`<project>/.aura-workspace/config/config.yml`)
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

List, switch, or create customized agent profiles (Git branches) inside `.aura-workspace/`.

**Examples:**
```bash
# List all agent profiles
aura branch

# Switch to a profile
aura branch production

# Create a new profile
aura branch experimental
```

#### `aura env set <key> <value>`

Set an environment variable in the `.env` file. 

Writes `KEY=VALUE` into the global environment (`~/.aura-framework/.env`) if the `--global` flag is provided, or the local workspace `.env` file. This is particularly useful for storing sensitive API keys without committing them to the workspace repository.

**Options:**
- `--global` or `-g` - Write to the global environment file (`~/.aura-framework/.env`)

**Examples:**
```bash
# Set Gemini API key globally
aura env set GEMINI_API_KEY sk-... --global

# Set a local workspace environment variable
aura env set MY_VAR value
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
- `-g,--goal "..."` - Run autonomous goal execution (exits when goal is achieved)
- `--ni,--non-interactive` - Print final summary to stdout, bypass interactive prompts
- `-v,--verbose` - Show detailed session information
- `--mode <mode>` - Execution mode: `classic` (default) or `ralph` (autonomous loop with physical/critic verification)
- `--verify <cmd>` - Physical validation check command (e.g. `npm test`) for Ralph mode
- `--critic` - Enable Critic LLM auditing instead of/in addition to physical command validation
- `--critic-mode <mode>` - Critic audit execution mode: `light` (default, quick query) or `heavy` (starts a nested Agent loop)
- `--max-steps <num>` - Maximum steps limit for loops
- `--no-daemon` - Run the agent locally in the current process rather than routing execution through the background daemon

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
- `--model <name>` - Specify the LLM model to use
- `--provider <name>` - Specify the LLM provider to use

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

# Inspect a tool in detail
aura tools inspect read_file
# Inspect with human-readable format
aura tools inspect read_file --human

# Install a library tool by name
aura tools add read_file

# Install a tool from a Git URL or local directory
aura tools install https://github.com/example/custom_tool.git

# Generate a hierarchical tool group (with subtools)
aura tools generate_group my_group subtool1 subtool2
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
aura kernel plan . --goal "Fix failing tests"

# Run a specific tool manually
aura kernel run_call read_file '{"file_path": "README.md"}' .

# Run one kernel step with a direct payload
aura kernel once . --call '{"tool":"read_file","args":{"file_path":"README.md"}}'

# Run the planner-executor loop
aura kernel loop . --goal "Fix all TODO comments" --max-steps 10 --human
```

**Subcommands:**
- `observe [projectPath]` - Assemble and print context.
- `plan [projectPath]` - Produce the next planned step; supports `--goal`, `--human`, and `--preview-lines`.
- `run_call <tool> <args_json> [projectPath]` - Execute one tool call.
- `once [projectPath]` - Run one kernel pass; supports `--call`, `--input`, `--ask`, `--human`, `--verbose`, and `--preview-lines`.
- `loop [projectPath]` - Run an autonomous planner-executor loop; supports `--goal`, `--human`, `--verbose`, and `--max-steps`.

#### `aura web`

Start the Aura web interface server.

**Examples:**
```bash
# Start on 127.0.0.1:9299
aura web

# Choose a port
aura web --port 8080

# Bind to all interfaces
aura web --host 0.0.0.0
```

**Options:**
- `--port` or `-p` - Port number, default `9299`.
- `--host` - Bind host, default `127.0.0.1`.

#### `aura hints`

Manage prompt hint injection and workspace sensing guidelines.

**Subcommands:**
* `list`: List all files scanned for hint injection (e.g. `.hint` sidecar files, markdown files, and code files) along with their active injection/ignore status and reason.
* `toggle <filePath>`: Toggle hint injection status for a specific file.
* `global`: Show the global operational guidelines file (loads `~/.aura-framework/global_hint.md`).

**Examples:**
```bash
# List all active and ignored hints
aura hints list

# Toggle hint injection for a file
aura hints toggle src/utils/helper.ts

# View user-global operational guidelines
aura hints global
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

#### `aura garden`

Manage and initialize Agent Gardening Playbooks.

**Subcommands:**
* `list [projectPath]`: List all available Garden Playbooks in the template repository and active workspace.
* `status [projectPath]`: Show workspace health and metrics (soil state database details, anchors/tasks completion progress, and active hints).
* `init <playbook> [projectPath]`: Initialize a Garden Playbook template in the active workspace.

**Examples:**
```bash
# List all available playbooks
aura garden list

# Show garden status and metrics for the current workspace
aura garden status

# Initialize the Kaggle playbook in the current workspace
aura garden init kaggle
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
Local (.aura-workspace):
  Commit: abc1234 Initial template commit

Global (~/.aura-framework/repo):
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

Sync framework templates to global repository `~/.aura-framework/repo`.

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
# Set globally via env
aura env set GEMINI_API_KEY your-key-here --global

# Or set locally via .env file
echo "GEMINI_API_KEY=your-key-here" >> .env
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

- [Getting Started](../tutorials/getting-started.md) - Installation and setup
- [Configure Aura](../how-to/configure-aura.md) - Configuration system
- [Work with Templates and Updates](../how-to/work-with-templates-and-updates.md) - Update workflows
