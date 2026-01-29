# Aura OS

Aura OS is an AI-native operating system that treats the filesystem as an agent's workspace and extended memory. Instead of relying solely on linear prompt history, Aura OS enables agents to reason, persist, and collaborate through structured files and tools.

## Overview

- **Folder-as-a-Workspace**: Agents operate by reading and writing to project files, using directories to organize capabilities and knowledge.
- **Ruby Kernel (Host)**: A daemon that monitors `tools/` and `knowledge/`, orchestrates processes across runtimes (Python, Ruby, Shell), and enforces security.
- **Tool Protocol**: Each capability is a self-contained directory with `logic.py`, `manifest.json`, and `test.py`. Tools become Active only after tests pass.
- **State & Metabolism**: Persistent events in SQLite (`state/aura_state.db`) with background summarization when `config.yml` exceeds `max_state_chars`.
- **Hint System**: Automatic discovery of `.hint` files and `AURA_README.md` to inject context without bloating prompts.

## Documentation

- Architecture: `aura/docs/ARCHITECTURE.md`
- Tool Protocol: `aura/docs/TOOL_PROTOCOL.md`
- State Management: `aura/docs/STATE_MANAGEMENT.md`
- Security Model: `aura/docs/SECURITY.md`
- Deep Design Doc (Part I: Kernel & Semantic Space) in `aura/docs/ARCHITECTURE.md`
- Deep Design Doc (Part II: State Metabolism & Persistent Memory) in `aura/docs/STATE_MANAGEMENT.md`
- Deep Design Doc (Part III: Execution Engine & Security Sandbox) in `aura/docs/SECURITY.md`
 - Testing Strategy (TDD): `aura/docs/TESTING.md`

## Quick Start

```bash
git clone https://github.com/your-repo/aura.git
cd aura/aura
bundle install
```

- Place tools under `tools/[tool_name]/` with `logic.py`, `manifest.json`, and `test.py`.
- Add read-only reference material to `knowledge/`.
- Define runtime and permissions in `manifest.json`.
- Provide environment hints via `.hint` files and `AURA_README.md`.
- Configure state limits with `config.yml` (e.g., `max_state_chars`).

## Activation Flow

- Creation: Author `logic.py` and `test.py` inside a tool directory.
- Verification: Kernel executes `test.py` and captures stderr on failure for iterative fixes.
- Activation: Tool is marked Active only when `test.py` exits with code `0`.

## Developer Priorities (Part I)

- Build Ruby watcher daemon with debounce and directory locking.
- Implement `.hint` scanning and prompt composition (implicit sensing and navigation).
- Define Draft→Active tool state machine with failure feedback and dependency healing.

## Developer Priorities (Part II)

- Implement Ruby SQLite data-access layer and transactions.
- Build metabolism scheduler to monitor `config.max_state_chars` and trigger summarization.
- Create prompt templating to compose `[Summary] + [Active Window Logs] + [Variables]`.

## Developer Priorities (Part III)

- Implement runtime wrapper and interpreter routing from `manifest.runtime` and file extension.
- Add dependency management for Python (`.venv`, `pip`) and Ruby (`bundle`).
- Enforce path sanitization and permissions; structure error feedback via `Open3`.

## Contributing

Contributions are welcome. Please open issues or Pull Requests for improvements to the kernel, tooling, protocol, and documentation.

## License

Licensed under the MIT License.
