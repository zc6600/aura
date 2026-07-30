---
name: paper2skill
description: "Meta-Skill: Reads an academic paper (typically multi-agent or agentic AI), analyzes its system architecture, and automatically compiles executable Skill and Tool code for Aura."
requires:
  - subagent
  - plan_task
  - write_file
  - read_file
---

# Paper2Skill: Evolutionary Meta-Learning

This **Meta-Skill** empowers Aura to acquire new capabilities by reading scientific papers. It converts natural language descriptions into structured code, workflows, and configurations.

---

## Core Workflow (The Learning Loop)

### Stage 1: Cognitive Extraction
The primary agent reads paper PDFs or Markdown files to extract the multi-agent system topology.
- **Persona**: `methodologist` (Methodology Specialist)
- **Goal**: "Analyze agent roles, interaction flow, and state/data management in the paper. Output a structured System Design Doc."
- **Key Extraction Points**:
  - **Roles**: Define `persona` directives for every identified role (e.g., Designer, Judge, Refiner).
  - **Tools**: Identify tools used by agents (e.g., Web Browser, Python Terminal). Mark non-existent tools as `MISSING`.

### Stage 2: Skill Compilation
Compiles extracted design documents into native Aura file assets.
- **Persona**: `aura_engineer` (Aura Framework Engineer)
- **Goal**: "Based on the System Design Doc, write `SKILL.md` and corresponding `persona.json` configurations."
- **Outputs**:
  - `skills/<new_skill>/SKILL.md`: Contains orchestration workflow logic.
  - `state/personas/*.json`: System prompts for each specialized role.

### Stage 3: Tool Synthesis
Automatically synthesizes code for any `MISSING` capabilities identified in Stage 1.
- **Persona**: `tool_maker`
- **Goal**: "Write `tools/<tool_name>/logic.py` and `manifest.json` for missing capabilities."
- **Strategy**:
  - Re-use existing tools for general domain actions (e.g., search).
  - Create Mock or Interface Tools for proprietary capabilities, prompting the user for external API integrations if necessary.

---

## Usage Example

```bash
# Instruct Aura to learn from the "Generative Agents" paper
skill run paper2skill --paper="generative_agents.pdf" --name="stanford_town"
```

## Generated Asset Structure

```text
skills/
  stanford_town/
    SKILL.md (Orchestration logic: Memory streams, reflection, planning)
state/
  personas/
    town_resident.json (Resident persona templates)
tools/
  memory_stream/ (Synthesized memory retrieval tool)
```
