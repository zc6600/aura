# Build Your First Tool and Skill

This tutorial creates a small local tool and a skill that tells the agent when to use it.

You will end with:

- A tool under `tools/count_lines/`.
- A skill under `skills/line-count-review/`.
- A manual tool call through `aura kernel run_call`.
- A quick agent prompt that can discover the workflow.

## Prerequisites

You need an initialized Aura workspace:

```bash
aura new line-count-demo
cd line-count-demo
```

You can run this tutorial without an LLM key until the final agent step.

## Create the Tool Scaffold

Generate the standard tool files:

```bash
aura create tool count_lines --allow-path . --auto-load
```

This creates:

```text
tools/count_lines/
├── manifest.json
├── logic.py
└── logic.py.hint
```

Replace `tools/count_lines/manifest.json` with:

```json
{
  "name": "count_lines",
  "description": "Count lines in a text file under the workspace.",
  "runtime": "python3",
  "entry": "logic.py",
  "auto_load": true,
  "input_schema": {
    "type": "object",
    "properties": {
      "file_path": {
        "type": "string",
        "description": "Path to the file to count."
      }
    },
    "required": ["file_path"]
  },
  "permissions": {
    "file_system": "read-only",
    "allow_paths": ["."]
  }
}
```

Replace `tools/count_lines/logic.py` with:

```python
import json
import sys
from pathlib import Path


def main():
    payload = json.loads(sys.stdin.read() or "{}")
    file_path = Path(payload["file_path"])

    if not file_path.exists() or not file_path.is_file():
        print(json.dumps({"status": "failed", "error": "File not found"}))
        return

    content = file_path.read_text(encoding="utf-8")
    print(json.dumps({
        "status": "ok",
        "file_path": str(file_path),
        "line_count": len(content.splitlines())
    }))


if __name__ == "__main__":
    main()
```

## Create a File to Inspect

```bash
printf "alpha\nbeta\ngamma\n" > sample.txt
```

## Run the Tool Manually

```bash
aura kernel run_call count_lines '{"file_path":"sample.txt"}' .
```

The output should contain `line_count: 3`.

## Inspect Tool Discovery

```bash
aura tools list --human
aura tools inspect count_lines --human
```

If the tool does not appear, check that `manifest.json` is valid JSON and that the tool directory is under `tools/count_lines/`.

## Add a Skill

Generate the standard skill files:

```bash
aura create skill line-count-review
```

This creates:

```text
skills/line-count-review/
├── SKILL.md
├── assets/
├── references/
└── scripts/
```

Replace `skills/line-count-review/SKILL.md` with:

```markdown
---
name: line-count-review
description: Use when reviewing text files and line counts matter.
---

# Line Count Review

When asked to review a text file's size or structure, use the `count_lines` tool before giving a conclusion.

Report the file path and line count. If the file is missing, explain that the tool could not read it.
```

## List the Skill

```bash
aura skill list
```

## Try It With the Agent

With an LLM key configured, run:

```bash
aura agent --goal "Use the line count review workflow on sample.txt and tell me the line count" --non-interactive
```

The agent should have enough local context to discover the skill and call the tool.

## What You Learned

- Tools are executable capabilities with a JSON manifest.
- Skills are workflow instructions in markdown.
- `aura create tool` and `aura create skill` generate the standard files so you can focus on the behavior.
- `aura kernel run_call` is the fastest way to test one tool.
- `aura tools list` and `aura skill list` show what Aura can discover.

See [Tools, Skills, Garden, and MCP](../explanation/tools-skills-and-mcp.md) for the model and [Extend with Skills, Tools, and Garden](../how-to/extend-with-skills-and-tools.md) for more workflows.
