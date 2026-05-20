name: auto-figure
description: Generates publication-ready scientific illustrations (AutoFigure mode). Use when user asks to "draw a figure for this paper", "visualize this algorithm", "create an architecture diagram", or "illustrate this concept".
---

# AutoFigure: Publication-Ready Scientific Illustration Skill

## Requirements
- subagent
- blackboard
- render_image
- ocr_and_verify

This skill is based on the ICLR 2026 paper "AutoFigure", decomposing the scientific illustration generation process into three stages: **Semantic Parsing**, **Layout Optimization**, and **High-Quality Rendering**.

---

## Core Process (Reasoned Rendering Paradigm)

### Stage 1: Semantic Parsing & Sketch Generation (Conceptual Grounding)
As the main agent, you first call `subagent` (Persona: `architect`) to extract the core logic of the document.
- **Target Output**: Structured Blueprint (SVG/HTML).
- **Example**: `subagent: {"persona": "architect", "goal": "Parse the algorithm flow of this reinforcement learning paper, generate a 5-node symmetrical SVG structure, and write to blackboard key=initial_svg"}`

### Stage 2: Critique-and-Refine Loop
Enter an iterative loop simulating a dialogue between a Designer and a Critic.
- **Designer (Refiner)**: Modifies local coordinates, alignment, and overlaps based on feedback.
- **Critic (Judge)**: Evaluates layout aesthetics and logical coherence, providing specific modification suggestions.
- **Termination Condition**: Reaching maximum iterations or Critic score exceeds 8.5.

### Stage 3: Rendering & Refinement
1. **Aesthetic Rendering**: Convert the optimized SVG into a detailed image description Prompt.
   - Tool Call: `render_image: {"prompt": "...", "output_path": "final_figure.png", "size": "1024x1024"}`
2. **Text Verification**: Verify consistency between image text and SVG content.
   - Tool Call: `ocr_and_verify: {"image_path": "final_figure.png", "expected_texts": ["Recall", "Precision", "F1-Score"]}`
   - If verification fails, prompt `designer` to adjust layout or font size, then re-enter Stage 2.

---

## Best Practices

1. **Structured Blueprint**: Ensure Stage 1 outputs a clear, editable symbolic format (like SVG), not just a description.
2. **Progressive Complexity**: Suggest limiting node count (e.g., < 10) for initial generation, expanding only after the structure stabilizes.
3. **Blackboard Management**: Use `blackboard` to store SVG code and Critic scores for each iteration, supporting rollback to the historical best version.
