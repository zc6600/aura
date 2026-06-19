# 9. 从 AutoKaggle 反推 Aura 设计改进

AutoKaggle 是一个很好的压力测试：它不是一次性代码生成，而是长周期、可恢复、带外部服务、带预算限制、带 verifier、带状态账本的定制化 agent。这个案例暴露出一些 Aura 设计上的缺口。

本章不是用户教程的必要步骤，而是给 Aura 开发者看的改进清单。

## 9.1 已解决：Ralph 需要可消费的验证证明

问题：

AutoKaggle 真实提交前必须证明某个 submission 已被 verifier 检查过。旧 Ralph 只返回：

```json
{"status":"completed","final":"..."}
```

这让业务工具无法稳定判断：

- verifier 命令是什么
- 是否通过
- stdout/stderr 摘要
- result 属于哪个 run
- result 是否晚于 submission 文件

改进：

Ralph 现在输出并持久化结构化 result artifact：

```text
.aura-workspace/state/ralph/runs/<ralph_run_id>/result.json
```

AutoKaggle 的 `ak_submit_guard` 可以消费 `ralph_result_path`，而不是依赖一个业务 wrapper 或手写布尔字段。

保留原则：

Ralph 仍然是 kernel loop，不是普通 tool。它的风格仍是“一个 agent 执行，另一个 verifier/critic 检查，不通过打回重做”。改进点只是让通过结果成为可寻址事实。

## 9.2 仍缺：长等待应该是一等 defer/resume

AutoKaggle 达到 Kaggle 提交上限时，正确行为是等待到下一次可提交窗口。现在只能：

```json
{"tool":"timer","args":{"seconds":900}}
```

然后分块等待。

这能跑，但不是最好的长任务抽象：

- 长 sleep 占用 agent turn。
- 工具 timeout 会限制等待长度。
- daemon 重启后缺少统一恢复语义。
- 用户很难查看“下次恢复时间”。

建议 Aura 增加一等 defer result：

```json
{
  "status": "deferred",
  "resume_at": "2026-06-18T00:00:00Z",
  "reason": "kaggle_daily_submit_limit",
  "resume_goal": "Retry ak_submit_guard for run candidate_42"
}
```

daemon/session runtime 到点恢复，`aura garden status` 显示 workspace 级 pending resume，总体节点详情由 `aura anchor status` 查看。

## 9.3 部分解决：workflow.yml 已能声明运行契约，但还不是状态机

AutoKaggle 的关键状态很明确：

```text
catalog -> train -> ralph_verify -> guard -> submit_or_wait -> poll -> attach_feedback -> next
```

Garden 的职责不是一个薄薄的说明文件。它本来就应该做 AutoKaggle tutorial 这类工作：组织项目脚手架、提示词、锚点、工具边界、阶段门禁，并把 agent 引导到 `skills/auto-kaggle/SKILL.md` 这样的内部执行规程。

当前 `workflow.yml` 已经能声明 params、Garden、Skill、prompts、required tools、stages 和默认 run goal，并由 `aura workflow doctor/status/run` 消费。这解决了“如何稳定启动和检查一个定制 workflow”的问题。

结合当前的 anchor 机制，一个轻量可落地的 runtime 方案是：

- 不引入独立重型状态机；
- 把最近一次恢复所需信息写进最新的 `anchor_submit` event；
- 由 tool 提供一个受限的 `anchor_runtime_update` 对象；
- 由 agent 补一段短 `summary` 和 `selected_next`；
- 恢复时优先读取最新 anchor runtime snapshot。

剩余缺口更准确地说是：workflow 还不是机器可执行状态机。它能声明 stages 和 anchors，但还不能把 transition 声明成由 Aura 强制检查的约束。

风险：

- agent 可能跳过 Ralph。
- agent 可能忘记 poll。
- agent 可能 CV 未记录就提交。
- agent 可能 wait 后重新训练而不是重试同一 candidate。

建议在现有 `workflow.yml` 基础上增加可选 transition 层：

```yaml
states:
  - catalog
  - train
  - ralph_verify
  - guard
  - wait
  - submit
  - poll
  - attach_feedback

transitions:
  train -> ralph_verify:
    requires:
      - registry.run.cv_score != null
  ralph_verify -> guard:
    requires:
      - ralph_result.status == completed
      - ralph_result.verification.passed == true
  guard -> wait:
    when: submit_guard.status == wait_required
  guard -> submit:
    when: submit_guard.status == ok
```

这不需要取代 Garden，也不需要把 workflow 变成完整编程语言。Garden 继续负责项目级上下文工程和 tutorial/scaffold 组织，`workflow.yml` 作为可运行契约；transition 层只负责强制检查阶段转换。

## 9.4 仍缺：Garden 脚手架入口还不够直接

目前用户要手动创建：

- `prompts/system/SOUL.md`
- `prompts/system/TOOLS.md`
- `prompts/ralph/ralph_system.md`
- `prompts/ralph/critic_rules.md`
- `skills/<name>/SKILL.md`
- `garden/<name>/garden.md`
- `tools/<name>/manifest.json`
- `anchors/*.json`
- `task.md`

这些文件正是 Garden 应该组织的项目级上下文。对高级用户可以接受，但对教程用户不友好。

建议新增命令：

```bash
aura garden init auto-kaggle --with-skill --with-prompts --with-ralph
```

或在现有 `aura garden init <playbook>` 基础上扩展 profile/模板参数：

```bash
aura garden init auto-kaggle --profile kaggle-autonomous
```

生成一套标准 Garden 项目目录，并把内部 skill、prompts、anchors、tools scaffold 一起装配好。

## 9.5 仍缺：工具之间缺少通用 artifact/fact 引用协议

AutoKaggle 有多种事实：

- `registry` 中的 run
- Ralph result artifact
- submit guard result
- Kaggle submission id
- leaderboard score
- wait/defer decision

现在每个工具自己约定字段名。建议 Aura 定义轻量 artifact reference：

```json
{
  "artifact": {
    "type": "ralph_result",
    "path": ".aura-workspace/state/ralph/runs/.../result.json",
    "sha256": "...",
    "created_at": "..."
  }
}
```

工具输出、anchor、blackboard、registry 都可以引用同一格式。

## 9.6 仍缺：外部服务轮询模式

Kaggle submit 后分数不是一定立刻可见。类似场景还有 CI、远程 batch job、云训练。

现在 agent 需要自己：

1. 调工具 poll。
2. 判断未完成。
3. 调 timer。
4. 再 poll。

建议增加 poll protocol：

```json
{
  "status": "pending",
  "poll_after_seconds": 120,
  "poll_call": {
    "tool": "ak_competition",
    "args": {"action": "submissions", "run_id": "candidate_42"}
  }
}
```

AgentLoop 或 daemon 可以识别这个结构并自动延续。

## 9.7 优先级建议

对 Aura 系统本身，优先级如下：

1. **已做**：Ralph result artifact。
2. **高优先级**：defer/resume 长等待。
3. **部分已做**：`workflow.yml` 作为可运行契约；下一步是 transition 机器检查层。
4. **中优先级**：artifact reference protocol。
5. **中优先级**：custom agent scaffold 命令。
6. **低优先级**：更智能的外部 service poll protocol。

AutoKaggle 可以先用现有系统落地，但这些改进会让类似定制化 agent 更少依赖提示词纪律和胶水脚本。
