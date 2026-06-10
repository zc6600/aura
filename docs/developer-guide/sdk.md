# Aura Python SDK

The Aura Python SDK provides a first-class programmatic interface to control Aura workspaces, LLM configurations, and execution loops from Python applications. It decouples the core framework logic from target environments (such as Docker containers or local runner scripts).

The SDK is located under the [sdk/python/aura_sdk/](file:///Users/frank/Desktop/Towards%20AGI/aura/aura/sdk/python/aura_sdk/) directory.

---

## 1. SDK Class & API Reference

The primary entry point is the class [AuraClient](file:///Users/frank/Desktop/Towards%20AGI/aura/aura/sdk/python/aura_sdk/client.py#L7), defined in [client.py](file:///Users/frank/Desktop/Towards%20AGI/aura/aura/sdk/python/aura_sdk/client.py).

### Constructor

```python
AuraClient(workspace: Path, session_name: str = "default")
```

*   **`workspace`**: The directory path (`Path` object) of the Aura project workspace.
*   **`session_name`**: The current session context name (defaults to `"default"`).

---

### Command Generators (Remote & Sandbox Environments)

These methods return shell command strings. They are designed for situations where the SDK runs outside the execution sandbox (e.g. on a host machine generating commands to be executed inside a Docker container).

#### `get_initialize_command() -> str`
Returns the shell command to bootstrap a new Aura workspace.
*   **Command**: `aura new .`

#### `get_run_loop_command(goal: str, max_steps: int = 30) -> str`
Returns the shell command to launch the autonomous agent's loop solver.
*   **Command**: `aura kernel loop --goal <escaped_goal> --max-steps <max_steps>`

#### `get_config_update_command(provider: str, model: str) -> str`
Returns an inline Node.js command string that modifies `.aura/config/config.yml` inside the sandbox to route LLM queries to the target provider/model.
*   **Command**: `node -e '...'`

---

### Local Execution Methods (Host Machine)

These methods execute subprocesses or modify files directly on the host machine.

#### `initialize()`
Invokes the initialization command locally in the target workspace context.
*   **Action**: Calls `subprocess.run("aura new .", shell=True, cwd=self.workspace, check=True)`

#### `run_loop(goal: str, max_steps: int = 30) -> subprocess.CompletedProcess`
Executes the solver loop locally on the host machine.
*   **Action**: Runs `aura kernel loop` (which maps to `aura agent --goal` in the TS implementation) with the requested goal.

#### `update_config(provider: str, model: str)`
Directly parses, updates, and serializes the YAML configuration file (`.aura/config/config.yml`) under the workspace.

---

## 2. Integration with Terminal Bench (Ruby Reference)

The Python SDK is also utilized for automated agent evaluation. The evaluation harness `test_terminal_bench_cli.rb` (located in the Ruby implementation repository `aura-rb`) utilizes the Python SDK through an adapter class.

```
┌────────────────────────────────────────────────────────┐
│             test_terminal_bench_cli.rb (Ruby)          │
└───────────────────────────┬────────────────────────────┘
                            │ (Runs Minitest on Host)
                            ▼
┌────────────────────────────────────────────────────────┐
│               Docker / Terminal Bench                  │
│  - Executes setup.sh to compile & install              │
│    the Aura package inside Docker container            │
└───────────────────────────┬────────────────────────────┘
                            │ (Launches Container)
                            ▼
┌────────────────────────────────────────────────────────┐
│                      aura_agent.py                     │
│  - Appends sdk/python to PYTHONPATH                    │
│  - Imports AuraClient                                  │
│  - Configures workspace using client.update_config     │
│  - Solves benchmark task using client.run_loop         │
└────────────────────────────────────────────────────────┘
```

### Module Mapping & PYTHONPATH
When running `terminal-bench`, python modules must be resolved properly within the container:
1.  Both `test/eval` and `sdk/python` are appended to the container's `PYTHONPATH`.
2.  The benchmark agent runner identifies the wrapper module as `aura_agent:AuraAgent` rather than passing full absolute paths.

---

## 3. Propagation of LLM Credentials

Because evaluation runs inside isolated Docker container sandboxes, host environment variables do not map automatically.

### Mapped Environment Keys
The adapter class `AuraAgent` extracts key variables from the host's `.env` configuration and passes them downstream to the container runner environment:
*   `AURA_LLM_API_KEY`: Aura's unified API key mapping.
*   `OPENROUTER_API_KEY`: OpenRouter gateway authentication.
*   `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`: Model provider keys.

---

## See Also
*   [Testing & CI/CD Guide](testing.md) - Full guide on tests and benchmarks.
*   [Configuration System](../user-guide/configuration.md) - Configuration details of `config.yml`.
