---
name: paper2skill
description: Converts academic papers (especially on agents/multi-agent systems) into executable Aura skills. Use when user provides a paper/PDF and asks to "learn this method", "implement this paper as a skill", or "turn this research into code".
---

# Paper2Skill: Evolutionary Meta-Learning

## Requirements
- subagent
- plan_task
- write_file
- read_file

This is a **Meta-Skill** that empowers Aura to "learn new skills by reading papers". It transforms natural language descriptions in papers into structured code and configurations.

---

## Core Process (The Learning Loop)

### Stage 1: Cognitive Extraction
The Main Agent reads the paper PDF/Markdown to extract the topology of the multi-agent system.
- **Persona**: `methodologist`
- **Goal**: "Analyze Agent roles, interaction flows, and data state in the paper. Output a structured System Design Doc."
- **Key Extraction Points**:
  - **Roles**: Even if the paper only mentions "Designer", its `persona` instructions must be defined.
  - **Tools**: What tools do Agents use? (e.g., "Web Browser", "Python Terminal"). If a tool is new, mark it as `MISSING`.

### Stage 2: Skill Compilation
Convert the extracted design document into Aura file assets.
- **Persona**: `aura_engineer` (Engineer familiar with Aura framework)
- **Goal**: "Write `SKILL.md` and corresponding `persona.json` files based on the System Design Doc."
- **Outputs**:
  - `skills/<new_skill>/SKILL.md`: Contains orchestration logic.
  - `state/personas/*.json`: System Prompts for corresponding roles.

### Stage 3: Tool Synthesis
Attempt to automatically implement `MISSING` tools identified in Stage 1.
- **Persona**: `tool_maker`
- **Goal**: "Write `tools/<tool_name>/logic.py` and `manifest.json` for missing capabilities."
- **Strategy**:
  - If generic (like search), try to reuse existing tools.
  - If proprietary (like AutoFigure's Rendering), generate a "Mock Tool" or "Interface Tool" and prompt the user to fill in specific API logic.

---

## Usage Example

```bash
# Let Aura learn "Generative Agents" paper
skill run paper2skill --paper="generative_agents.pdf" --name="stanford_town"
```

## Output Structure

```text
skills/
  stanford_town/
    SKILL.md (Orchestration logic: memory stream, reflection, planning)
state/
  personas/
    town_resident.json (Generic resident persona)
tools/
  memory_stream/ (Auto-generated memory retrieval tool)
```
