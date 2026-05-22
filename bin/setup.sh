#!/usr/bin/env bash

# ==============================================================================
# Aura OS One-Click Setup & Installer Script
# ==============================================================================
# Focuses on absolute robustness, visual feedback, shell integration, and diagnostics.

set -e

# Check if running remotely or inside the repository
IS_REMOTE_INSTALL=false
TEMP_CLONE_DIR=""

# Color codes for visual feedback
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

if [ ! -f "aura.gemspec" ] || [ ! -d "lib" ]; then
    echo -e "${YELLOW}⚠️ Running setup script remotely. Cloning Aura OS repository temporarily...${NC}"
    TEMP_CLONE_DIR=$(mktemp -d /tmp/aura_installer.XXXXXX)
    git clone --depth 1 https://github.com/zc6600/aura.git "$TEMP_CLONE_DIR" > /dev/null
    cd "$TEMP_CLONE_DIR"
    IS_REMOTE_INSTALL=true
fi

echo -e "${BLUE}======================================================================${NC}"
echo -e "${GREEN}✨ Welcome to the Aura OS One-Click Installer & Setup Engine ✨${NC}"
echo -e "${BLUE}======================================================================${NC}"
echo ""

# Helper function to install Ruby automatically
install_ruby() {
    echo -e "${YELLOW}⚠️  Ruby is not installed on your system.${NC}"
    read -p "❓ Would you like the installer to attempt to install Ruby automatically? (y/N): " -r AUTO_INSTALL < /dev/tty
    if [[ ! "$AUTO_INSTALL" =~ ^([yY][eE][sS]|[yY])$ ]]; then
        echo -e "${RED}⛔️ Error: Ruby is required to proceed. Please install Ruby manually and run the setup again.${NC}"
        exit 1
    fi

    echo -e "${BLUE}  - Detecting system package manager...${NC}"
    if command -v brew &> /dev/null; then
        echo -e "  - Found Homebrew. Running: ${BLUE}brew install ruby${NC}"
        brew install ruby
    elif command -v apt-get &> /dev/null; then
        echo -e "  - Found apt package manager. Running: ${BLUE}sudo apt-get update && sudo apt-get install -y ruby ruby-dev build-essential${NC}"
        sudo apt-get update && sudo apt-get install -y ruby ruby-dev build-essential
    elif command -v yum &> /dev/null; then
        echo -e "  - Found yum package manager. Running: ${BLUE}yum install -y ruby ruby-devel gcc make${NC}"
        if [ "$EUID" -ne 0 ]; then
            sudo yum install -y ruby ruby-devel gcc make
        else
            yum install -y ruby ruby-devel gcc make
        fi
    elif command -v dnf &> /dev/null; then
        echo -e "  - Found dnf package manager. Running: ${BLUE}dnf install -y ruby ruby-devel gcc make${NC}"
        if [ "$EUID" -ne 0 ]; then
            sudo dnf install -y ruby ruby-devel gcc make
        else
            dnf install -y ruby ruby-devel gcc make
        fi
    else
        echo -e "${RED}⛔️ Error: No supported package manager (brew, apt-get, yum, dnf) found. Please install Ruby manually.${NC}"
        exit 1
    fi
}

# ------------------------------------------------------------------------------
# STEP 1: Dependency Check
# ------------------------------------------------------------------------------
echo -e "${BLUE}[Step 1/6] Running System Diagnostics...${NC}"

# Check Ruby
if ! command -v ruby &> /dev/null; then
    install_ruby
fi

RUBY_VER=$(ruby -e 'print RUBY_VERSION')
echo -e "  - Ruby: ${GREEN}v$RUBY_VER${NC}"

# Check Git
if ! command -v git &> /dev/null; then
    echo -e "${RED}⛔️ Error: Git is not installed. Please install Git first.${NC}"
    exit 1
fi
GIT_VER=$(git --version | cut -d' ' -f3)
echo -e "  - Git: ${GREEN}v$GIT_VER${NC}"

# Check SQLite3
if ! command -v sqlite3 &> /dev/null; then
    echo -e "${YELLOW}⚠️  Warning: sqlite3 CLI tool not found. SQLite database will still work via Ruby, but external database inspection CLI will be unavailable.${NC}"
