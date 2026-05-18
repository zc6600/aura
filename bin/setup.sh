#!/usr/bin/env bash

# ==============================================================================
# Aura OS One-Click Setup & Installer Script
# ==============================================================================
# Focuses on absolute robustness, visual feedback, shell integration, and diagnostics.

set -e

# Color codes for visual feedback
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}======================================================================${NC}"
echo -e "${GREEN}✨ Welcome to the Aura OS One-Click Installer & Setup Engine ✨${NC}"
echo -e "${BLUE}======================================================================${NC}"
echo ""

# ------------------------------------------------------------------------------
# STEP 1: Dependency Check
# ------------------------------------------------------------------------------
echo -e "${BLUE}[Step 1/6] Running System Diagnostics...${NC}"

# Check Ruby
if ! command -v ruby &> /dev/null; then
    echo -e "${RED}⛔️ Error: Ruby is not installed. Please install Ruby 3.0+ before proceeding.${NC}"
    exit 1
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

DOTENV_PATH=".env"

if [ ! -f "$DOTENV_PATH" ]; then
    echo -e "  - Creating workspace environment file ${YELLOW}.env${NC}..."
    cat <<EOT > "$DOTENV_PATH"
# ==============================================================================
# Aura OS Workspace Environment Credentials
# ==============================================================================

# LLM Providers API Keys
OPENAI_API_KEY=
ANTHROPIC_API_KEY=

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
read -p "❓ Would you like to configure your LLM API Keys now? (y/N): " -r RESPONSE
if [[ "$RESPONSE" =~ ^([yY][eE][sS]|[yY])$ ]]; then
    read -p "🔑 Enter Anthropic API Key (or press Enter to skip): " ANTHROPIC_KEY
    if [ ! -z "$ANTHROPIC_KEY" ]; then
        # Replace line in .env (macOS compatible sed)
        sed -i '' "s/ANTHROPIC_API_KEY=/ANTHROPIC_API_KEY=$ANTHROPIC_KEY/g" "$DOTENV_PATH"
        echo -e "    - Anthropic API Key injected."
    fi

    read -p "🔑 Enter OpenAI API Key (or press Enter to skip): " OPENAI_KEY
    if [ ! -z "$OPENAI_KEY" ]; then
        # Replace line in .env (macOS compatible sed)
        sed -i '' "s/OPENAI_API_KEY=/OPENAI_API_KEY=$OPENAI_KEY/g" "$DOTENV_PATH"
        echo -e "    - OpenAI API Key injected."
    fi
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
        read -p "❓ Would you like to automatically append this directory to $SHELL_PROFILE? (Y/n): " -r PATH_RESP
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

exit 0
EOT
    echo -e "Created automated setup script at bin/setup.sh"
