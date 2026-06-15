# Configuration Model

Aura configuration is split between structured YAML config and environment variables. YAML controls behavior. `.env` and process environment variables carry secrets and provider credentials.

## Configuration Locations

Aura has two normal config scopes:

| Scope | Location | Purpose |
|-------|----------|---------|
| Global template config | `~/.aura-framework/repo/config/config.yml` | Defaults copied into future workspaces and used by template operations |
| Workspace config | `<project>/.aura-workspace/config/config.yml` | Project-specific runtime behavior |

The current CLI also supports the legacy `.aura/config/config.yml` layout as a fallback in path resolution.

Use `aura config <key> <value> --global` for the global template config. Use `aura config <key> <value>` inside a workspace for workspace config.

## Environment Locations

Secrets should be stored outside `config.yml`.

| Scope | Location | Command |
|-------|----------|---------|
| Global env | `~/.aura-framework/.env` | `aura env set KEY VALUE --global` |
| Local env | `<current-directory>/.env` | `aura env set KEY VALUE` |
| Process env | Shell environment | `export KEY=VALUE` |

The local `aura env set` command writes to the current directory's `.env`. Run it from the project root when you want the workspace `.env`.

## Provider Detection

LLM provider detection is environment-driven. The user-facing docs currently describe this priority:

1. `OPENROUTER_API_KEY`
2. `OPENAI_API_KEY`
3. `ANTHROPIC_API_KEY`
4. Local/offline provider fallback

Manual `llm` settings in `config.yml` can override automatic defaults. API keys should remain in `.env` or process environment variables.

## Dot-Notation Writes

`aura config` uses dot notation:

```bash
aura config llm.provider openai
aura config llm.model gpt-4o
aura config security.strict_path_isolation true
```

Values are parsed into simple scalar types:

- `true` and `false` become booleans.
- Integer-looking values become integers.
- Decimal-looking values become floats.
- Other values remain strings.

`llm.api_key` is intentionally rejected by the CLI because secrets belong in `.env`.

## Runtime State Is Session-Aware

Current session databases live under:

```text
.aura-workspace/state/sessions/<session>.db
```

The `state_management.db_path` config key still exists as a legacy escape hatch in the schema, but normal runtime code resolves session paths with `PathResolver.sessionDbPath()`. Leave `db_path` unset unless you are working on compatibility or a specialized state-store path.

## How to Think About Precedence

For normal use:

1. Start with template defaults in `~/.aura-framework/repo/config/config.yml`.
2. Copy those defaults into `.aura-workspace/config/config.yml` when the workspace is created.
3. Apply workspace-specific YAML overrides.
4. Load secrets from local/global/process environment.
5. Let runtime session selection choose the active SQLite database.

This means updating global config does not automatically rewrite every existing workspace config. Use template/update workflows when you need to propagate template changes.

See [Configure Aura](../how-to/configure-aura.md) for commands and [Configuration Reference](../reference/configuration.md) for the schema.
