name: figure-evaluation
description: Evaluates scientific figures for publication quality using VLM-as-a-judge. Use when user uploads a figure and asks for "critique", "review", "scoring against academic standards", or asks "is this figure publication-ready?".
---

# Figure Evaluation: VLM-as-a-judge Skill

## Requirements
- subagent

This skill provides a standardized evaluation protocol to measure whether AI-generated scientific illustrations reach a "publication-ready" level.

---

## Evaluation Protocol

### 1. Referenced Scoring
Provide original text, Ground Truth (if available), and generated image. Evaluate across three dimensions:
- **Content Fidelity**: Is information extraction accurate? Are there logical errors?
- **Visual Design**: Is the color scheme professional? Is the layout balanced? Is there text blurring or overlap?
- **Communication Effectiveness**: Can readers quickly grasp core concepts?

**Output Format**: 1-10 Likert Scale + Detailed Rationale.

### 2. Blind Pairwise Comparison
Randomly label two generated results as Candidate A and Candidate B, then ask a `judge` persona subagent to select the winner.
- **Criteria**: Prioritize structural integrity and information density, followed by aesthetics.

---

## Orchestration Example

```json
{
  "persona": "judge",
  "goal": "Read source_text and ground_truth_image, score candidate_image across 3 dimensions. Focus on whether its logical topology matches the paper description.",
  "max_steps": 5
}
```

## Use Cases
- **AutoFigure Optimization Loop**: Acts as the Critic role in Stage 2.
- **Benchmark Testing (FigureBench)**: Replaces expensive human evaluation for large-scale automated experiments.
