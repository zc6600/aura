# Configuration Reference

This reference summarizes the Aura config schema as defined in `src/utils/configSchema.ts`.

Config files normally live at:

- Global template config: `~/.aura-framework/repo/config/config.yml`
- Workspace config: `<project>/.aura-workspace/config/config.yml`

The legacy `.aura/config/config.yml` path is still recognized by path resolution.

## Root Sections

| Section | Purpose |
|---------|---------|
| `system` | Loop and error limits |
| `llm` | LLM provider, model, retry, token, and fallback settings |
| `tool_protocol` | Tool timeout, runtime, output, and dependency settings |
| `security` | Path isolation, sandbox, and snapshot settings |
| `state_management` | Memory, retention, and summarization settings |
| `context_compression` | Event trimming and summary trimming settings |
| `ralph` | Ralph autonomous loop settings |
| `hints` | Hint scanning and injection limits |
| `embedding` | Embedding provider settings |
| `image_generation` | Image-generation provider settings |
| `knowledge_db` | Knowledge DB storage settings |
| `directory_tree` | Directory tree scan limits |

Unknown extra keys are currently allowed by the schema.

## `system`

| Key | Type | Notes |
|-----|------|-------|
| `max_steps` | positive integer | Default loop limit when used by runtime code |
| `max_format_errors` | positive integer | Tolerated response-format failures |
| `max_tool_errors` | positive integer | Tolerated tool failures |

## `llm`

| Key | Type | Notes |
|-----|------|-------|
| `provider` | string | Defaults to `local` in schema |
| `api_base` | string | Optional custom endpoint |
| `api_key` | string | Supported by schema, but CLI warns against storing secrets here |
| `api_key_env` | string | Environment variable name for the provider key |
| `model` | string | Provider model name |
| `temperature` | number 0-2 | Sampling temperature |
| `max_tokens` | positive integer | Output token cap |
| `max_retries` | nonnegative integer | Provider retry count |
| `fallbacks` | array | Ordered fallback providers |
| `backup` | object | Legacy singular fallback provider |

Fallback provider objects support `provider`, `api_base`, `api_key`, `api_key_env`, `model`, and `max_retries`.

## `tool_protocol`

| Key | Type | Notes |
|-----|------|-------|
| `default_timeout_seconds` | positive number | Schema default `300` |
| `max_timeout_seconds` | positive number | Schema default `1200` |
| `agent_can_modify_timeout` | boolean | Schema default `true` |
| `runtimes` | map string to string | Runtime command mapping |
| `call_output.max_chars` | positive integer | Tool output truncation cap |
| `call_output.head_ratio` | number 0-1 | Head/tail truncation split |
| `bash.base_wait_seconds` | positive number | Bash wait behavior |
| `call_summary.max_chars` | positive integer | Tool-call summary cap |
| `allow_dependency_install` | boolean | Whether tools may install dependencies |
| `test_timeout` | positive number | Test helper timeout |
| `required_files` | string array | Required workspace files |

## `security`

| Key | Type | Notes |
|-----|------|-------|
| `strict_path_isolation` | boolean | Schema default `false` |
| `forbidden_extensions` | string array | Extensions blocked by policy |
| `read_only_directories` | string array | Directories treated as read-only |
| `git_snapshots` | boolean | Schema default `false` |
| `sandbox.enabled` | boolean | Schema default `false` |
| `sandbox.provider` | `docker` or `local` | Optional sandbox backend |
| `sandbox.image` | string | Optional Docker image |

## `state_management`

| Key | Type | Notes |
|-----|------|-------|
| `database_type` | string | Usually `sqlite` |
| `db_path` | string | Legacy escape hatch; normal sessions use `state/sessions/<session>.db` |
| `max_state_chars` | positive integer | Maximum retained state characters |
| `keep_last_summary_n_steps` | positive integer | Summary retention window |
| `recent_events_n` | positive integer | Recent event window |
| `summarization.enabled` | boolean | Enable summaries |
| `summarization.max_chars` | positive integer | Summary character cap |
| `summarization.model` | string | Optional summarization model |
| `summarization.focus_on` | string array | Summary focus fields |
| `retention` | object | Per-event retention policy |

## `context_compression`

| Key | Type | Notes |
|-----|------|-------|
| `event_max_chars` | nonnegative integer | Per-event size cap |
| `event_min_count_threshold` | nonnegative integer | Minimum event count before compression |
| `summary_trim_step` | nonnegative integer | Summary trimming step |

## `ralph`

| Key | Type | Notes |
|-----|------|-------|
| `max_steps` | positive integer | Ralph loop step cap |
| `timeout` | positive number | Ralph timeout |
| `verify_command` | string | Physical verification command |
| `use_critic` | boolean | Enable critic audit |
| `critic_mode` | `light` or `heavy` | Critic execution depth |

## `hints`

| Key | Type | Notes |
|-----|------|-------|
| `auto_inject_readme` | boolean | README hint behavior |
| `scan_dot_hint_files` | boolean | Scan `.hint` sidecar files |
| `include_error_traceback` | boolean | Include error traces |
| `max_hint_chars` | positive integer | Hint size cap |
| `max_file_chars` | positive integer | File content cap |
| `max_scan_lines` | positive integer | Scan line cap |
| `ignore_list` | string array | Hint ignore list |

## Provider Auxiliaries

`embedding`, `image_generation`, `knowledge_db`, and `directory_tree` are optional sections.

| Section | Keys |
|---------|------|
| `embedding` | `provider`, `model`, `api_base`, `api_key_env` |
| `image_generation` | `provider`, `model`, `size`, `api_key_env` |
| `knowledge_db` | `storage` |
| `directory_tree` | `max_depth`, `max_files_per_dir` |

See [Configuration Model](../explanation/configuration-model.md) for how these settings interact with `.env` and [Configure Aura](../how-to/configure-aura.md) for commands.
