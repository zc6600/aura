#!/bin/bash
# 01_file_search_mission.sh
# A mission where Aura must find a secret file and summarize it.

# Load helper
source "$(dirname "${BASH_SOURCE[0]}")/e2e_helper.sh"

PROJECT_NAME="tmp_mission_01"
PROJECT_PATH="$(pwd)/$PROJECT_NAME"

# 1. Cleanup and Init
log_step "Cleanup project path: $PROJECT_PATH"
rm -rf "$PROJECT_PATH"
aura_init "$PROJECT_NAME"

# 2. Sync Environment & Setup Config
log_step "Sync environment and set LLM provider/model"
aura_env_sync "$PROJECT_PATH"
aura_config_set "$PROJECT_PATH" "llm.provider" "openrouter"
aura_config_set "$PROJECT_PATH" "llm.model" "google/gemini-2.0-flash-001"

# 3. Setup the mission environment
log_step "Prepare knowledge files"
mkdir -p "$PROJECT_PATH/knowledge"
echo "This is the secret code: AURORA-77" > "$PROJECT_PATH/knowledge/secret.txt"
echo "Nothing here." > "$PROJECT_PATH/knowledge/trash.txt"

# 4. Run Mission
# Goal: "Read knowledge/secret.txt, extract the 'AURORA-XX' code, and write it to knowledge/mission_result.txt"
GOAL="Read knowledge/secret.txt, extract the 'AURORA-XX' code, and write it to knowledge/mission_result.txt"
e2e_init_log "$PROJECT_PATH" "$GOAL"
log_step "Run mission"
aura_run_mission "$PROJECT_PATH" "$GOAL" 5

# 5. Success Check
if [ -f "$PROJECT_PATH/knowledge/mission_result.txt" ]; then
    echo -e "\n${GREEN}[Check]${NC} mission_result.txt found!"
    log_step "Check passed: mission_result.txt found"
    cat "$PROJECT_PATH/knowledge/mission_result.txt" | tee -a "$E2E_LOG_FILE" >/dev/null
else
    echo -e "\n${RED}[Check]${NC} mission_result.txt NOT found."
    log_step "Check failed: mission_result.txt NOT found"
fi

# Cleanup (optional, keep for inspection if needed)
# rm -rf "$PROJECT_PATH"
