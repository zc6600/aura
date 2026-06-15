# CLI Refactoring History

**Note**: This is a development log, not user documentation.

---

## Refactoring Summary

### Files Structure

**Before**:
A single monolithic command file or legacy structure.

**After (TypeScript/Clipanion System)**:
```
src/cli/commands/
├── branch.ts        # Manage agent profiles
├── chat.ts          # Start an interactive chat or run a single prompt
├── config.ts        # CLI and workspace configuration
├── dashboard.ts     # Developer UI dashboard
├── doctor.ts        # Health check utility
├── env.ts           # Manage environment variables
├── garden.ts        # Execute Garden playbooks
├── git.ts           # Git helper integration
├── hints.ts         # Agent hint scanning and toggles
├── info.ts          # Display workspace information
├── kernel.ts        # Core loop and agent planning/observing execution
├── project.ts       # Project registration and sandbox management
├── session.ts       # Active conversation session state
├── skills.ts        # Skill playbooks installer
├── template.ts      # Update and sync framework templates
├── tools.ts         # Install, update, and manage tools
└── update.ts        # Update sub-commands (framework, all, current, status, merge)
```

---

## Command Families & Features

### 1. Update Command Family

```
aura update
├── framework     # Update the framework package
├── all           # Batch update all sub-projects
├── merge         # Smart merge templates (with conflict resolution)
├── status        # View update status
└── current       # Update current workspace templates
```

**Core Features**:
- ✅ Framework path auto-detection
- ✅ Batch update all registered projects
- ✅ Smart merge options
- ✅ Update status visualization
- ✅ Error statistics and reporting

### 2. Template Command Family

```
aura template
├── sync          # Sync framework templates to global repo
├── status        # View sync status
└── diff          # Compare template differences
```

**Core Features**:
- ✅ Auto-backup user custom changes
- ✅ Git history preservation
- ✅ Template difference comparison
- ✅ Safe sync mechanism

---

## Architecture Design Principles

### 1. Single Responsibility (SRP)

Each command class handles only one functional domain (e.g. `UpdateFrameworkCommand` handles only updating).

### 2. Command Composition

Using Clipanion's nested path routing:

```typescript
class UpdateFrameworkCommand extends BaseCommand {
  static paths = [['update', 'framework']];
  ...
}
```

### 3. Progressive Refactoring

- ✅ Keep existing CLI paths fully backward compatible
- ✅ No impact on other modules (e.g. LLM client or database layers)
- ✅ Standardized error mapping via `CliError` and `UI.printError`

### 4. Code Reuse

Common path checks and validation helpers are extracted to `src/utils/pathResolver.ts` and `src/utils/workspaceInitializer.ts`.

---

## Related Documentation

- [Getting Started](../tutorials/getting-started.md) - CLI setup and configuration
- [Kernel Reference](../reference/kernel.md) - Kernel architecture
- [Extend with Skills and Tools](../how-to/extend-with-skills-and-tools.md) - Extensibility guide
