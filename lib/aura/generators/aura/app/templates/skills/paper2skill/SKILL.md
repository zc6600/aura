---
name: paper2skill
description: "Meta-Skill: 阅读一篇论文（通常是多智能体或 Agent 相关的），分析其架构，并将其自动编译为 Aura 系统可执行的 Skill 和 Tool 代码。"
requires:
  - subagent
  - plan_task
  - write_file
  - read_file
---

# Paper2Skill: Evolutionary Meta-Learning

这是一个**元技能 (Meta-Skill)**，赋予了 Aura "通过阅读论文学习新技能" 的能力。它将论文中的自然语言描述转化为结构化的代码和配置。

---

## 核心流程 (The Learning Loop)

### Stage 1: 认知提取 (Cognitive Extraction)
主智能体阅读论文 PDF/Markdown，提取出多智能体系统的拓扑结构。
- **Persona**: `methodologist` (方法论专家)
- **Goal**: "分析论文中的 Agent 角色、交互流程（Flow）和数据流（State）。输出一个结构化的 System Design Doc。"
- **关键提取点**:
  - **Roles**: 即使论文只说了 "Designer"，也需要定义它的 `persona` 指令。
  - **Tools**: 论文中 Agent 用了什么工具？（如 "Web Browser", "Python Terminal"）。如果是新工具，标记为 `MISSING`.

### Stage 2: 技能编译 (Skill Compilation)
将提取的设计文档转化为 Aura 的文件资产。
- **Persona**: `aura_engineer` (熟悉 Aura 框架的工程师)
- **Goal**: "基于 System Design Doc，编写 `SKILL.md` 和对应的 `persona.json` 文件。"
- **产出**:
  - `skills/<new_skill>/SKILL.md`: 包含编排逻辑。
  - `state/personas/*.json`: 对应角色的 System Prompt。

### Stage 3: 工具补全 (Tool Synthesis)
针对 Stage 1 发现的 `MISSING` 工具，尝试自动实现。
- **Persona**: `tool_maker`
- **Goal**: "为缺失的能力编写 `tools/<tool_name>/logic.py` 和 `manifest.json`。"
- **策略**:
  - 如果是通用能力（如搜索），尝试复用现有工具。
  - 如果是专有能力（如 AutoFigure 的 Rendering），生成一个 "Mock Tool" 或 "Interface Tool"，并提示用户填充具体 API 调用逻辑。

---

## 使用示例

```bash
# 让 Aura 学习 "Generative Agents" 论文
skill run paper2skill --paper="generative_agents.pdf" --name="stanford_town"
```

## 产出物结构

```text
skills/
  stanford_town/
    SKILL.md (编排逻辑：记忆流、反思、规划)
state/
  personas/
    town_resident.json (通用居民人设)
tools/
  memory_stream/ (自动生成的记忆检索工具)
```
