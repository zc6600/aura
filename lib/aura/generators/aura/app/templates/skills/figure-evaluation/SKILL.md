---
name: figure-evaluation
description: 评估学术插图的质量（VLM-as-a-judge）。通过参照评估和盲审对比，对插图的准确性、美观性和沟通效率进行打分。
requires:
  - subagent
---

# Figure Evaluation: VLM-as-a-judge Skill

本技能提供了一套标准化的评估协议，用于衡量 AI 生成的学术插图是否达到“可发表”水平。

---

## 评估协议 (Evaluation Protocol)

### 1. 参照打分 (Referenced Scoring)
提供原始文本、Ground Truth（如有）和生成图片，从三个维度评估：
- **Content Fidelity (内容保真度)**：信息提取是否准确？是否存在逻辑错误？
- **Visual Design (视觉设计)**：配色是否专业？布局是否平衡？是否有文本模糊或重叠？
- **Communication Effectiveness (沟通效率)**：读者是否能快速理解核心概念？

**输出格式**：1-10 分 Likert 量表 + 详细理由。

### 2. 盲审对抗 (Blind Pairwise Comparison)
将两个生成结果随机命名为 Candidate A 和 Candidate B，让 `judge` persona 的 subagent 选择优胜者。
- **评判标准**：优先关注结构完整性和信息密集度，其次是美观度。

---

## 编排示例 (Orchestration Example)

```json
{
  "persona": "judge",
  "goal": "阅读 source_text 和 ground_truth_image，对 candidate_image 进行 3 个维度的打分。重点关注其逻辑拓扑结构是否与论文描述一致。",
  "max_steps": 5
}
```

## 适用场景
- **AutoFigure 优化闭环**：作为 Stage 2 的 Critic 角色。
- **基准测试 (FigureBench)**：替代昂贵的人工评估，进行大规模自动化实验。
