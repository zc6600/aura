# Configuration System Modifications: Ruby to TypeScript

This document records the architectural details and modifications made to the configuration system of Aura OS during the migration from Ruby to TypeScript.

## Architectural Mapping

| Ruby Module/Method | TypeScript Equivalent | File Path |
| :--- | :--- | :--- |
| `Aura::ConfigLoader.load` | `ConfigManager.load` | [configManager.ts](file:///Users/frank/Desktop/Towards%20AGI/aura/aura/src/utils/configManager.ts) |
| `Aura::ConfigLoader.load_with_fallback` | `ConfigManager.loadWithFallback` | [configManager.ts](file:///Users/frank/Desktop/Towards%20AGI/aura/aura/src/utils/configManager.ts) |
| `Aura::PathResolver.resolve_config_path` | `PathResolver.resolveConfigPath` | [pathResolver.ts](file:///Users/frank/Desktop/Towards%20AGI/aura/aura/src/utils/pathResolver.ts) |
| `get_hash_value` (dot-notation) | `ConfigManager.get` | [configManager.ts](file:///Users/frank/Desktop/Towards%20AGI/aura/aura/src/utils/configManager.ts) |
| `set_hash_value` (dot-notation & type coercion) | `ConfigManager.set` | [configManager.ts](file:///Users/frank/Desktop/Towards%20AGI/aura/aura/src/utils/configManager.ts) |
| Custom File writes | `ConfigManager.write` | [configManager.ts](file:///Users/frank/Desktop/Towards%20AGI/aura/aura/src/utils/configManager.ts) |

## Key Improvements & Differences

### 1. Library Differences
*   **Ruby**: Relied on standard library `yaml` (using psych parser) and `json` gems.
*   **TypeScript**: Uses the NPM **`yaml`** library which yields superior AST manipulation capabilities.

### 2. Auto Type Coercion
When updating settings (e.g., `aura config llm.temperature 0.8`), the TypeScript `ConfigManager.set` automatically parses the string representation:
*   `"true"` / `"false"` ➔ `boolean`
*   `"12"` ➔ `number` (integer)
*   `"0.8"` ➔ `number` (float)
*   Other inputs remain `string`.

This mimics Thor's command-line string-to-type parsing accurately and keeps configuration values clean without polluting YAML types.

### 3. Error Classification
Custom exception sub-classes were created to match Ruby's error behavior:
*   `ConfigError`: Parent error class.
*   `FileNotFoundError`: Thrown when config required = true and path is missing.
*   `ParseError`: Thrown when the YAML structure is malformed.
