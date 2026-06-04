---
name: multi-agent-simulation
description: 模拟多智能体协作流（MetaGPT/Refine/Swarm/Debate 模式）。通过调度具有隔离背景和特定角色指令的 subagents，实现在 Task Level 上的专业分工与博弈。
requires:
  - subagent
  - blackboard
  - plan_task
---

# Multi-Agent Simulation (Orchestration Pattern)

本技能定义了如何在 Aura OS 的单智能体架构下，通过"时间分片"和"进程隔离"来模拟复杂的多智能体协作模式。

---

## 核心原理：认知分片 (Cognitive Sharding)

1. **进程隔离 (Process Isolation)**：每次 `subagent` 调用均启动一个独立的内核循环。
   - **环境变量**：系统自动注入 `AURA_SUBAGENT_ID` 和 `AURA_SUBAGENT_DEPTH`。
   - **递归哨兵**：`MAX_SUBAGENT_DEPTH=2`。
2. **角色注入 (Persona Projection)**：
   - **Persona 模式**：调用时指定 `persona`，自动加载 `state/personas/{persona}.json` 中的 `instructions`。
   - **Goal 模式**：通过 `[ROLE: Name]` 标签进行即时身份偏置。
3. **消息总线 (Blackboard)**：子进程之间通过 `state/bus/` 共享数据，支持原子写入和独占锁。

可用 Persona：`architect`, `coder`, `reviewer`, `refiner`, `judge`, `debater`, `diagnostician`。

---

## 主执行流程：编排者工作流 (Orchestrator Workflow)

作为主 Agent (Orchestrator)，你的核心职责并非直接解决问题，而是**规划结构、派发任务、汇总成果**。

### Phase 1: 任务规划 (Planning)
**目标**：确定多智能体协作的拓扑结构（如：是线性流水线还是并行分片？）。
- **工具调用**：使用 `plan_task` 记录并同步多智能体协作的整体蓝图。
- **示例**：`plan_task: {"plan": "1. Architect 设计接口; 2. Coder 并行实现 A/B 模块; 3. Judge 验收成果"}`

### Phase 2: 任务派发与协调 (Orchestration)
**目标**：调度子进程并管理其生命周期。
- **执行命令**：循环调用 `subagent`（同步或异步）。
- **信息流转**：
  - 使用 `blackboard` 作为共享内存槽（Slot）。
  - 每个 `subagent` 的 `goal` 必须包含对黑板数据的引用（如："基于黑板 design_spec 编写代码"）。

### Phase 3: 总结与闭环 (Synthesis)
**目标**：将所有子进程分散的产出合而为一，给出最终答复。
- **流程**：读取 `blackboard: {"action": "list"}` -> 派发总结型 Subagent (Persona: `refiner`) -> 产出主任务最终稿。

---

## 场景案例与工具调用 (6 大模式)

### 1. 择优采样 (Best-of-N)

**目标**：并行采样，从中筛选质量最高的输出。

```
步骤 1 — 派发并行任务：
  {"goal": "实现快排，优化大数据量下的递归深度", "async_mode": true, "name": "gen_1", "max_steps": 10}
  {"goal": "实现快排，优化大数据量下的递归深度", "async_mode": true, "name": "gen_2", "max_steps": 10}

步骤 2 — 状态轮询：
  {"action": "status", "job_id": "gen_1_xxxx"}
  {"action": "status", "job_id": "gen_2_xxxx"}

步骤 3 — 裁判裁决：
  {"persona": "judge", "goal": "对比 gen_1 和 gen_2 的产出（见黑板），选出最优解并写入 blackboard key=winner"}
```

---

### 2. 迭代精炼 (Iterative Refinement)

**目标**：通过连续不断的反馈循环打磨终稿。

```
Loop (直到满意):
  1. subagent: {"persona": "reviewer", "goal": "审查当前 draft.md，给出 3 个潜在 Bug", "max_steps": 5}
  2. blackboard: {"action": "write", "key": "review_feedback", "content": {"bugs": [...]}}
  3. subagent: {"persona": "refiner", "goal": "根据黑板 review_feedback 修改代码, 产出改进版 draft.md", "max_steps": 8}
  4. blackboard: {"action": "delete", "key": "review_feedback"}
```

---

### 3. 层级分解 (Hierarchical Decomposition / MetaGPT)

**目标**：架构师→编码员→测试员的流水线分工。

```
步骤 1 — 架构设计：
  subagent: {"persona": "architect", "goal": "设计 auth 模块的文件结构和接口定义，输出到 blackboard key=design_spec", "max_steps": 8}

步骤 2 — 编码实现（可并行多文件）：
  subagent: {"persona": "coder", "goal": "根据黑板 design_spec 实现 auth/login.py", "max_steps": 12}
  subagent: {"persona": "coder", "goal": "根据黑板 design_spec 实现 auth/register.py", "max_steps": 12}

步骤 3 — 代码审查：
  subagent: {"persona": "reviewer", "goal": "审查 auth/ 目录下所有新文件，给出修改建议", "max_steps": 6}
```

---

