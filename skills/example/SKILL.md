---
name: example-skill
description: An example skill demonstrating the standard structure and best practices from the Anthropic Skill Guide.
requires:
  - read_file
  - write_file
  - run_command
---

# Example Skill: Standard Workflow

This is a template skill that demonstrates how to structure a robust workflow.

## When to Use
Use this skill when the user asks to perform a task that follows a standard procedure, or when you need to demonstrate how to build a new skill.

## Inputs / Preconditions
- The user must provide a clear goal or input data.
- The `scripts/` directory must contain `process_data.py` (if applicable).

## Steps

1. **Analyze the Request**: Understand the user's intent and gather necessary information.
   - If information is missing, ask the user.

2. **Execute Logic**: Run any necessary scripts or tools.
   - Example: `run_command: "python3 skills/example-skill/scripts/process_data.py --input ..."`

3. **Verify Output**: Check if the result meets the requirements.
   - Consult `references/quality_checklist.md` if available.

4. **Finalize**: Present the result to the user.

## Failure Modes and Recovery
- **Script Failure**: If `process_data.py` fails, check the error log and retry with corrected arguments.
- **Missing Input**: If the input file is missing, ask the user to provide the path.

## Expected Outputs / Artifacts
- A processed file or a final report.
- A confirmation message to the user.
