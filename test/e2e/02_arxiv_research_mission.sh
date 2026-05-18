#!/bin/bash
# 02_arxiv_research_mission.sh
# A high-level mission where Aura must autonomously create an arXiv tool and use it.

# Load helper
source "$(dirname "${BASH_SOURCE[0]}")/e2e_helper.sh"

PROJECT_NAME="tmp_mission_02"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PROJECT_PATH="$REPO_ROOT/$PROJECT_NAME"

# 1. Cleanup and Init
log_step "Cleanup project path: $PROJECT_PATH"
rm -rf "$PROJECT_PATH"
aura_init "$PROJECT_NAME"

# 2. Sync Environment & Setup Config
log_step "Sync environment and set LLM provider/model"
aura_env_sync "$PROJECT_PATH"
aura_config_set "$PROJECT_PATH" "llm.provider" "openrouter"
aura_config_set "$PROJECT_PATH" "llm.model" "google/gemini-2.0-flash-001"

# 3. Run Mission
# Goal: "1. Create a new tool called 'arxiv' that can search for papers using ArXiv API (http://export.arxiv.org/api/query). 2. Use it to find 5 AI agent memory related survey/review papers. 3. Summarize them in research_report.md."
# Note: Use relative paths like 'tools/arxiv/manifest.json' to avoid security blocks.
GOAL="1. Create a new tool called 'arxiv' that can search for papers using ArXiv API. 2. Use it to find 5 AI agent memory related survey/review papers. 3. Summarize their titles and URLs in knowledge/research_report.md. IMPORTANT: Use relative paths for creating tool files (e.g. tools/arxiv/manifest.json)."
e2e_init_log "$PROJECT_PATH" "$GOAL"

# We give it more turns for tool creation
log_step "Run mission"
aura_run_mission "$PROJECT_PATH" "$GOAL" 20

# 4. Success Check
if [ -f "$PROJECT_PATH/knowledge/research_report.md" ]; then
    echo -e "\n${GREEN}[Check]${NC} research_report.md found!"
    log_step "Check passed: research_report.md found"
    cat "$PROJECT_PATH/knowledge/research_report.md" | tee -a "$E2E_LOG_FILE" >/dev/null
else
    echo -e "\n${RED}[Check]${NC} research_report.md NOT found."
    log_step "Check failed: research_report.md NOT found"
fi
