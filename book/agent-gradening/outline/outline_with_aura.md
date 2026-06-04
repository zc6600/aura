# Agent Gardening: Patterns for Long-Horizon Work Systems (基于 Aura OS 落地版大纲)

本大纲将**智能体园艺（Agent Gardening）**的理论框架与 **Aura OS** 的实际架构、代码组件与目录设计进行深度融合。每一章不仅阐述设计哲学，还将以 Aura OS 为蓝本展示如何在操作系统级别实现这些长周期工作模式。

---

# Preface — Why Agent Gardening? (前言：为什么需要智能体园艺？)

*   **设计哲学：从“单次执行”走向“系统栽培”**
    *   **Prompt/Context Engineering 的局限性**：传统 Agent 依赖线性 Prompt 历史，易面临上下文溢出、记忆混淆和“任务漂移”（Context Drift）问题。
    *   **持久工作系统的必要性**：长周期任务需要一个持久化的物理介质。
*   **Aura OS 的破局点：解耦式工作区架构**
    *   Aura 创新性地采用“工作区即内存”（Folder-as-a-Workspace）的设计，将用户纯净的工程代码空间与 Agent 的隐藏环境目录 `.aura/` 彻底解耦。
    *   核心设计公式：
        $$\text{Harness (能力原语)} \times \text{Garden (组织系统)} \xrightarrow{\text{交互}} \text{Emergent Intelligence (涌现智能)}$$

---

# Part I — Harness (Aura 能力接口与内核原语)

> Harness 定义了智能体在物理和逻辑世界中“能做什么”的最小完备接口。在 Aura 中，它由内核执行引擎、沙箱协议以及多智能体通信机制构成。

