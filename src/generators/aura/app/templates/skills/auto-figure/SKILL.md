---
name: auto-figure
description: Automatically generate high-quality academic figures (AutoFigure paper mode). Uses multi-agent collaboration for semantic parsing, layout planning, and iterative optimization to output final visualizations.
requires:
  - subagent
  - blackboard
  - render_image
  - ocr_and_verify
---

# AutoFigure: Publication-Ready Scientific Illustration Skill

Based on the AutoFigure paradigm, this skill decomposes academic figure generation into three distinct stages: **Semantic Parsing**, **Layout Optimization**, and **High-Quality Rendering**.

---

## Core Workflow (Reasoned Rendering Paradigm)

### Stage 1: Semantic Parsing & Draft Generation (Conceptual Grounding)
As the primary orchestrator, first invoke `subagent` (Persona: `architect`) to extract core document logic.
- **Target Output**: Structured Blueprint (SVG/HTML).
- **Example**: `subagent: {"persona": "architect", "goal": "Parse the RL paper algorithm flow, generate a symmetrical SVG structure with 5 nodes, and write to blackboard key=initial_svg"}`

### Stage 2: Critique-and-Refine Loop
Enter an iterative loop simulating a dialogue between Designer and Critic.
- **Designer (Refiner)**: Adjusts local coordinates, alignments, and overlaps based on feedback.
- **Critic (Judge)**: Evaluates layout aesthetics and logical consistency, providing actionable feedback.
- **Termination Criteria**: Reaches max iterations or Critic score exceeds 8.5.

### Stage 3: Rendering & Post-Processing (Rendering & Refinement)
1. **Aesthetic Rendering**: Converts optimized SVG into detailed image generation prompts.
   - Tool Call: `render_image: {"prompt": "...", "output_path": "final_figure.png", "size": "1024x1024"}`
2. **Text Verification**: Verifies consistency between rendered image text and original SVG content.
   - Tool Call: `ocr_and_verify: {"image_path": "final_figure.png", "expected_texts": ["Recall", "Precision", "F1-Score"]}`
   - If verification fails, instruct `designer` to adjust layout or font size, then re-enter Stage 2.

---

## Best Practices

1. **Structured Blueprint**: Ensure Stage 1 produces a clear, editable symbolic format (such as SVG) rather than plain descriptive text.
2. **Progressive Complexity**: Keep initial node counts limited (< 10 nodes) until structural layout stabilizes.
3. **Blackboard Management**: Use `blackboard` to store intermediate SVG code and Critic scores across iterations to support rollback.
