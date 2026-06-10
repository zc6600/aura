# Aura OS

> ✨ *"Aura doesn't just give an Agent tools; it gives an Agent an environment to invent them."*

Aura OS is an AI-native operating system that treats the filesystem as an agent's workspace and extended memory. Instead of relying solely on linear prompt history, Aura OS enables agents to reason, persist, and extend their capabilities freely through structured files, custom tools, and automated environment hooks.

---

## 🏗️ Core Architecture: Decoupled Workspace Layout

To keep your code repository perfectly clean and isolate the agent's operations securely, Aura OS uses a **decoupled environment architecture**:

```
my_project/                 <-- Clean User Workspace (Files visible to LLM)
├── .gitignore              <-- Automatically ignores the hidden .aura/ folder
├── src/                    <-- Your code files
└── .aura/                  <-- Hidden Isolated Environment (Agent resources)
    ├── config/
    │   └── config.yml      <-- Local workspace runtime settings
    ├── state/
    │   └── aura.db         <-- SQLite event log and metabolic database
    ├── tools/
    │   └── read_file/      <-- Custom tools, manifests, and unit tests
    └── skills/
        └── example/        <-- Subagent workflow playbooks
            ├── SKILL.md    <-- Core instructions & YAML metadata
            └── scripts/    <-- Optional helper scripts
```

* **Clean User Workspace**: The host workspace is kept pristine. Transient files, sqlite databases, memory summaries, and test runs are completely isolated within `.aura/`.
* **Security & Sandboxing**: Tools run within the parent user workspace (enabling sandboxed read/writes of code), but they fetch configurations, schemas, and credentials safely from the hidden `.aura/` folder.

---

## 🚀 Key Features

* **Folder-as-a-Workspace**: Organizes context, memory summaries, and tools as standard directory items.
* **Global CLI Packaging**: Packageable as a standard npm package with global system-wide commands.
* **Git-under-the-hood VCS**: Features a powerful local version control pipeline mapping standard git flows to clean, branded CLI operations.
* **Metabolism & SQLite Memory**: Persists event histories and memories in SQLite, with automatic summaries generated once context windows are saturated.
* **Hierarchical Configurations**: Get and set deeply nested parameters (e.g. `llm.model`) in local or global configs using simple dot-notation.
* **Built-in Garden Playbooks**: Pre-installed workflow skills (`aura-garden`, `aura-garden-software-check`, `aura-garden-perf-tuning`, `aura-garden-research`) that dynamically scaffold context rules, task anchors, and agent loops for software quality, benchmarking, and mathematical simulations.

---

## 📋 Changelog

See [CHANGELOG.md](CHANGELOG.md) for a complete list of changes, features, and releases.

### Latest Release: v0.1.0

- AI-native OS with folder-as-workspace architecture
- Kernel with AgentLoop execution engine
- Session management with isolated SQLite databases
- Multi-provider LLM support (OpenAI, OpenRouter, Anthropic, Gemini, DeepSeek)
- Memory metabolism with tiered retention
- Ralph Loop for autonomous execution
- Comprehensive CLI with 20+ commands

---

## 💻 Installation & Quick Start

### 1. Installation

Aura OS requires **Node.js 18+** and **Git** installed on your system.

#### Method A: One-Click Setup (Recommended)
You can run the setup script directly to check dependencies, install npm packages, compile the project, configure environment templates, and link the CLI globally.

If you have already cloned the repository locally, run:
```bash
bash bin/setup.sh
```

If the repository is public or you have configured credentials, you can fetch and run it via `curl`:
```bash
curl -fsSL "https://raw.githubusercontent.com/zc6600/aura/main/bin/setup.sh?t=$(date +%s)" | bash
```

*(Note: Since this is a private repository, anonymous raw `curl` requests will return a 404. If you have the GitHub CLI installed and authenticated, you can run: `gh api repos/zc6600/aura/contents/bin/setup.sh -H "Accept: application/vnd.github.raw" | bash`)*

#### Method B: Global NPM Installation
Once published, you can install the CLI globally:
```bash
npm install -g aura-cli
```

#### Method C: Local Source Installation
Alternatively, you can build and link the CLI locally:
```bash
# Clone the repository
git clone https://github.com/zc6600/aura.git
cd aura

# Install dependencies and build
npm install
npm run build

# Link the executable command globally
npm link
```

Verify that Aura is installed globally:
```bash
aura version
aura doctor    # Run comprehensive environment checks (Node.js, Git, Docker, LLM, etc.)
aura info      # Display two-tier system and workspace information
```

### 2. Initialize a Project

