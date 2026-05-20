# Skills

Skills are reusable workflow playbooks. A skill is not a single executable capability; instead it describes a multi-step process that composes tools.

## Layout

A skill follows the standard structure defined in the [Anthropic Skill Guide]:

```text
skills/
├── system.md                 # Global operating protocol for the agent
├── skills.md                 # Skills index
└── <skill_name>/             # A single skill package
    ├── SKILL.md              # Core playbook (Required)
    ├── scripts/              # Executable scripts (Python/Bash) for complex logic (Optional)
    ├── references/           # Documentation and knowledge files (Optional)
    └── assets/               # Static assets (templates, icons, etc.) (Optional)
```

## Authoring a Skill

Create a directory under `skills/` and add `SKILL.md`.

### Minimal Frontmatter

```yaml
---
name: my-skill
description: What this skill is for.
requires:
  - read_file
  - write_file
---
```

### Recommended Structure (SKILL.md)

Your `SKILL.md` should follow this structure to ensure consistent execution:

```markdown
# [Skill Name]

## When to use
Describe the specific scenarios or user intents that should trigger this skill.

## Inputs / Preconditions
List what information or state is required before starting.

## Steps
1. First step...
2. Second step...

## Failure modes and recovery
- **If X fails**: Do Y.
- **If Z is missing**: Ask the user for W.

## Expected outputs / Artifacts
Describe what the user will receive at the end.
```

## Tool vs Skill

- **Tool**: one atomic, reusable, testable capability callable by the Kernel (e.g., `read_file`, `search_web`).
- **Skill**: a workflow that orchestrates multiple tools and decisions to achieve a complex goal.

## Progressive Disclosure

- **Level 1 (Frontmatter)**: Loaded into the System Prompt. Keeps the context light.
- **Level 2 (SKILL.md)**: Loaded when the skill is triggered. Contains the main logic.
- **Level 3 (Linked files)**: Files in `references/` or `scripts/` are accessed only when explicitly needed by the skill steps.
