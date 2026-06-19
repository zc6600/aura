# Getting Started with Aura OS

This guide will help you install Aura OS, set up your environment, and create your first project.

## System Requirements

Before installing Aura OS, ensure your system meets these requirements:

- **Node.js 18+** (20+ recommended)
- **Git** (2.0+)
- **C++ Build Tools** (e.g. Xcode Command Line Tools on macOS, `build-essential` on Linux/Ubuntu) - Required for compiling the native SQLite driver `better-sqlite3`.

Optional:
- **Docker** (for sandbox features)
- **LLM API Key** (OpenRouter, OpenAI, or Anthropic)

---

## Installation

### Method 1: One-Click Setup (Recommended)

Run the automated setup script in a single command (bypassing caching via a query timestamp) to check dependencies, install packages, compile the project, configure environment templates, and link the CLI globally:

```bash
curl -fsSL "https://raw.githubusercontent.com/zc6600/aura/main/bin/setup.sh?t=$(date +%s)" | bash
```

Alternatively, if you have already cloned the repository locally, you can run:
```bash
bash bin/setup.sh
```

The setup script will:
1. Check system requirements (Node.js, npm, Git)
2. Install npm packages via `npm install`
3. Create a workspace `.env` template and prompt for API keys
4. Compile the CLI via `npm run build`
5. Link the CLI globally via `npm link`
6. Run `aura doctor` to verify the installation

### Method 2: Manual Installation (From Source)

If you prefer manual control:

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

### Verify Installation

After installation, verify everything is working:

```bash
# Check version
aura version

# Run comprehensive environment diagnostics
aura doctor

# Display system and workspace information
aura info
```

---

## LLM Configuration

Aura OS features **zero-config LLM setup**. When you run `aura agent`, it automatically detects and configures your LLM provider.

### Automatic Detection

Simply add your API key to a `.env` file:

```bash
# In your project directory
echo "OPENROUTER_API_KEY=sk-or-v1-your-key" > .env
```

Aura will auto-detect providers in this priority order:

| API Key | Provider | Default Model |
|---------|----------|---------------|
| `OPENROUTER_API_KEY` | openrouter | openai/gpt-4o |
| `OPENAI_API_KEY` | openai | gpt-4o |
| `ANTHROPIC_API_KEY` | anthropic | claude-3-5-sonnet-20241022 |
| No keys found | local | (offline mock) |

**Example:**

```bash
# Just add your API key
echo "OPENROUTER_API_KEY=sk-or-v1-your-key" > .env

# Run agent - no manual configuration needed!
aura agent
# Output: ℹ️ Auto-configured LLM provider: openrouter (from OPENROUTER_API_KEY)
```

### Manual Override

You can manually configure LLM settings in `.aura-workspace/config/config.yml`:

```yaml
llm:
  provider: "openrouter"
  model: "anthropic/claude-3-5-sonnet-20241022"
  api_base: ""
```

Manual configuration takes precedence over auto-detection.

---

## Your First Project

### Create a New Workspace

Initialize a new Aura project:

```bash
aura new my_agent_project
cd my_agent_project
```

This creates a hidden `.aura-workspace/` directory with configuration, state, and tools:

```
my_agent_project/
├── .gitignore              # Automatically ignores .aura-workspace/
├── src/                    # Your code files
└── .aura-workspace/                  # Hidden Aura environment
    ├── config/
    │   └── config.yml      # Workspace settings
    ├── state/
    │   └── sessions/
    │       └── default.db  # SQLite database for default session
    ├── tools/              # Custom tools
    └── skills/             # Dynamic skills
```

### Run Your First Agent

Start an interactive agent session:

```bash
aura agent
```

Or run in autonomous mode:

```bash
aura agent --goal "Create a file named hello.txt containing hello world"
```

### Check Project Status

```bash
# View workspace information
aura info

# Check environment health
aura doctor
```

---

## Source Root Protection

To prevent accidental pollution of the raw framework codebase, Aura restricts certain commands when run from the source root directory (where `package.json` with the name `aura-cli` exists).

### Whitelisted Commands

These commands can be run from the source root:

- `aura help` - Display help information
- `aura doctor` - Run environment checks
- `aura info` - Display system information
- `aura version` - Print version
- `aura new <project>` - Create new workspace
- `aura chat "question"` - Direct LLM query
- `aura list` - List registered projects
- `aura delete <name>` - Delete a project
- `aura branch` - Manage agent profiles
- `aura register <name>` - Register project
- `aura prune` - Prune projects
- `aura web` - Start web dashboard server
- `aura template` - Manage templates
- `aura completion` - Generate shell completion

All other commands must be run from within a workspace directory.

### Bypassing Source Root Protection

For developers working directly on the Aura OS source code who wish to run commands (like `aura agent`) in the source root directory, the restriction can be bypassed:

- By setting the environment variable `AURA_ALLOW_ROOT=true` (e.g. `AURA_ALLOW_ROOT=true aura agent`)
- By appending the `--allow-root` option to the command line (e.g. `aura agent --allow-root`)

---

## Next Steps

Now that you have Aura installed and running:

- [CLI Reference](../reference/cli.md) - Learn all available commands
- [Configure Aura](../how-to/configure-aura.md) - Understand the config system
- [Manage Sessions](../how-to/manage-sessions.md) - Manage isolated conversations
- [Extend with Skills, Tools, and Garden](../how-to/extend-with-skills-and-tools.md) - Extend agent capabilities
- [Work with Templates and Updates](../how-to/work-with-templates-and-updates.md) - Version control and update workflows

---

## Troubleshooting

### Node.js version too old

```bash
# Check your Node.js version
node -v

# We recommend using nvm or fnm to manage Node.js versions:
nvm install 20
nvm use 20
```

### Native module better-sqlite3 installation fails

```bash
# Ensure build tools are installed.
# macOS:
xcode-select --install

# Linux (Ubuntu/Debian):
sudo apt-get install build-essential python3
```

### Docker not running (optional)

```bash
# macOS
open -a Docker

# Linux
sudo systemctl start docker
```

### LLM API key not detected

```bash
# Check .env file exists
cat .env

# Verify key is set
echo $OPENROUTER_API_KEY

# Run diagnostics
aura doctor
```
