#!/usr/bin/env bash

# ==============================================================================
# Aura OS TypeScript One-Click Setup & Installer Script
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
echo -e "${GREEN}✨ Welcome to the Aura OS TS One-Click Installer & Setup Engine ✨${NC}"
echo -e "${BLUE}======================================================================${NC}"
echo ""

# ------------------------------------------------------------------------------
# STEP 1: Dependency Check
# ------------------------------------------------------------------------------
echo -e "${BLUE}[Step 1/5] Running System Diagnostics...${NC}"

# Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}⛔️ Error: Node.js is not installed. Please install Node.js 18+ first.${NC}"
    exit 1
fi
NODE_VER=$(node -v)
echo -e "  - Node.js: ${GREEN}$NODE_VER${NC}"

# Check npm
if ! command -v npm &> /dev/null; then
    echo -e "${RED}⛔️ Error: npm is not installed. Please install npm first.${NC}"
    exit 1
fi
NPM_VER=$(npm -v)
echo -e "  - npm: ${GREEN}v$NPM_VER${NC}"

# Check Git
if ! command -v git &> /dev/null; then
    echo -e "${RED}⛔️ Error: Git is not installed. Please install Git first.${NC}"
    exit 1
fi
GIT_VER=$(git --version | cut -d' ' -f3)
echo -e "  - Git: ${GREEN}v$GIT_VER${NC}"

echo -e "${GREEN}✓ Diagnostics complete!${NC}\n"

# ------------------------------------------------------------------------------
# STEP 2: Install Project Dependencies & Build
# ------------------------------------------------------------------------------
echo -e "${BLUE}[Step 2/5] Installing Framework Dependencies & Compiling...${NC}"
npm install
npm run build
echo -e "${GREEN}✓ Dependencies successfully installed and compiled!${NC}\n"

# ------------------------------------------------------------------------------
# STEP 3: Setup LLM Environment Credentials
# ------------------------------------------------------------------------------
echo -e "${BLUE}[Step 3/5] Configuring Environment Credentials...${NC}"

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
                node -e "const fs = require('fs'); let c = fs.readFileSync('$DOTENV_PATH', 'utf8'); c = c.replace('OPENAI_API_KEY=', 'OPENAI_API_KEY=$API_KEY'); fs.writeFileSync('$DOTENV_PATH', c);"
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
                node -e "const fs = require('fs'); let c = fs.readFileSync('$DOTENV_PATH', 'utf8'); c = c.replace('DEEPSEEK_API_KEY=', 'DEEPSEEK_API_KEY=$API_KEY'); fs.writeFileSync('$DOTENV_PATH', c);"
                echo -e "    - DeepSeek API Key saved to .env."
            fi
            read -p "  🤖 Enter DeepSeek Model name (default: deepseek-chat): " DS_MODEL < /dev/tty
            SELECTED_MODEL=${DS_MODEL:-"deepseek-chat"}
            ;;
        gemini)
            read -p "  🔑 Enter Gemini API Key (or press Enter to skip): " API_KEY < /dev/tty
            if [ ! -z "$API_KEY" ]; then
                node -e "const fs = require('fs'); let c = fs.readFileSync('$DOTENV_PATH', 'utf8'); c = c.replace('GEMINI_API_KEY=', 'GEMINI_API_KEY=$API_KEY'); fs.writeFileSync('$DOTENV_PATH', c);"
                echo -e "    - Gemini API Key saved to .env."
            fi
            read -p "  🤖 Enter Gemini Model name (default: gemini-1.5-flash): " GEM_MODEL < /dev/tty
            SELECTED_MODEL=${GEM_MODEL:-"gemini-1.5-flash"}
            ;;
        anthropic)
            read -p "  🔑 Enter Anthropic API Key (or press Enter to skip): " API_KEY < /dev/tty
            if [ ! -z "$API_KEY" ]; then
                node -e "const fs = require('fs'); let c = fs.readFileSync('$DOTENV_PATH', 'utf8'); c = c.replace('ANTHROPIC_API_KEY=', 'ANTHROPIC_API_KEY=$API_KEY'); fs.writeFileSync('$DOTENV_PATH', c);"
                echo -e "    - Anthropic API Key saved to .env."
            fi
            read -p "  🤖 Enter Anthropic Model name (default: claude-3-5-sonnet-20241022): " ANT_MODEL < /dev/tty
            SELECTED_MODEL=${ANT_MODEL:-"claude-3-5-sonnet-20241022"}
            ;;
    esac
fi
echo -e "${GREEN}✓ Credentials configured successfully!${NC}\n"

# ------------------------------------------------------------------------------
# STEP 4: Build and Link CLI Globally
# ------------------------------------------------------------------------------
echo -e "${BLUE}[Step 4/5] Linking Aura CLI globally...${NC}"

# Link the executable command globally
if npm link; then
    echo -e "  - Global npm link successful."
else
    echo -e "${YELLOW}⚠️  Global linking requires permissions. Attempting sudo link...${NC}"
    if sudo npm link; then
        echo -e "  - Global npm link successful with sudo."
    else
        echo -e "${RED}⛔️ npm link failed. Please run: sudo npm link${NC}"
        exit 1
    fi
fi
echo -e "${GREEN}✓ CLI linked!${NC}\n"

# Apply selected LLM configurations globally
if [ ! -z "$SELECTED_PROVIDER" ]; then
    echo -e "  - Configuring global default LLM provider to ${GREEN}$SELECTED_PROVIDER${NC}..."
    node dist/bin/aura.js config llm.provider "$SELECTED_PROVIDER" --global > /dev/null
    if [ ! -z "$SELECTED_MODEL" ]; then
        echo -e "  - Configuring global default LLM model to ${GREEN}$SELECTED_MODEL${NC}..."
        node dist/bin/aura.js config llm.model "$SELECTED_MODEL" --global > /dev/null
    fi
    if [ ! -z "$SELECTED_BASE" ]; then
        echo -e "  - Configuring global default LLM API base to ${GREEN}$SELECTED_BASE${NC}..."
        node dist/bin/aura.js config llm.api_base "$SELECTED_BASE" --global > /dev/null
    fi
fi

# ------------------------------------------------------------------------------
# STEP 5: Verification Diagnostics
# ------------------------------------------------------------------------------
echo -e "${BLUE}[Step 5/5] Launching Aura Global Diagnostics...${NC}"

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
    echo -e "  - Running Doctor locally..."
    echo ""
    node dist/bin/aura.js doctor
    echo ""
    echo -e "${YELLOW}======================================================================${NC}"
    echo -e "⚠️  ${YELLOW}Installation successful, but shell profile reload might be required!${NC}"
    echo -e "   Please run: ${BLUE}source ~/.zshrc${NC} or open a new terminal."
    echo -e "   Then you can run: ${BLUE}aura new <project_name>${NC} anywhere!"
    echo -e "${YELLOW}======================================================================${NC}"
fi

exit 0
