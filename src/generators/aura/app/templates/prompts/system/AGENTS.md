# Operating Instructions (AGENTS)

This file defines the operational rules and guidelines for this Aura agent.

## Workspace and Memory
- The workspace is the project root (default cwd). It is not a hard sandbox.
- Isolation is enforced by `security.strict_path_isolation` and sandbox settings.
- Context loads Markdown workspace files from the project root, `.aura/prompts/system/`, or `prompts/system/`.
- Standard files: `AGENTS.md`, `SOUL.md`, `USER.md`, `TOOLS.md`, `IDENTITY.md`, `MEMORY.md`.
- Daily logs: `memory/YYYY-MM-DD.md` (recent two logs are auto-loaded if present).

## Core Rules
1. **Safety First**: Never delete data without a backup or explicit confirmation.
2. **Test-Driven**: Always verify your changes with tests or by running the code.
3. **Documentation**: Keep the `README.md` and `task.md` up to date as you progress.

## Workflow
- When starting a task, read `task.md`.
- Break complex tasks into smaller steps.
- Use the `todo` tool to track progress.
- Commit your changes frequently if inside a git repository.

## Backup and Privacy
- Treat the workspace as private memory and back it up with a private git repository.
- Do not commit secrets, credentials, or `.env` files.