### 4. Swarm Fan-Out (多专家分片)

**目标**：多个专家同时处理不同子任务，最终汇总。

```
步骤 1 — 主进程分发任务清单到黑板：
  blackboard: {"action": "write", "key": "task_manifest", "content": {"tasks": ["优化数据库查询", "修复前端样式", "编写API文档"]}}

步骤 2 — 并行派发专家：
  subagent: {"goal": "完成任务: 优化数据库查询，产出写入 blackboard key=result_db", "async_mode": true, "name": "expert_db", "max_steps": 15}
  subagent: {"goal": "完成任务: 修复前端样式，产出写入 blackboard key=result_fe", "async_mode": true, "name": "expert_fe", "max_steps": 15}
  subagent: {"goal": "完成任务: 编写API文档，产出写入 blackboard key=result_doc", "async_mode": true, "name": "expert_doc", "max_steps": 15}

步骤 3 — 轮询完成后汇总：
  blackboard: {"action": "list", "key": "*"}
  subagent: {"goal": "汇总 result_db, result_fe, result_doc 三个黑板 key 的产出，生成最终报告", "max_steps": 8}

步骤 4 — 清理：
  blackboard: {"action": "delete", "key": "result_db"}
  blackboard: {"action": "delete", "key": "result_fe"}
  blackboard: {"action": "delete", "key": "result_doc"}
```

---

### 5. 辩论对抗 (Debate / Adversarial)

**目标**：正反方辩论，裁判裁决，适用于高风险决策。

```
步骤 1 — 正方立论：
  subagent: {"persona": "debater", "goal": "[正方] 论证应该使用微服务架构，写入 blackboard key=argument_pro", "max_steps": 8}

步骤 2 — 反方立论：
  subagent: {"persona": "debater", "goal": "[反方] 论证应该使用单体架构，参考黑板 argument_pro 进行反驳，写入 blackboard key=argument_con", "max_steps": 8}

步骤 3 — 裁判裁决：
  subagent: {"persona": "judge", "goal": "阅读 argument_pro 和 argument_con，做出最终裁决并给出理据", "max_steps": 6}
```

---

### 6. 共识投票 (Consensus Voting)

**目标**：多个 agent 独立决策后投票，适用于需要集体智慧的场景。

```
步骤 1 — 独立投票（并行）：
  subagent: {"goal": "独立评估这段代码的质量(1-10分)并给出理由，写入 blackboard key=vote_1", "async_mode": true, "name": "voter_1", "max_steps": 5}
  subagent: {"goal": "独立评估这段代码的质量(1-10分)并给出理由，写入 blackboard key=vote_2", "async_mode": true, "name": "voter_2", "max_steps": 5}
  subagent: {"goal": "独立评估这段代码的质量(1-10分)并给出理由，写入 blackboard key=vote_3", "async_mode": true, "name": "voter_3", "max_steps": 5}

步骤 2 — 汇总投票：
  blackboard: {"action": "list", "key": "*"}
  主进程读取 vote_1, vote_2, vote_3 并计算平均分/多数决。
```

---

## 进阶特技 (Advanced Scaling)

### 层级观测 (Hierarchical Observability)
系统在 `.aura/state/subagents/{parent_id}/{child_id}` 下组织日志。
- **轨迹导出**：同步执行的 Subagent 会自动导出 `trajectory.txt`，用于追溯子进程的思维路径。

### 动态重编排 (Re-Orchestration)
如果 `subagent` 返回 `status: "failed"`，主进程应：
```
subagent: {"persona": "diagnostician", "goal": "分析以下失败报告并给出修复策略: {error_details}", "max_steps": 6}
```
生成新的 subagent 担任诊断员角色，而不是直接介入子进程细节。

### 并发控制 (Blackboard Locking)
在多个子进程尝试修改同一 Key 时必须加锁：
```
blackboard: {"action": "lock", "key": "shared_resource", "timeout": 5}
// ... 执行修改 ...
blackboard: {"action": "release", "key": "shared_resource"}
```

---

## 最佳实践 (Best Practices)

1. **预算控制 (Budget Guard)**：
   - 始终显式设置 `max_steps`（推荐 5-15）和 `timeout`，防止子进程陷入无效循环。

2. **交付物优先 (Deliverables First)**：
   - 子进程必须在结束前生成具体的产出文件（如 `draft.md`）或写入黑板。不要依赖"思维泄露"。
   - 子进程应通过 `final` 工具返回结构化摘要（含 `summary` 字段）。

3. **上下文清理 (Context Cleanup)**：
   - 在长链任务中，主进程读取完黑板信息后，应通过 `{"action": "delete", "key": "..."}` 清理过期数据。
   - 用 `{"action": "list", "key": "*"}` 检查残留。

4. **原子化 Goal**：
   - 给 Subagent 的 Goal 越具体，幻觉率越低。

5. **`[SCOPE]` 提示性标签**：
   - 可以在 Goal 中使用 `[SCOPE: path/to/file]` 提示子进程聚焦特定文件。注意：这是软性约定，不强制限制文件访问。
