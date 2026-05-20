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
        └── custom.rb       <-- Dynamic ruby procedural skills
```

* **Clean User Workspace**: The host workspace is kept pristine. Transient files, sqlite databases, memory summaries, and test runs are completely isolated within `.aura/`.
* **Security & Sandboxing**: Tools run within the parent user workspace (enabling sandboxed read/writes of code), but they fetch configurations, schemas, and credentials safely from the hidden `.aura/` folder.

---

## 🚀 Key Features

* **Folder-as-a-Workspace**: Organizes context, memory summaries, and tools as standard directory items.
* **Global CLI Packaging**: Packageable as a standard Ruby Gem with global system-wide commands.
* **Git-under-the-hood VCS**: Features a powerful local version control pipeline mapping standard git flows to clean, branded CLI operations.
* **Metabolism & SQLite Memory**: Persists event histories and memories in SQLite, with automatic summaries generated once context windows are saturated.
* **Hierarchical Configurations**: Get and set deeply nested parameters (e.g. `llm.model`) in local or global configs using simple dot-notation.

---

## 💻 Installation & Quick Start

### 1. Installation

Aura OS requires **Ruby 3.0+** and **Git** installed on your system.

#### Method A: One-Click Setup (Recommended)
You can directly run the setup script to automate dependencies checks, gem compilation, environment template generation, and global path registration:
```bash
# Clone the repository
git clone https://github.com/your-repo/aura.git
cd aura/aura

# Run the setup script
./bin/setup.sh
```

#### Method B: Manual Gem Installation
Alternatively, you can package and install the CLI globally:
```bash
# Build and install locally
gem build aura.gemspec
gem install ./aura-0.1.0.gem
```

Verify that Aura is installed globally:
```bash
aura version
aura doctor
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

### 5. Chat & Direct LLM Queries (with Memory)

Aura OS supports interactive chat sessions and direct stateless queries that retain memory via session JSON files:

```bash
# 1. Start an interactive agent shell session
aura chat

# 2. Directly ask the LLM a question (using the default session memory)
aura ask "What is the capital of France?"

# 3. Ask a follow-up question (it will automatically recall the previous question/answer)
aura ask "What is its population?"

# 4. Use a specific custom session name for isolated memory
aura ask "Remember my name is Alice" --session user_info
aura ask "What is my name?" --session user_info

# 5. Clear the session's memory
aura ask "Start over" --session user_info --clear
```

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
sqlite3 .aura/state/aura.db "SELECT * FROM events ORDER BY id DESC LIMIT 5;"

# Read the latest context summary after metabolism
sqlite3 .aura/state/aura.db "SELECT content FROM summaries ORDER BY id DESC LIMIT 1;"
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