else
    SQLITE_VER=$(sqlite3 --version | cut -d' ' -f1)
    echo -e "  - SQLite3: ${GREEN}v$SQLITE_VER${NC}"
fi

# Check Bundler
if ! command -v bundle &> /dev/null; then
    echo -e "  - Bundler: ${YELLOW}Not found. Installing Bundler gem...${NC}"
    gem install bundler --no-document
else
    echo -e "  - Bundler: ${GREEN}Installed${NC}"
fi

echo -e "${GREEN}✓ Diagnostics complete!${NC}\n"

# ------------------------------------------------------------------------------
# STEP 2: Install Project Dependencies
# ------------------------------------------------------------------------------
echo -e "${BLUE}[Step 2/6] Installing Framework Dependencies...${NC}"
bundle install
echo -e "${GREEN}✓ Dependencies successfully installed!${NC}\n"

# ------------------------------------------------------------------------------
# STEP 3: Setup LLM Environment Credentials
# ------------------------------------------------------------------------------
echo -e "${BLUE}[Step 3/6] Configuring Environment Credentials...${NC}"

if [ "$IS_REMOTE_INSTALL" = true ]; then
    mkdir -p "$HOME/.aura"
    DOTENV_PATH="$HOME/.aura/.env"
else
    DOTENV_PATH=".env"
fi

if [ ! -f "$DOTENV_PATH" ]; then
    echo -e "  - Creating workspace environment file ${YELLOW}.env${NC}..."
    cat <<EOT > "$DOTENV_PATH"
# ==============================================================================
# Aura OS Workspace Environment Credentials
# ==============================================================================

# LLM Providers API Keys
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
DEEPSEEK_API_KEY=
GEMINI_API_KEY=

# Custom LLM API Settings (Optional)
# OPENAI_API_BASE=

# Agent Target Parameters
AURA_ENV=development
EOT
    echo -e "  - Empty ${GREEN}.env${NC} template initialized."
else
    echo -e "  - Existing ${GREEN}.env${NC} file detected. Skipping creation."
fi

# Ask if user wants to set up keys now
SELECTED_PROVIDER=""
SELECTED_MODEL=""
SELECTED_BASE=""

