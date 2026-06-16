# Make Your First Contribution

This tutorial walks through a small documentation or code contribution to Aura itself.

You will:

- Install dependencies.
- Run a focused test.
- Make a small change.
- Run the matching verification.
- Update documentation if behavior changed.

## Prerequisites

From the Aura framework repository:

```bash
npm install
npm run build
```

If native dependencies fail, install platform build tools first. On macOS this is usually:

```bash
xcode-select --install
```

## Pick a Small Change

Good first changes are narrow:

- Improve one CLI error message.
- Add one test for an existing command.
- Fix one outdated documentation link.
- Clarify one config field.

Avoid starting with daemon lifecycle, memory retention, or planner-loop behavior unless you already know the subsystem.

## Find the Right Test Layer

Use this quick mapping:

| Change | Start With |
|--------|------------|
| Parser, resolver, config helper | `tests/unit/` |
| CLI command behavior | `tests/integration/` |
| Kernel loop contract | `tests/system/kernel-contracts/` |
| Kernel-driven single-tool behavior | `tests/system/kernel-tools/` |
| Kernel-driven cross-tool workflow behavior | `tests/system/kernel-workflows/` |
| User-facing `agent -g` behavior | `tests/system/cli-e2e/` |
| Daemon, session, or IPC behavior | `tests/system/runtime/` |

For example, if you change session-name validation, start with:

```bash
npx vitest tests/unit/pathResolver.test.ts
```

If you change a CLI command, run the closest integration test:

```bash
npx vitest tests/integration/config.test.ts
```

## Make the Change

Keep the edit close to the behavior you are changing. Prefer existing helpers and command patterns.

If behavior changes, update the relevant Diátaxis document:

- Tutorial impact: `docs/tutorials/`
- Task steps: `docs/how-to/`
- Exact command/schema/API: `docs/reference/`
- Conceptual model: `docs/explanation/`

## Run Focused Verification

Run the smallest meaningful check first:

```bash
npx vitest tests/unit/pathResolver.test.ts
```

Then broaden only as needed:

```bash
npm test
```

For formatting and lint rules:

```bash
npm run lint
```

## Check CLI Help When Commands Change

If you changed a command or option, compare against the CLI registration in `src/bin/aura.ts` and update [CLI Reference](../reference/cli.md).

Useful checks:

```bash
npm run build
node dist/bin/aura.js help
node dist/bin/aura.js version
```

## Update the Changelog When Needed

For user-visible behavior, update `CHANGELOG.md` following [Maintain the Changelog](../how-to/maintain-changelog.md).

Documentation-only restructuring does not need a behavioral test, but links should still be checked.

## Final Checklist

- Focused test passed.
- Broader test passed if the change touches shared behavior.
- Docs match current source behavior.
- CLI reference matches `src/bin/aura.ts`.
- Config reference matches `src/utils/configSchema.ts`.
- No generated runtime files were committed.

See [Testing Strategy](../explanation/testing-strategy.md) for why each test layer exists.
