---
name: figure-evaluation
description: Evaluate academic figure quality (VLM-as-a-judge). Scores figure accuracy, visual design, and communication effectiveness using reference evaluations and pairwise comparisons.
requires:
  - subagent
---

# Figure Evaluation: VLM-as-a-judge Skill

This skill provides a standardized evaluation protocol to assess whether AI-generated academic illustrations reach publication quality.

---

## Evaluation Protocol

### 1. Referenced Scoring
Given original source text, Ground Truth (if available), and generated figures, evaluate across three key dimensions:
- **Content Fidelity**: Is information extracted accurately? Are there logical errors?
- **Visual Design**: Is color harmony professional? Is layout balanced? Is text crisp and readable without overlap?
- **Communication Effectiveness**: Can a reader quickly grasp the core scientific concepts?

**Output Format**: 1-10 Likert scale + detailed rationale.

### 2. Blind Pairwise Comparison
Randomly assign two generation candidates as Candidate A and Candidate B, instructing a `judge` subagent to select the winner.
- **Criteria**: Prioritize structural integrity and information density over pure visual style.

---

## Orchestration Example

```json
{
  "persona": "judge",
  "goal": "Review source_text and ground_truth_image, evaluate candidate_image across 3 dimensions. Focus on whether logical topology matches paper descriptions.",
  "max_steps": 5
}
```

## Use Cases
- **AutoFigure Optimization Loop**: Serves as the Critic in Stage 2.
- **Benchmarking (FigureBench)**: Automated large-scale experiments replacing expensive human evaluation.
