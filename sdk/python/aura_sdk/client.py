import os
import shlex
import yaml
import subprocess
from pathlib import Path

class AuraClient:
    def __init__(self, workspace: Path, session_name: str = "default"):
        self.workspace = Path(workspace)
        self.session_name = session_name

    # --- CLI Command Generators (Useful for remote/containerized runners) ---

    def get_initialize_command(self) -> str:
        """Get the shell command to initialize Aura workspace"""
        return "aura new ."

    def get_run_loop_command(self, goal: str, max_steps: int = 30) -> str:
        """Get the shell command to run the Aura kernel agent loop"""
        escaped = shlex.quote(goal)
        return f"aura kernel loop --goal {escaped} --max-steps {max_steps}"

    def get_config_update_command(self, provider: str, model: str) -> str:
        """Get the inline Node.js shell command to update llm configuration in config.yml"""
        return (
            f"node -e '"
            f"const fs = require(\"fs\"); "
            f"let config_path = \".aura-workspace/config/config.yml\"; "
            f"if (!fs.existsSync(config_path)) {{ config_path = \".aura/config/config.yml\"; }} "
            f"let c = fs.readFileSync(config_path, \"utf8\"); "
            f"c = c.replace(/provider:\\s*[^\\n]+/g, \"provider: \\\"{provider}\\\"\"); "
            f"c = c.replace(/model:\\s*[^\\n]+/g, \"model: \\\"{model}\\\"\"); "
            f"fs.writeFileSync(config_path, c);'"
        )

    # --- Local Execution Methods (Executes on the local host machine) ---

    def initialize(self):
        """Initialize workspace locally on the host"""
        subprocess.run(self.get_initialize_command(), shell=True, cwd=str(self.workspace), check=True)

    def run_loop(self, goal: str, max_steps: int = 30) -> subprocess.CompletedProcess:
        """Run agent loop locally on the host"""
        env = os.environ.copy()
        env["AURA_SESSION_NAME"] = self.session_name
        return subprocess.run(self.get_run_loop_command(goal, max_steps), shell=True, cwd=str(self.workspace), env=env, check=True)

    def update_config(self, provider: str, model: str):
        """Update workspace configuration file directly on the host"""
        config_path = self.workspace / ".aura-workspace" / "config" / "config.yml"
        if not config_path.exists():
            config_path = self.workspace / ".aura" / "config" / "config.yml"
        if not config_path.exists():
            # Fallback to current directory config.yml if not found
            config_path = self.workspace / "config.yml"
            
        with open(config_path, 'r') as f:
            cfg = yaml.safe_load(f) or {}
            
        cfg["llm"] = cfg.get("llm") or {}
        cfg["llm"]["provider"] = provider
        cfg["llm"]["model"] = model
        
        with open(config_path, 'w') as f:
            yaml.safe_dump(cfg, f)
