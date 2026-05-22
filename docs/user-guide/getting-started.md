# Getting Started with Aura OS

This guide will help you install Aura OS, set up your environment, and create your first project.

## System Requirements

Before installing Aura OS, ensure your system meets these requirements:

- **Ruby 3.0+** (3.4+ recommended)
- **Git** (2.0+)
- **SQLite3** (system library)
- **Bundler** (Ruby gem manager)

Optional:
- **Docker** (for sandbox features)
- **LLM API Key** (OpenRouter, OpenAI, or Anthropic)

---

## Installation

### Method 1: One-Click Setup (Recommended)

Run the automated setup script to check dependencies, compile the gem, generate environment templates, and configure paths:

```bash
curl -fsSL "https://raw.githubusercontent.com/zc6600/aura/main/bin/setup.sh?t=$(date +%s)" | bash
```

The setup script will:
1. Check system requirements (Ruby, Git, SQLite3, Bundler)
2. Install dependencies via `bundle install`
3. Create a workspace `.env` template and prompt for API keys
4. Build and install the Aura gem globally
5. Configure your shell `$PATH` if needed
6. Run `aura doctor` to verify the installation

### Method 2: Manual Installation

If you prefer manual control:

```bash
# Clone or navigate to the Aura source
cd /path/to/aura/aura

# Install dependencies
bundle install

# Build and install the gem
gem build aura.gemspec
gem install ./aura-0.1.0.gem
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

Aura OS features **zero-config LLM setup**. When you run `aura chat`, it automatically detects and configures your LLM provider.

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
| `ANTHROPIC_API_KEY` | anthropic | claude-sonnet-4-20250514 |
| No keys found | local | (offline mock) |

**Example:**

```bash
# Just add your API key
echo "OPENROUTER_API_KEY=sk-or-v1-your-key" > .env

# Run chat - no manual configuration needed!
aura chat
# Output: ℹ️ Auto-configured LLM provider: openrouter (from OPENROUTER_API_KEY)
```

### Manual Override

You can manually configure LLM settings in `.aura/config/config.yml`:

```yaml
llm:
  provider: "openrouter"
  model: "anthropic/claude-sonnet-4-20250514"
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

This creates a hidden `.aura/` directory with configuration, state, and tools:

```
my_agent_project/
├── .gitignore              # Automatically ignores .aura/
├── src/                    # Your code files
└── .aura/                  # Hidden Aura environment
    ├── config/
    │   └── config.yml      # Workspace settings
    ├── state/
    │   └── aura.db         # SQLite database
    ├── tools/              # Custom tools
    └── skills/             # Dynamic skills
```

### Run Your First Agent

Start an interactive chat session:

```bash
aura chat
```

Or run in autonomous mode:

```bash
aura chat --goal "Create a file named hello.txt containing hello world"
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

To prevent accidental pollution of the raw framework codebase, Aura restricts certain commands when run from the source root directory (where `aura.gemspec` exists).

### Whitelisted Commands

These commands can be run from the source root:

- `aura help` - Display help information
- `aura doctor` - Run environment checks
- `aura info` - Display system information
- `aura version` - Print version
- `aura new <project>` - Create new workspace
- `aura ask "question"` - Direct LLM query
- `aura list` - List registered projects
- `aura delete <name>` - Delete a project
- `aura branch` - Manage agent profiles

All other commands must be run from within a workspace directory.

---

## Next Steps

Now that you have Aura installed and running:

- [CLI Reference](cli-reference.md) - Learn all available commands
- [Configuration](configuration.md) - Understand the config system
- [Sessions](sessions.md) - Manage isolated conversations
- [Skills & Tools](skills-and-tools.md) - Extend agent capabilities
- [Workflows](workflows.md) - Version control and update workflows

---

## Troubleshooting

### Ruby version too old

```bash
# Check your Ruby version
ruby -v

# Upgrade Ruby (using Homebrew on macOS)
brew install ruby
```

### Gem installation fails

```bash
# Ensure bundler is installed
gem install bundler

# Install dependencies
bundle install
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