read -p "❓ Would you like to configure your default LLM Provider and API Keys now? (y/N): " -r RESPONSE < /dev/tty
if [[ "$RESPONSE" =~ ^([yY][eE][sS]|[yY])$ ]]; then
    echo -e "  Select your preferred LLM Provider:"
    echo -e "    1) openai (OpenAI / Compatible Proxy)"
    echo -e "    2) openrouter (OpenRouter Hub)"
    echo -e "    3) deepseek (DeepSeek API)"
    echo -e "    4) gemini (Google Gemini API)"
    echo -e "    5) anthropic (Anthropic Claude API)"
    read -p "  Enter choice (1-5 or provider name, default: 1): " CHOICE < /dev/tty

    # Convert numeric choice to provider name
    case "$CHOICE" in
        1) SELECTED_PROVIDER="openai" ;;
        2) SELECTED_PROVIDER="openrouter" ;;
        3) SELECTED_PROVIDER="deepseek" ;;
        4) SELECTED_PROVIDER="gemini" ;;
        5) SELECTED_PROVIDER="anthropic" ;;
        openai|openrouter|deepseek|gemini|anthropic) SELECTED_PROVIDER="$CHOICE" ;;
        *) SELECTED_PROVIDER="openai" ;;  # Default to openai if invalid
    esac

    # Ask for API key based on selected provider
    case "$SELECTED_PROVIDER" in
        openai)
            read -p "  🔑 Enter OpenAI API Key (or press Enter to skip): " API_KEY < /dev/tty
            if [ ! -z "$API_KEY" ]; then
                ruby -pi -e "gsub('OPENAI_API_KEY=', 'OPENAI_API_KEY=$API_KEY')" "$DOTENV_PATH"
                echo -e "    - OpenAI API Key saved to .env."
            fi
            read -p "  🤖 Enter OpenAI Model name (default: gpt-4o): " OPENAI_MODEL < /dev/tty
            SELECTED_MODEL=${OPENAI_MODEL:-"gpt-4o"}
            read -p "  🌐 Enter Custom API Base URL (optional, press Enter to use default): " API_BASE < /dev/tty
            if [ ! -z "$API_BASE" ]; then
                SELECTED_BASE=$API_BASE
                echo "OPENAI_API_BASE=$API_BASE" >> "$DOTENV_PATH"
            fi
            ;;
        openrouter)
            read -p "  🔑 Enter OpenRouter API Key (or press Enter to skip): " API_KEY < /dev/tty
            if [ ! -z "$API_KEY" ]; then
                echo "OPENROUTER_API_KEY=$API_KEY" >> "$DOTENV_PATH"
                echo -e "    - OpenRouter API Key saved to .env."
            fi
            read -p "  🤖 Enter OpenRouter Model name (default: google/gemini-2.5-flash): " OR_MODEL < /dev/tty
            SELECTED_MODEL=${OR_MODEL:-"google/gemini-2.5-flash"}
            ;;
        deepseek)
            read -p "  🔑 Enter DeepSeek API Key (or press Enter to skip): " API_KEY < /dev/tty
            if [ ! -z "$API_KEY" ]; then
                ruby -pi -e "gsub('DEEPSEEK_API_KEY=', 'DEEPSEEK_API_KEY=$API_KEY')" "$DOTENV_PATH"
                echo -e "    - DeepSeek API Key saved to .env."
            fi
            read -p "  🤖 Enter DeepSeek Model name (default: deepseek-chat): " DS_MODEL < /dev/tty
            SELECTED_MODEL=${DS_MODEL:-"deepseek-chat"}
            ;;
        gemini)
            read -p "  🔑 Enter Gemini API Key (or press Enter to skip): " API_KEY < /dev/tty
            if [ ! -z "$API_KEY" ]; then
                ruby -pi -e "gsub('GEMINI_API_KEY=', 'GEMINI_API_KEY=$API_KEY')" "$DOTENV_PATH"
                echo -e "    - Gemini API Key saved to .env."
            fi
            read -p "  🤖 Enter Gemini Model name (default: gemini-1.5-flash): " GEM_MODEL < /dev/tty
            SELECTED_MODEL=${GEM_MODEL:-"gemini-1.5-flash"}
            ;;
        anthropic)
            read -p "  🔑 Enter Anthropic API Key (or press Enter to skip): " API_KEY < /dev/tty
            if [ ! -z "$API_KEY" ]; then
                ruby -pi -e "gsub('ANTHROPIC_API_KEY=', 'ANTHROPIC_API_KEY=$API_KEY')" "$DOTENV_PATH"
                echo -e "    - Anthropic API Key saved to .env."
            fi
            read -p "  🤖 Enter Anthropic Model name (default: claude-3-5-sonnet-20241022): " ANT_MODEL < /dev/tty
            SELECTED_MODEL=${ANT_MODEL:-"claude-3-5-sonnet-20241022"}
            ;;
    esac
fi
echo -e "${GREEN}✓ Credentials configured successfully!${NC}\n"

# ------------------------------------------------------------------------------
# STEP 4: Build and Install Aura CLI Globally
# ------------------------------------------------------------------------------
echo -e "${BLUE}[Step 4/6] Packaging and Installing Aura CLI Gem globally...${NC}"

# Clear old gems if any
rm -f aura-*.gem

gem build aura.gemspec

# Try installing. If permission denied, prompt for sudo or user install
echo -e "  - Running global installation..."
if gem install ./aura-*.gem; then
    echo -e "  - Global gem installation successful."
else
    echo -e "${YELLOW}⚠️  Global installation requires permissions. Attempting user-level installation...${NC}"
    if gem install ./aura-*.gem --user-install; then
        echo -e "  - User-level gem installation successful."
    else
        echo -e "${RED}⛔️ Installation failed. Please run: sudo gem install ./aura-0.1.0.gem${NC}"
        exit 1
    fi
fi
echo -e "${GREEN}✓ Gem packaged and installed!${NC}\n"

# ------------------------------------------------------------------------------
# STEP 5: Verify Shell Environment Path
# ------------------------------------------------------------------------------
echo -e "${BLUE}[Step 5/6] Verifying Shell \$PATH Integration...${NC}"

# Find exact ruby gems binary folder
GEM_BIN_DIR=$(ruby -e 'print Gem.bindir')

if [[ ":$PATH:" == *":$GEM_BIN_DIR:"* ]]; then
    echo -e "  - Shell PATH is ${GREEN}already configured${NC} for Ruby gems."
