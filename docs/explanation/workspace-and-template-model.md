# Workspace and Template Model

Aura separates user project files from agent runtime files, and separates framework templates from per-project copies. Most update behavior follows from that split.

## The Three Places

| Place | Path | Role |
|-------|------|------|
| User workspace | `<project>/` | The user's repository or working directory |
| Aura environment | `<project>/.aura-workspace/` | Project-local config, tools, skills, state, and template Git repo |
| Global template repo | `~/.aura-framework/repo` | Source templates cloned into new workspaces |

The legacy hidden directory `.aura/` is still recognized as a fallback by path resolution.

## What `aura new` Does

`aura new [path]` initializes a workspace in place:

1. Ensures the global template repo exists.
2. Clones `~/.aura-framework/repo` into `<project>/.aura-workspace/`.
3. Configures Git identity inside `.aura-workspace/`.
4. Copies the global template config into `.aura-workspace/config/config.yml`.
5. Adds `.aura-workspace/` to the parent `.gitignore`.
6. Adds runtime DB ignore rules inside `.aura-workspace/.gitignore`.
7. Registers the project in the global project registry.
8. Writes `project_name` into the workspace config when possible.

The user's normal source files stay in `<project>/`; the Aura environment is hidden and separately versioned.

## Why `.aura-workspace/` Is a Git Repo

The hidden environment is cloned from the global template repo. That lets Aura use normal Git mechanics for template updates:

- `aura status` shows changes inside `.aura-workspace/`.
- `aura add` stages files inside `.aura-workspace/`.
- `aura commit` commits environment changes.
- `aura sync` pushes local environment changes back to `~/.aura-framework/repo`.
- `aura pull` pulls template updates from the global repo into the active workspace environment.

This Git repo is not the user's application repository. It tracks Aura environment content.

## Template Sync vs Workspace Update

Template sync updates the global template repo from the framework package:

```bash
aura template sync
```

Workspace update pulls or merges those global templates into existing workspaces:

```bash
aura pull
aura update current
aura update merge
aura update all
```

Use `aura template sync` after updating the framework templates. Use workspace update commands to apply those template changes to projects.

## Config Preservation

Several update paths back up `config/config.yml` before pulling or replacing template files, then restore and merge it afterward. This prevents framework template updates from casually overwriting project-specific LLM, security, and runtime settings.

## Tools and Skills Placement

Current code scans both workspace-root and environment paths for tools:

```text
<project>/tools/
<project>/.aura-workspace/tools/
```

The `aura tools add`, `aura tools install`, and `aura tools generate_group` commands currently write to `<project>/tools/`. Skill installation writes to `<project>/skills/`, while skill listing also considers template skills from `~/.aura-framework/repo/skills`.

That mixed model is important when debugging "installed but not visible" issues: check both the workspace root and `.aura-workspace/`.

See [Work with Templates and Updates](../how-to/work-with-templates-and-updates.md) for commands.
