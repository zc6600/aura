#!/bin/bash
# e2e_helper.sh - Core utilities for E2E testing

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
AURA_BIN="$REPO_ROOT/bin/aura"

# Init log file for a project and goal
e2e_init_log() {
    local project_path="$1"
    local goal="$2"
    mkdir -p "$(dirname "$project_path")/test/logs"
    export E2E_LOG_FILE="$(dirname "$project_path")/test/logs/$(basename "$project_path")_context.log"
    echo "=== Mission Start: $goal ===" > "$E2E_LOG_FILE"
}

# Write a one-line step to log and console
log_step() {
    local msg="$1"
    local ts=$(date "+%Y-%m-%d %H:%M:%S")
    echo -e "${BLUE}[Step]${NC} $msg"
    if [[ -n "$E2E_LOG_FILE" ]]; then
        echo "[Step $ts] $msg" >> "$E2E_LOG_FILE"
    fi
}

# Initialize a new project
aura_init() {
    local name="$1"
    log_step "Initialize project: $name"
    "$AURA_BIN" new "$name" --skip-bundle
}

# Sync .env to test project
aura_env_sync() {
    local project_path="$1"
    log_step "Sync .env to $project_path"
    cp ".env" "$project_path/.env"
}

# Set config in project using a ruby snippet
aura_config_set() {
    local project_path="$1"
    local key="$2"
    local value="$3"
    log_step "Set config $key = $value"
    
    ruby -ryaml -e "
    config_path = File.join('$project_path', 'config', 'config.yml')
    data = YAML.load_file(config_path)
    keys = '$key'.split('.')
    target = data
    keys[0...-1].each { |k| target = (target[k] ||= {}) }
    target[keys.last] = (begin; Integer('$value'); rescue; '$value'; end)
    File.write(config_path, data.to_yaml)
    "
}

# Run a mission loop
aura_run_mission() {
    local project_path="$1"
    local goal="$2"
    local max_turns="${3:-5}"
    
    [[ -z "$E2E_LOG_FILE" ]] && e2e_init_log "$project_path" "$goal"
    log_step "Mission goal: $goal"
    log_step "Max turns: $max_turns"

    for ((i=1; i<=max_turns; i++)); do
        # 1. Plan
        echo -e "\n--- Turn $i ---"
        local plan_json=$("$AURA_BIN" kernel plan "$project_path" -g "$goal" -n 200)
        
        if [[ -z "$plan_json" ]]; then
           echo -e "${RED}[Error]${NC} Failed to get plan."
           break
        fi

        # Log full context for analysis
        echo -e "\n--- Turn $i Context ---" >> "$E2E_LOG_FILE"
        echo "$plan_json" | ruby -rjson -e 'puts JSON.parse(STDIN.read)["context_preview"]' 2>/dev/null >> "$E2E_LOG_FILE"
        echo -e "\n--- Turn $i Plan ---" >> "$E2E_LOG_FILE"
        echo "$plan_json" | ruby -rjson -e 'puts JSON.parse(STDIN.read)["plan"].to_json' 2>/dev/null >> "$E2E_LOG_FILE"

        # Check for stop signal in plan
        if [[ $plan_json == *"\"stop\""* ]] || [[ $plan_json == *"stop mission"* ]]; then
            echo -e "${GREEN}[Aura Mission]${NC} Mission accomplished (or stopped by LLM)."
            break
        fi
        
        # 2. Extract call from plan
        local plan_obj=$(echo "$plan_json" | ruby -rjson -e 'print JSON.parse(STDIN.read)["plan"].to_json' 2>/dev/null)
        local plan_type=$(echo "$plan_obj" | ruby -rjson -e 'print JSON.parse(STDIN.read)["type"]' 2>/dev/null)
        
        if [[ "$plan_type" != "tool_call" ]]; then
           local content=$(echo "$plan_obj" | ruby -rjson -e 'print JSON.parse(STDIN.read)["content"]' 2>/dev/null)
           echo -e "${BLUE}[Aura Mission]${NC} Planner returned text. Content: $content"
           continue
        fi

        log_step "Execute plan: $plan_obj"
        
        # 3. Execute
        local result=$("$AURA_BIN" kernel once "$project_path" -c "$plan_obj" -n 200)
        log_step "Result: $result"
    done
}
