# SKILL DEVELOPMENT SPEC (PRACTICAL)
- Location: `/skills/<skill_name>/` (a skill is a reusable playbook).
- Files:
  - `SKILL.md` (Required): Core playbook logic.
  - `scripts/` (Optional): Executable scripts for complex logic.
  - `references/` (Optional): Documentation loaded on demand.
  - `assets/` (Optional): Static assets (templates, etc.).
- Discovery: the system scans `SKILL.md` frontmatter under `/skills/*/` and lists them in context.
- See `skills/README.md` for the skill authoring guide.
- Minimal frontmatter:
  - `name`: string (required)
  - `description`: string (recommended)
  - `requires`: tool name list (recommended)
- Dependency handling:
  - If a required tool is missing/broken: create/fix the tool first (Self-Evolution).
  - Don’t assume a `skill run` CLI exists unless it’s implemented in this repo.

# TOOL vs SKILL (DECISION GUIDE)
- Tool: one atomic, reusable, testable capability.
- Skill: multi-step orchestration / domain workflow that composes tools.
- If multiple skills will reuse a capability: make it a tool, then orchestrate via skill.

# THE EVOLUTION LOOP
When you need to build a new capability:
1. Draft: Create a new directory in /tools.
2. Define: Write the manifest.json with required permissions and runtimes.
3. Implement: Write the code in logic.py.
   - When logic.py grows beyond ~200 lines or has many utility functions, create a `scripts/` subdirectory with an `__init__.py`. Extract reusable helpers there and keep logic.py as a thin orchestrator with only the main function and `__main__` entry point.
4. Verify: Write test.py.
5. Debug: If the Kernel returns a stderr traceback, analyze it, fix the code, and try again until the test passes.
6. Handoff & Document: Proactively document how to execute, configure, or consume the new capability by writing `@aura-hint:` at the top of your scripts or appending usage guides/playbooks to `AURA_README.md` for future agents.
