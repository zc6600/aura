# Agent Gardening: Patterns for Long-Horizon Work Systems (智能体园艺：长周期工作系统模式)

## 1. 核心哲学与范式转变 (Core Philosophy & Paradigm Shift)

*   **从“执行”到“栽培” (From Execution to Cultivation)**
    传统的 AI 智能体应用侧重于“执行”模式（Single-shot execution）——给智能体一个 Prompt，要求它立即完成并返回结果。当任务高度复杂、周期拉长（Long-horizon tasks）时，单纯依靠 Prompt Engineering 和 Context Engineering 会遇到严重的上下文窗口膨胀、幻觉累积和任务偏离（Context Drift）问题。
    “智能体园艺”提出了一种全新的设计范式：**将智能体看作是花园中的园丁（Gardener），将工作区看作是不断演进、需要维护和修剪的花园（Garden），而智能体的底层 API、工具和运行环境则是支撑一切的设施与马力（Harness）。**
*   **三大核心定律**
    *   **Harness 定义能力 (Harness defines capability)**: 决定了智能体能够观测多深、如何操作物理世界以及如何委派协同。
    *   **Garden 定义组织 (Garden defines organization)**: 决定了知识、临时任务和中间产物如何跨越时间长河进行存续、演进与重组。
    *   **智能源于两者的交互 (Intelligence emerges from their interaction)**: 智能不是静态模型单次推理的能力，而是智能体在 Harness 的物理支撑下，对 Garden 进行持续耕作、修剪和迭代的系统涌现结果。

---

## 2. Harness — 物理能力与支撑系统 (Capabilities)

定义了智能体“能做什么”，是智能体与环境交互的物理接口和原语集合。

*   **Chapter 1 — 智能体环境 (The Agent Environment)**
    *   智能体不直接作用于现实物理世界，而是通过 Harness 提供的代理 API（文件读写、浏览器控制、Shell 执行、API 调用等）进行交互。
    *   阐述 `世界 (World) -> 支撑系统 (Harness) -> 智能体 (Agent)` 的层级结构。
*   **Chapter 2 — Harness 原语 (Harness Primitives)**
    *   **Observe (观测)**: 搜索、文件读取、代码分析、依赖树检索、环境诊断。
    *   **Transform (转换)**: 代码执行、数据转换、内容编辑、数学计算。
    *   **Persist (持久化)**: 文件系统写入、SQLite 记忆库、结构化日志。
    *   **Delegate (委派)**: 子智能体衍生（Subagent Spawning）、角色分配、流水线分解。
    *   **Coordinate (协同)**: 共享黑板总线（Blackboard Bus）、分布式锁、状态机。
    *   **Create (创造)**: 脚本自动生成、动态工具创建（Meta-tool creation）、自我环境扩展。
*   **Chapter 3 — Harness 模式 (Harness Patterns)**
    *   **循环模式 (Loop Patterns)**: `Observe -> Think -> Transform -> Persist` 的基本认知动作循环。
    *   **委派模式 (Delegation Patterns)**: 衍生独立且沙箱化的子智能体（如 Coder, Critic, Reviewer），通过并行或对立角色提升质量（例如 Ralph 开发者-审阅者循环）。
    *   **制品模式 (Artifact Patterns)**: 文件化推理（File-based reasoning），如增量输出、进度锚点（Anchors）、检查点（Checkpointing）。
    *   **工具扩展模式 (Tool Extension Patterns)**: 自我构建工具链，在遇到无现成工具的复杂任务时，编写临时脚本并动态加载（Self-extending Harness）。

---

## 3. Garden — 工作组织与演进空间 (Work Organization)

定义了工作在时间轴上“如何组织”，也是 Aura OS 系统设计（如 prompts、anchors、hints 等机制）的核心体现。