else
    echo -e "  - ${YELLOW}Warning:${NC} Ruby Gem binary directory (${BLUE}$GEM_BIN_DIR${NC}) is not in your current shell \$PATH."
    
    # Identify user shell profile
    SHELL_PROFILE=""
    if [[ "$SHELL" == *"zsh"* ]]; then
        SHELL_PROFILE="$HOME/.zshrc"
    elif [[ "$SHELL" == *"bash"* ]]; then
        SHELL_PROFILE="$HOME/.bash_profile"
        if [ ! -f "$SHELL_PROFILE" ]; then
            SHELL_PROFILE="$HOME/.bashrc"
        fi
    fi

    if [ ! -z "$SHELL_PROFILE" ]; then
        read -p "❓ Would you like to automatically append this directory to $SHELL_PROFILE? (Y/n): " -r PATH_RESP < /dev/tty
        if [[ ! "$PATH_RESP" =~ ^([nN][oO]|[nN])$ ]]; then
            echo "" >> "$SHELL_PROFILE"
            echo "# Aura OS Gem Binaries Path Integration" >> "$SHELL_PROFILE"
            echo "export PATH=\"\$PATH:$GEM_BIN_DIR\"" >> "$SHELL_PROFILE"
            echo -e "    - Appended export rule to ${GREEN}$SHELL_PROFILE${NC}."
            echo -e "    - ${YELLOW}Please run: source $SHELL_PROFILE${NC} (or restart your terminal) to apply changes."
            
            # Export to current sub-process environment so doctor works below
            export PATH="$PATH:$GEM_BIN_DIR"
        fi
    else
        echo -e "    - Please manually add ${BLUE}export PATH=\"\$PATH:$GEM_BIN_DIR\"${NC} to your shell profile."
    fi
fi
echo -e "${GREEN}✓ Path integration check completed!${NC}\n"

# Apply selected LLM configurations globally
if [ "$SELECTED_PROVIDER" != "local" ]; then
    echo -e "  - Configuring global default LLM provider to ${GREEN}$SELECTED_PROVIDER${NC}..."
    ruby -Ilib bin/aura config llm.provider "$SELECTED_PROVIDER" --global > /dev/null
    if [ ! -z "$SELECTED_MODEL" ]; then
        echo -e "  - Configuring global default LLM model to ${GREEN}$SELECTED_MODEL${NC}..."
        ruby -Ilib bin/aura config llm.model "$SELECTED_MODEL" --global > /dev/null
    fi
    if [ ! -z "$SELECTED_BASE" ]; then
        echo -e "  - Configuring global default LLM API base to ${GREEN}$SELECTED_BASE${NC}..."
        ruby -Ilib bin/aura config llm.api_base "$SELECTED_BASE" --global > /dev/null
    fi
fi

# ------------------------------------------------------------------------------
# STEP 6: Global Diagnostics Verification
# ------------------------------------------------------------------------------
echo -e "${BLUE}[Step 6/6] Launching Aura Global Diagnostics...${NC}"

if command -v aura &> /dev/null; then
    echo -e "  - Running: ${BLUE}aura doctor${NC}"
    echo ""
    aura doctor
    echo ""
    echo -e "${GREEN}======================================================================${NC}"
    echo -e "🎉 ${GREEN}Congratulations! Aura OS has been successfully installed globally!${NC} 🎉"
    echo -e "   You can now run: ${BLUE}aura new <project_name>${NC} in any workspace!"
    echo -e "${GREEN}======================================================================${NC}"
else
    echo -e "  - Running Doctor locally using relative path..."
    echo ""
    ruby -Ilib bin/aura doctor
    echo ""
    echo -e "${YELLOW}======================================================================${NC}"
    echo -e "⚠️  ${YELLOW}Installation successful, but shell profile reload is required!${NC}"
    echo -e "   Please run: ${BLUE}source $SHELL_PROFILE${NC} or open a new terminal."
    echo -e "   Then you can run: ${BLUE}aura new <project_name>${NC} anywhere!"
    echo -e "${YELLOW}======================================================================${NC}"
fi

if [ "$IS_REMOTE_INSTALL" = true ]; then
    echo -e "  - Cleaning up temporary installation directory..."
    cd /
    rm -rf "$TEMP_CLONE_DIR"
fi

exit 0
EOT
    echo -e "Created automated setup script at bin/setup.sh"