## Chapter 1 — The Agent Environment (第一章：智能体运行环境)
*   **1.1 世界、支撑系统与智能体的三层架构**
    *   **World (物理环境)**：宿主机文件系统、进程空间、外部网络。
    *   **Harness (Aura 支撑)**：由 [config_loader.rb](file:///Users/frank/Desktop/Towards%20AGI/aura/aura/lib/aura/config_loader.rb) 与 [path_resolver.rb](file:///Users/frank/Desktop/Towards%20AGI/aura/aura/lib/aura/path_resolver.rb) 构成的运行边界与工具调用层。
    *   **Agent (智能体)**：无状态的 LLM。
*   **1.2 物理沙箱隔离机制**
    *   **路径隔离策略**：分析 `security.strict_path_isolation` 对工具文件读写前缀的强制校准。
    *   **动态控制载荷**：探讨 Kernel 组装上下文时注入 `args.context_permissions` 从而防止 Agent 跳出项目根目录的实现。

## Chapter 2 — Harness Primitives in Aura (第二章：Aura 内核六大原语)
本章解析 Aura 如何将 Harness 抽象为六种核心原语，并在物理层落地的过程：
*   **2.1 Observe (观测)**：由 [hint_provider.rb](file:///Users/frank/Desktop/Towards%20AGI/aura/aura/lib/aura/context/env_provider/hint_provider.rb)、[knowledge_provider.rb](file:///Users/frank/Desktop/Towards%20AGI/aura/aura/lib/aura/context/env_provider/knowledge_provider.rb) 和 [lsp_diagnostics.rb](file:///Users/frank/Desktop/Towards%20AGI/aura/aura/lib/aura/kernel/tools/lsp_diagnostics.rb) 组成的项目状态主动感知体系。
*   **2.2 Transform (转换)**：Aura 工具的标准调用契约。每个工具（`/tools/<name>/logic.py`）接受统一的 JSON 参数并强制输出规范的 JSON 结果。
*   **2.3 Persist (持久化)**：使用 [state.rb](file:///Users/frank/Desktop/Towards%20AGI/aura/aura/lib/aura/kernel/state.rb) 将运行事件（events）、活跃变量（variables）和阶段摘要（summaries）持久化存入 SQLite。
*   **2.4 Delegate (委派)**：内置 `subagent` 工具，支持动态加载 `state/personas/{persona}.json` 配置，衍生出带有独立 SQLite 数据库连接的沙箱子智能体进程。
*   **2.5 Coordinate (协同)**：基于物理文件路径 `state/bus/` 的共享黑板总线（Blackboard Bus），提供跨进程变量加锁、读写的进程间通信（IPC）。
*   **2.6 Create (自我进化)**：Aura 的 **The Evolution Loop（自进化循环）**，通过自动编写 `logic.py` 并在本地验证通过，动态装载新工具扩展 Harness 能力。

## Chapter 3 — Harness Patterns & Ralph Loop (第三章：Harness 协作模式与双智能体循环)
*   **3.1 基础认知动作模式 (Observe → Think → Transform → Persist)**
    *   拆解 [agent_loop.rb](file:///Users/frank/Desktop/Towards%20AGI/aura/aura/lib/aura/kernel/agent_loop.rb) 的工作流：通过 Stream 规划步骤，执行工具，将 summary 存入 State。
*   **3.2 Ralph 双智能体开发者-批评者循环 (Developer-Critic Loop)**
    *   深度剖析 [ralph_loop.rb](file:///Users/frank/Desktop/Towards%20AGI/aura/aura/lib/aura/kernel/ralph_loop.rb) 的自愈逻辑。
    *   **开发模式 (Developer Mode)**：执行标准 Agent 循环，输出代码更改。
    *   **物理测试/批评者审计 (Verifier Mode)**：运行 `verify_command` 物理命令或启动 LLM 审阅者（Light 模式/Heavy 模式）审阅 Git Diff 变更。
    *   **反馈回流注入**：失败的审计建议（Critique & Advice）在下一轮规划前，作为 Hook 强行打包注入 Developer 阶段的 Context。
*   **3.3 变更备份机制 (Shadow Backup & snapshots)**
    *   分析 [shadow_backup.rb](file:///Users/frank/Desktop/Towards%20AGI/aura/aura/lib/aura/kernel/shadow_backup.rb) 如何在每次工具调用前后做文件状态 Diff，并利用 Git 自动提交版本快照，提供随时回滚的自愈保障。

---

# Part II — Garden (Aura 智能体工作组织系统)

> Garden 定义了工作系统在时间长河中“如何生长与演进”。它是构建于 Harness 物理能力之上的结构化工作空间与记忆代谢模型。

## Chapter 4 — What Is a Garden in Aura? (第四章：什么是 Aura 花园？)
*   **4.1 上下文与物理空间的分离**
    *   对比**临时任务的生命周期**与**持久花园生命周期**的区别。
    *   阐述为什么“把整个项目代码塞入 LLM 窗口”不是真正的系统。花园提供了一个供智能体持续“栽培”的物理环境。
*   **4.2 Aura 的 Playbook Garden 路由体系**
    *   分析 [garden.md](file:///Users/frank/Desktop/Towards%20AGI/aura/aura/garden/garden.md) 及 `Aura::Context::EnvProvider::GardenProvider` 对不同工程/科学领域（Software Check, Performance Tuning, Scientific Research）的动态分流和规则脚手架化。

## Chapter 5 — Soil (第五章：土壤 — 持久化结构空间)
*   **5.1 隔离的工作区配置**
    *   解密 `.aura/` 隐藏环境。
    *   分析 [workspace_initializer.rb](file:///Users/frank/Desktop/Towards%20AGI/aura/aura/lib/aura/workspace_initializer.rb) 如何通过全球模板仓库初始化干净的本地土壤结构。
*   **5.2 记忆存储的物理介质**
    *   SQLite 数据库的表结构设计：`events` (存储轨迹)、`variables` (存储活跃状态)、`summaries` (存储历史快照)。

## Chapter 6 — Seeds (第六章：种子 — 结构化不确定性)
*   **6.1 不确定性的工程化捕获**
    *   `anchors/` 目录：存储阶段性步骤及激活规则 `call_when`。
    *   项目根目录下的 `task.md`：用 Markdown 记录的轻量级 Todo 检查清单。
*   **6.2 锚点图如何对抗幻觉**
    *   [anchor_provider.rb](file:///Users/frank/Desktop/Towards%20AGI/aura/aura/lib/aura/context/env_provider/anchor_provider.rb) 读取这些结构化的“不确定性种子”，并在 LLM 上下文中拼装成进度检查点，防止长周期执行中的任务偏离。

## Chapter 7 — Plants (第七章：植物 — 持续演进的制品)
*   **7.1 活的制品 vs 静态输出**
    *   代码（`src/`）、仿真结果数据（`state/simulation_runs/`）、可视化图表（`assets/`）如何协同生长。
*   **7.2 物理求解器与参数 sweeps 的解耦**
    *   以 [ai-scientist.md](file:///Users/frank/Desktop/Towards%20AGI/aura/aura/garden/ai-scientist/ai-scientist.md) 科学仿真为例：阐述锁定求解器（物理根基）和并行子智能体参数扫参（叶片生长）的“树状生长”演进模式。

## Chapter 8 — Gardeners (第八章：园丁 — 角色化的子智能体)
*   **8.1 多智能体生态下的园丁分工**
    *   如何通过 `/state/personas/` 配置不同的“园丁”职责：Architect（架构）、Coder（施工）、Critic（修剪）、Reviewer（质检）。
*   **8.2 动态数据库热插拔 (Session Rotation)**
    *   在 [session_manager.rb](file:///Users/frank/Desktop/Towards%20AGI/aura/aura/lib/aura/memory/session_manager.rb) 中实现的会话热插拔。
    *   当不同的园丁智能体接手任务时，系统切换各自专属的 SQLite 进程连接，确保内存和心智空间的纯净度，防止多智能体交叉污染。

## Chapter 9 — Cultivation Cycles (第九章：栽培周期 — 工程与探索的迭代)
*   **9.1 科学与软件开发的栽培模型**
    *   **Phase 1-2：地基培育**。文献分析、参数索引与本地单次单跑验证。
    *   **Phase 3-4：分叉扫参与绘图**。利用 Blackboard 并行派生子园丁，将海量数据输出到指定目录隔离。
    *   **Phase 5：最终收获**。
*   **9.2 迭代过程的良性闭环**
    *   通过不断运行测试与修正，实现植物（代码）质量的逐步螺旋上升。

## Chapter 10 — Pruning (第十章：修剪 — 上下文的高保真代谢与控制)
*   **10.1 魔法注释 hints (`# @aura-hint:`)**
    *   [hint_provider.rb](file:///Users/frank/Desktop/Towards%20AGI/aura/aura/lib/aura/context/env_provider/hint_provider.rb) 扫描文件头部标签，将重要物理常数或指令注入 Prompt，完成文件维度的修剪。
*   **10.2 文献侧边栏概要 (`.hint` sidecar)**
    *   [knowledge_provider.rb](file:///Users/frank/Desktop/Towards%20AGI/aura/aura/lib/aura/context/env_provider/knowledge_provider.rb) 对 `knowledge/` 下的论文或大文件自动加载同名 `.hint` 概要，避免长文本导致的注意力分散。
*   **10.3 内存代谢与降维机制 (Metabolism)**
    *   [metabolizer.rb](file:///Users/frank/Desktop/Towards%20AGI/aura/aura/lib/aura/memory/metabolizer.rb) 的触发原理：当 SQLite 轨迹记录字符过载时，运行 LLM 将旧的 Ephemeral（临时）事件降维汇总为一句话 Narrative Summary，同时从 SQLite 中删除旧行，保持上下文的干净。
*   **10.4 上下文阶梯式裁切机制 (Context Tiered Compression)**
    *   [base.rb](file:///Users/frank/Desktop/Towards%20AGI/aura/aura/lib/aura/context/base.rb) 在面对超出 `max_state_chars` 的上下文时，根据信息优先级梯次抛弃 LSP 诊断、系统环境甚至工具列表，确保核心任务指令不溢出。

## Chapter 11 — Compost (第十一章：堆肥 — 经验与失败的沉淀)
*   **11.1 将失败转变为养料**
    *   Ralph Loop 生成的每一份 `critic_audit_*.md` 记录了代码之所以编译失败、逻辑不达标的详细物理轨迹。
    *   [ralph_loop.rb](file:///Users/frank/Desktop/Towards%20AGI/aura/aura/lib/aura/kernel/ralph_loop.rb) 通过 `load_previous_critique` 将这一段“堆肥”读回上下文，指导智能体避免踩相同的坑。

## Chapter 12 — Harvest (第十二章：收获 — 花园价值的提炼)
*   **12.1 收获的高保真提取**
    *   最终产出物（PR 提交、`research_report.md`、assets 绘图、自动打包的全局 Gem `aura sync`）。
    *   展示收获是如何通过完整的 Gardening 栽培自然涌现出来的。

---

# Part III — Philosophy of Gardening (智能体园艺工程哲学)

> 智能体园艺不仅是一种技术实践，更是迈向 AGI 的工程方法论。本部分深入探讨系统持久性与模式演进。

## Chapter 13 — OS as the Agent's Workspace (第十三章：操作系统即智能体的工作区)
*   **13.1 为什么是 OS 级别而非应用级别？**
    *   深入剖析 Aura OS 将文件系统、进程管理、Git VCS、和 SQLite 与 Agent 内核结合的设计权衡。
*   **13.2 文件夹即内存的终极潜能**
    *   探讨通过标准文件读写和 Shell 实现跨 LLM 厂商的通用 Harness 系统。

## Chapter 14 — Persistence & Amnesia (第十四章：持久性与遗忘的平衡哲学)
*   **14.1 智能来自于有选择的遗忘**
    *   探讨遗忘策略（Amnesia）在长周期任务中的关键作用：如果什么都记，等于什么都记不住。
*   **14.2 Aura 记忆分层设计 (Memory Tiers)**
    *   分析 [policy.rb](file:///Users/frank/Desktop/Towards%20AGI/aura/aura/lib/aura/memory/policy.rb) 中的事件分层分级保留算法（Ephemeral / Working / Insights / Permanent），探寻最优的记忆过滤模型。

## Chapter 15 — Deadlocks, Loops & Failures (第十五章：死锁、陷入死循环与自愈机制)
*   **15.1 Agent 常见运行死结**
    *   幻觉循环（重复调用同一个失效命令）、上下文饱和后胡言乱语、沙箱异常导致的孤立僵尸进程。
*   **15.2 操作系统级别的修复模式**
    *   如何通过 physical tools 物理状态检查（如 RSpec/PyTest）、批判审计以及自动 shadow 快照回滚来实现受控的容错自愈。

## Chapter 16 — Conclusion (第十六章：结语：迈向 AGI 的园艺范式)
*   **16.1 范式转移的终极蓝图**
    *   迈向 AGI 过程中，智能体开发范式将彻底从“单次交互式 Prompting”转向“系统化 Gardening”的工作模式系统。
