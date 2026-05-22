# Global CLI Setup & PATH Integration

This document describes how the **Aura OS** command-line interface (CLI) is packaged, installed globally, and verified via the automated setup pipeline.

---

## 🛠️ One-Click Setup Script (`bin/setup.sh`)

The repository includes a comprehensive, one-click installation and environment diagnostics script at **`bin/setup.sh`**. 

To run the setup:
```bash
./bin/setup.sh
```

### Setup Lifecycle
1. **Dependency Diagnostics**: Checks for system requirements (`Ruby 3.0+`, `Git`, `SQLite3`, and `Bundler`).
2. **Gem Installation**: Runs `bundle install` to compile and install native sqlite3 and framework dependencies.
3. **LLM Credentials**: Creates a workspace `.env` template and prompts for API keys (OpenRouter, OpenAI, Anthropic, etc.).
4. **Global Gem Packaging**: Dynamically executes `gem build aura.gemspec` and installs it locally (`gem install ./aura-*.gem`).
5. **Shell $PATH Integration**: Inspects the Ruby bin folder (`Gem.bindir`) and appends paths automatically to the active shell configuration (`~/.zshrc` or `~/.bash_profile`) if not already present.
6. **Diagnostics Verification**: Instantly runs `aura doctor` globally to confirm the installation is active.

---

## 🔑 Automatic LLM Configuration

Aura OS features **zero-config LLM setup** for chat sessions. When you run `aura chat`:

### Auto-Detection Process
1. **Load `.env` files**: Automatically loads from project directory and `~/.aura/.env`
2. **Detect API keys**: Scans for `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.
3. **Configure provider**: Auto-selects provider based on available keys (priority order)
4. **Apply defaults**: Sets sensible model defaults if not configured in `config.yml`

### Auto-Detection Priority
```
OPENROUTER_API_KEY → openrouter provider (default model: openai/gpt-4o)
OPENAI_API_KEY     → openai provider (default model: gpt-4o)
ANTHROPIC_API_KEY  → anthropic provider (default model: claude-sonnet-4-20250514)
No keys found      → local provider (offline mock)
```

### Example Usage
```bash
# Just add your API key to .env
echo "OPENROUTER_API_KEY=sk-or-v1-your-key" > .env

# Run chat - no manual configuration needed!
aura chat
# Output: ℹ️ Auto-configured LLM provider: openrouter (from OPENROUTER_API_KEY)
```

### Manual Override
You can still manually configure LLM settings in `.aura/config/config.yml`:
```yaml
llm:
  provider: "openrouter"
  model: "anthropic/claude-sonnet-4-20250514"
  api_base: ""
```

Manual configuration takes precedence over auto-detection.

---

## 📍 Global Executable Resolution

When the Aura Gem is installed globally, the executable is placed in the standard Ruby Gem binary directory:

### How to Find the Binary Location
You can query the exact installation directory on any system by running:
```bash
ruby -e 'puts File.join(Gem.bindir, "aura")'
```

### Version Managers (`mise`, `asdf`, `rbenv`)
If you use a tool version manager like **`mise`** or **`asdf`**, the executable will reside in the active Ruby version's directory:
* **Example (Mise)**: `/Users/username/.local/share/mise/installs/ruby/x.y.z/bin/aura`
* **Command Dispatch**: Version managers create terminal shims (e.g., `/Users/username/.local/share/mise/shims/aura`) which automatically proxy calls to the active executable globally.

---

## 🛡️ Source Root Execution Guards

To prevent accidental pollution of the raw framework codebase (e.g., generating database logs or state narratives directly inside the Git repository), `lib/aura/cli/entry.rb` performs a **Source Root Check**:

```ruby
if File.exist?("aura.gemspec") && File.exist?("lib/aura.rb")
  # Restricted unless running safe setup/utility commands
  unless ["help", "--help", "-h", "doctor", "version", "new", "ask", "list", "delete", "branch"].include?(first)
    puts "⛔️ You are trying to run Aura from the source root directory."
    exit 1
  end
end
```

### Whitelisted Commands
The following utility commands are **safely whitelisted** and can be run from the repository root:
* **`aura doctor`**: Runs local system diagnostics.
* **`aura version`**: Prints active framework version.
* **`aura new <project_name>`**: Initializes a clean in-place environment in the current directory and registers it globally.
* **`aura ask "question"`**: Directly query the active LLM from any workspace without agent wrappers. It supports conversation memory. Options:
  * `--session <name>` (or `-s <name>`): Save/load conversation history to/from a named session. Defaults to `default`.
  * `--clear` (or `-c`): Clear memory for the specified session.
  * `--system <text>`: Provide a custom system prompt.
* **`aura list`**: Lists all globally registered active/missing workspaces.
* **`aura delete <project_name>`**: Deletes and unregisters a workspace environment.
* **`aura branch [profile_name]`**: Lists, switches, or creates customized agent profiles (Git branches) inside `.aura/`.
* **`aura help`**: Displays command flags and descriptions.
