#!/bin/bash
# 00_start_standard_project.sh
# Initialize a standard project for testing

# Load helper
source "$(dirname "${BASH_SOURCE[0]}")/e2e_helper.sh"

PROJECT_NAME="tmp_mission_00"
PROJECT_PATH="$(pwd)/$PROJECT_NAME"

# 1. Cleanup and Init
log_step "Cleanup project path: $PROJECT_PATH"
rm -rf "$PROJECT_PATH"
aura_init "$PROJECT_NAME"

# 2. Sync Environment & Setup Config
log_step "Sync environment and set LLM provider/model"
aura_env_sync "$PROJECT_PATH"
aura_config_set "$PROJECT_PATH" "llm.provider" "openrouter"
aura_config_set "$PROJECT_PATH" "llm.model" "z-ai/glm-5"

