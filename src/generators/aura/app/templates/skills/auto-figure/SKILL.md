---
name: auto-figure
description: 自动生成高质量学术插图（AutoFigure 论文模式）。通过多智能体协作完成语义解析、布局规划与迭代优化，最终产出可视化产物。
requires:
  - subagent
  - blackboard
  - render_image
  - ocr_and_verify
---

# AutoFigure: Publication-Ready Scientific Illustration Skill

本技能基于 ICLR 2026 论文 "AutoFigure"，将学术插图生成过程分解为**语义解析**、**布局优化**和**高质量渲染**三个阶段。

---

## 核心流程 (Reasoned Rendering Paradigm)

### Stage 1: 语义解析与草图生成 (Conceptual Grounding)
作为主智能体，你首先调用 `subagent` (Persona: `architect`) 提取文档核心逻辑。
- **目标产出**：结构化 Blueprint (SVG/HTML)。
- **示例**：`subagent: {"persona": "architect", "goal": "解析这篇强化学习论文的算法流程，生成一个包含 5 个节点且左右对称的 SVG 结构，写入 blackboard key=initial_svg"}`

### Stage 2: 批判式优化 (Critique-and-Refine Loop)
进入迭代循环，模拟 Designer 与 Critic 的对话。
- **Designer (Refiner)**：根据反馈修改局部坐标、对齐和重叠。
- **Critic (Judge)**：评估布局的美观性、逻辑连贯性并给出具体修改建议。
- **终止条件**：达到最大迭代次数或 Critic 评分超过 8.5。

### Stage 3: 渲染与后处理 (Rendering & Refinement)
1. **Aesthetic Rendering**: 将优化后的 SVG 转换为详细的图像描述 Prompt。
   - 工具调用：`render_image: {"prompt": "...", "output_path": "final_figure.png", "size": "1024x1024"}`
2. **Text Verification**: 验证图像文本与 SVG 内容的一致性。
   - 工具调用：`ocr_and_verify: {"image_path": "final_figure.png", "expected_texts": ["Recall", "Precision", "F1-Score"]}`
   - 如果校验失败，提示 `designer` 调整布局或字体大小，重新进入 Stage 2。

---

## 最佳实践 (Best Practices)

1. **结构化 Blueprint**：确保 Stage 1 产出的是清晰、可编辑的符号格式（如 SVG），而不是纯描述。
2. **渐进式复杂度**：建议初次生成时限制节点数量（如 < 10个），待结构稳定后再进行扩展。
3. **黑板管理**：使用 `blackboard` 存储每一轮迭代的 SVG 代码和 Critic 的打分，支持回滚到历史最优版本。