*   **Chapter 4 — 什么是花园？(What Is a Garden?)**
    *   **任务是短暂的 (Tasks are temporary)**: 跑完就结束了。
    *   **花园是持久的 (Gardens are persistent)**: 即使具体任务切换，代码库、文档结构、开发规范和底层记忆依然存在。
    *   **上下文不等于系统 (Context is not the system)**: 智能体不应该把所有东西都塞进 Context Window 里。花园提供了一个结构化的物理介质，让智能体在其中读取、写入、精简和归档。
*   **Chapter 5 — 土壤 (Soil: The Infrastructure)**
    *   文件系统、持久化数据库（SQLite 记忆）、Git 仓库、配置中心。
    *   “土壤”是智能体所有操作的持久化底座。在 Aura 中，这对应了 `.aura/` 隐藏目录和本地 SQLite 数据库。
*   **Chapter 6 — 种子 (Seeds: Structured Uncertainty)**
    *   创意、待验证的假说、设计规范（Specs）、待解答的 Question、任务锚点（Task Anchors/`task.md`）。
    *   所有复杂的工程都始于未解决的“结构化不确定性”，它是后续栽培的起点。
*   **Chapter 7 — 植物 (Plants: Evolving Artifacts)**
    *   动态演进的文档、架构摘要、研究成果、核心代码、单元测试。
    *   工作不是一次性生成的静态输出，而是会随着重构、优化、Bug 修复而不断生长和演化的“活制品”。
*   **Chapter 8 — 园丁 (Gardeners: Specialized Subagents)**
    *   规划者（Planner）、执行者（Engineer）、评审员（Reviewer/Critic）、PM。
    *   它们是花园的专业维护者，受 Meta-Agent 调度，在沙箱环境中对土壤和植物进行处理。
*   **Chapter 9 — 栽培周期 (Cultivation Cycles)**
    *   `Plan -> Execute -> Review -> Refine`（计划-执行-评审-重构）的完整生命周期。
    *   例如，在科学仿真中，体现为“工程奠基（Engineering Baseline，锁定物理求解器）”与“科学探索（Scientific Sweeps，参数并行探索）”的解耦。
*   **Chapter 10 — 修剪 (Pruning: Compression & Cleanup)**
    *   对冗长运行日志的压缩、记忆的代谢（Metabolism）、大文件的精简（Companion `.hint` 文件）、代码重构。
    *   智能体的上下文是有限且昂贵的，必须定期“修剪”无用信息，保持最高的信息密度，防止内存泄漏和无限循环。
*   **Chapter 11 — 堆肥 (Compost: Archived Knowledge)**
    *   失败的运行尝试、废弃的代码片段、被否决的设计方案、完整的历史 Trace 日志。
    *   失败的信息不应该直接丢弃，而是转化为“肥料”，作为历史教训和长周期记忆（Long-term memory/`MEMORY.md`）指导智能体，确保不再重蹈覆辙。
*   **Chapter 12 — 收获 (Harvest: Deliverables)**
    *   最终提交的 PR/Feature、最终学术报告（`research_report.md`）、经过验证的分析图表。
    *   产出是健康花园运转的“自然副产物”。

---

## 4. Part 3 — 园艺哲学与工程落地 (Philosophy of Gardening)

*   **Chapter 13 — 架构 (Architecture)**
    探讨在现代 LLM 时代下，操作系统与智能体结合的最佳架构体系（如 Aura OS 这种 folder-as-a-workspace 的设计）。
*   **Chapter 14 — 持久性 (Persistence)**
    长周期任务中，跨会话（Sessions）的状态机同步、长期与短期记忆代谢（Memory Metabolism）的科学合并机制。
*   **Chapter 15 — 模式 (Patterns)**
    总结如何在长周期任务中避免死循环、任务漂移、资源泄露以及如何在人类协作与自主运行之间找到动态平衡点。
*   **Chapter 16 — 结论 (Conclusion)**
    迈向 AGI 过程中，智能体开发范式从“单次交互式 Prompting”彻底转向“系统化 Gardening”的终极展望。