Initialize a new project environment (this clones universal templates from your global storage in `~/.aura/repo` into your target directory's hidden `.aura/` folder):

```bash
aura new my_agent_project
cd my_agent_project
```

### 3. Managing Configurations

You can read or write configurations using deeply-nested dot-notation.

```bash
# Get a local config key
aura config llm.model

# Set a local config key (converts boolean/numeric types automatically)
aura config llm.model claude-3-5-sonnet
aura config security.strict_path_isolation true

# Set a global template key (propagated to all future "aura new" projects!)
aura config llm.provider anthropic --global
```

### 4. Git-Powered Version Control (VCS)

Aura packages a full local version control workflow inside `.aura/` so you can stage, commit, and push/sync your newly developed custom tools back to your parent templates globally:

```bash
# 1. Inspect what's modified or untracked in your local environment
aura status

# 2. Stage a newly created custom tool
aura add tools/my_custom_tool

# 3. Commit the changes
aura commit -m "Added standard enterprise search tool"

# 4. Sync (push) the tool back to your global templates (~/.aura/repo)
aura sync

# 5. Pull template updates from the global repository into your active workspace
aura pull
```

### 5. Interactive Agent & Autonomous Goal Execution

Aura OS supports interactive agent sessions with **automatic LLM configuration**, direct query helpers, and autonomous goal execution:

```bash
# 1. Start an interactive agent shell session
# LLM provider is automatically detected from .env file (OPENROUTER_API_KEY, OPENAI_API_KEY, etc.)
aura agent

# 2. Run in autonomous goal execution mode (exits when goal is achieved)
aura agent --goal "Create a file named hello.txt containing hello world"

# 3. Headless non-interactive execution (suitable for automation / cron)
# Prints the final summary to stdout, bypassing interactive prompts and dashboard indicators
aura agent --goal "Find the count of files in the current folder" --non-interactive

# 4. Directly chat or ask the LLM a question (using the default session memory)
aura chat "What is the capital of France?"

# 5. Ask a follow-up question (it will automatically recall the previous question/answer)
aura chat "What is its population?"

# 6. Use a specific custom session name for isolated memory
aura chat "Remember my name is Alice" --session user_info
aura chat "What is my name?" --session user_info

# 7. Clear the session's memory
aura chat "Start over" --session user_info --clear
```

#### Automatic LLM Configuration

When you run `aura agent`, Aura automatically:
- ✅ Loads API keys from `.env` file in your project directory
- ✅ Detects available providers (OpenRouter, OpenAI, Anthropic, etc.)
- ✅ Configures the LLM provider and applies sensible model defaults
- ✅ Shows auto-configuration status on startup

**Example `.env` file:**
```bash
OPENROUTER_API_KEY=sk-or-v1-your-key-here
# or
OPENAI_API_KEY=sk-your-key-here
```

**Auto-detection priority:**
1. `OPENROUTER_API_KEY` → uses `openrouter` provider
2. `OPENAI_API_KEY` → uses `openai` provider  
3. `ANTHROPIC_API_KEY` → uses `anthropic` provider
4. Falls back to `local` (offline mock) if no keys found

No manual configuration required! Just add your API key to `.env` and run `aura agent`.

---

## 🧠 Using the Kernel

The kernel acts as the agent's main processor loop, orchestrating context and plan steps:

```bash
# Observe the workspace (performs context compilation)
aura kernel observe .

# Plan a task (requires LLM integration to output tool instructions)
aura kernel plan .

# Run a specific tool manually
aura kernel run_call . read_file '{"file_path": "README.md"}'
```

### State Memory Inspection
Since Aura stores state in **SQLite**, you can inspect event narratives directly:
```bash
# View last 5 event stages
sqlite3 .aura/state/sessions/default.db "SELECT * FROM events ORDER BY id DESC LIMIT 5;"

# Read the latest context summary after metabolism
sqlite3 .aura/state/sessions/default.db "SELECT content FROM summaries ORDER BY id DESC LIMIT 1;"
```

---

## 🛠️ MCP (Model Context Protocol) Support

Aura OS supports stdio and SSE transports for the Model Context Protocol, enabling agents to tap into hundreds of community-built capabilities.

To add MCP servers, edit your local `.aura/tools/mcp/config.yml` or global `~/.aura/repo/tools/mcp/config.yml`:
```yaml
servers:
  - name: google-search
    transport: sse
    url: "https://mcp-server.example.com/sse"
  - name: local-filesystem
    transport: stdio
    command: "npx"
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/search"]
```

---

## 📄 License

Licensed under the MIT License.
