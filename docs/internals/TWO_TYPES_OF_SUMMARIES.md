# Two Types of Summaries in Aura

## 概述

Aura 使用**两种不同类型的 summary**，它们有不同的来源、时机和配置：

```
┌─────────────────────────────────────────────────────────┐
│              Summary Types Comparison                   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  1. Call Summary (工具调用摘要)                         │
│     - 来源: LLM 在 tool call 中直接返回                  │
│     - 时机: 每次工具执行时                               │
│     - 配置: tool_protocol.call_summary.*                │
│     - 作用: 快速记录"agent 做了什么"                    │
│                                                         │
│  2. Metabolism Summary (代谢总结)                       │
│     - 来源: NarrativeService 调用 LLM 另行生成          │
│     - 时机: 代谢触发时（事件过多/字符超限）              │
│     - 配置: state_management.summarization.*            │
│     - 作用: 将旧事件压缩成简洁叙事                      │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 1️⃣ Call Summary (工具调用摘要)

### 工作流程

```
LLM 返回 Plan
  ↓
{
  "tool": "read_file",
  "args": {"file_path": "config.yml"},
  "summary": "读取配置文件检查数据库设置",  ← Call Summary
  "thought": "我需要先了解当前的配置"
}
  ↓
Runner.run_call()
  ↓
提取 summary 字段
  ↓
@state.commit_summary(summary, call_seq)
  ↓
存储到 summaries 表
  ↓
StateProvider 读取时展示在历史中
```

### 配置参数

```yaml
# config.yml
tool_protocol:
  call_summary:
    suggested_chars: 120      # 建议 LLM 返回的 summary 长度
    max_chars: 256            # summary 最大长度（超出截断）
    attach_max_chars: 1024    # 可以附加的工具输出最大长度
```

### 代码位置

**Runner.run_call()** ([runner.rb#L174-L184](file:///Users/frank/Desktop/Towards%20AGI/aura/aura/lib/aura/kernel/runner.rb#L174-L184)):

```ruby
def run_call(call)
  summary = call["summary"]
  
  # ... execute tool ...
  
  # Call Summary 处理
  maxc = fetch_call_summary_max           # 256
  attachc = fetch_summary_attach_max      # 1024
  s = summary.to_s if summary
  
  # 可选：附加工具输出
  attach = manifest_attach_output_to_summary?(tool)
  if attach
    body = res["content"] || res["output"] || res.to_json
    b = body.to_s
    s = [s, b].join("\n") if attachc && b.length <= attachc.to_i
  end
  
  # 截断并存储
  s = s[0, maxc] if maxc && s.length > maxc
  @state.commit_summary(s, call_seq || event_id) if s && !s.empty?
end
```

### 特点

- ✅ **即时性** - 每次工具执行都产生
- ✅ **简洁** - 120-256 字符
- ✅ **来自 LLM** - agent 自己总结做了什么
- ✅ **可附加输出** - 可以选择性附加工具结果

---

## 2️⃣ Metabolism Summary (代谢总结)

### 工作流程

```
Runner.observe()
  ↓
@metabolizer.metabolize()
  ↓
检查是否需要代谢
  - 事件数 > recent_events_n * 5
  - 或总字符 > max_state_chars
  ↓
选择旧事件（保留最近 recent_n 条）
  ↓
应用保留策略（Retention Tiers）
  - Tier 1 (Ephemeral): execution, observe → 可总结后删除
  - Tier 2 (Working): plan, user → 保留不总结
  - Tier 3 (Insights): learn, interception → 长期保留
  - Tier 4 (Permanent): milestone → 永不删除
  ↓
NarrativeService.synthesize(old_events)
  ↓
调用 LLM 生成叙事性总结
  ↓
@state.commit_summary("Metabolism: #{summary}")
  ↓
删除旧事件
  ↓
通过 event_bus 发送通知
  - :metabolism_start
  - :metabolism_summary
  - :metabolism_complete
```

### 配置参数

```yaml
# config.yml
state_management:
  max_state_chars: 100000           # 触发代谢的字符阈值
  recent_events_n: 20               # 保留的最近事件数
  
  # 代谢总结配置
  summarization:
    enabled: true                   # 是否启用代谢总结
    max_chars: 500                  # 代谢总结的最大长度
    model: "gpt-4o"                 # 总结使用的模型（可选）
    focus_on:                       # 总结时关注的重点
      - "key_files_modified"
      - "critical_test_results"
      - "blockers_encountered"
      - "cumulative_result"
  
  # 记忆分层保留策略
  retention:
    execution:                      # Tier 1: 瞬态
      max_steps: 5
      summarize: true
    observe:                        # Tier 1: 瞬态
      max_steps: 3
      summarize: false
    plan:                           # Tier 2: 工作记忆
      max_steps: 50
      summarize: false
    user:                           # Tier 2: 工作记忆
      max_steps: 100
      summarize: false
    learn:                          # Tier 3: 洞察
      max_steps: 200
      summarize: true
    interception:                   # Tier 3: 洞察
      max_steps: 100
      summarize: false
    milestone:                      # Tier 4: 永久
      permanent: true
```

### 代码位置

**MemoryMetabolizer** ([memory_metabolizer.rb](file:///Users/frank/Desktop/Towards%20AGI/aura/aura/lib/aura/kernel/memory_metabolizer.rb)):

```ruby
class MemoryMetabolizer
  def metabolize
    # 1. 检查是否需要代谢
    should_metabolize = total_chars > max_chars || event_count > recent_n * 5
    
    # 2. 选择旧事件
    old_events = select_old_events(recent_n)
    
    # 3. 应用保留策略
    retention_result = apply_retention_policy(old_events)
    
    # 4. 生成代谢总结
    if retention_result[:to_summarize].any?
      summary = generate_metabolism_summary(retention_result[:to_summarize])
      @state.commit_summary("Metabolism: #{summary}")
    end
    
    # 5. 删除旧事件
    delete_events(retention_result[:to_delete].map { |e| e["id"] })
    
    # 6. 发送事件通知
    emit_metabolism_start(...)
    emit_metabolism_summary(summary)
    emit_metabolism_complete(...)
  end
end
```

**Runner.observe()** ([runner.rb#L89-L93](file:///Users/frank/Desktop/Towards%20AGI/aura/aura/lib/aura/kernel/runner.rb#L89-L93)):

```ruby
def observe
  @state.record_event({ phase: "observe" })
  @metabolizer.metabolize  # 使用 MemoryMetabolizer
  auto_verify_core_tools
  Aura::Context.assemble(@project_path, @state, lsp_manager: @lsp_manager)
end
```

### 特点

- ✅ **批量性** - 一次性总结多个旧事件
- ✅ **叙事性** - 生成连贯的进展描述
- ✅ **来自 NarrativeService** - 专门的总结 LLM 调用
- ✅ **分层策略** - 不同类型事件有不同保留时间
- ✅ **事件通知** - 通过 event_bus 通知 UI

---

## 📊 两种 Summary 的对比

| 特性 | Call Summary | Metabolism Summary |
|------|--------------|-------------------|
| **来源** | LLM tool call 返回 | NarrativeService 生成 |
| **时机** | 每次工具执行 | 代谢触发时 |
| **长度** | 120-256 字符 | 最多 500 字符 |
| **内容** | "做了什么" | "发生了什么进展" |
| **配置** | `tool_protocol.call_summary.*` | `state_management.summarization.*` |
| **保留策略** | 不受影响 | 根据 retention tiers |
| **事件通知** | 无 | :metabolism_start/complete |
| **LLM 调用** | 已包含在 plan 中 | 额外的 LLM 调用 |

---

## 🎯 实际例子

### Call Summary 示例

```json
// LLM 返回
{
  "tool": "bash_command",
  "args": {"command": "find . -name '*.rb' | head -10"},
  "summary": "查找项目中的 Ruby 文件",
  "thought": "先了解一下项目结构"
}

// 存储到 summaries 表
"查找项目中的 Ruby 文件"
```

### Metabolism Summary 示例

```
// 旧事件（将被删除）
1. execution: read_file config.yml → ok
2. execution: write_file test.rb → failed
3. execution: bash_command "ruby test.rb" → error
4. execution: write_file test.rb → ok (fixed syntax)
5. execution: bash_command "ruby test.rb" → ok

// 代谢总结（NarrativeService 生成）
"Agent read config.yml, attempted to create test.rb but encountered syntax error. 
After fixing the syntax issue, tests now pass successfully."

// 存储到 summaries 表
"Metabolism: Agent read config.yml, attempted to create test.rb but encountered 
syntax error. After fixing the syntax issue, tests now pass successfully."
```

---

## 🔄 完整的 Memory 生命周期

```
用户输入
  ↓
Plan (LLM 返回 tool call + summary)
  ↓
Execute Tool
  ↓
Call Summary → commit_summary()  ← 第一种 summary
  ↓
Metabolizer 检查是否需要代谢
  ↓
如果需要:
  ├─ 选择旧事件
  ├─ 应用 retention policy
  ├─ NarrativeService.synthesize()
  ├─ Metabolism Summary → commit_summary()  ← 第二种 summary
  └─ 删除旧事件
  ↓
Provider 读取:
  ├─ 最近的 events (chronological)
  └─ 最近的 summaries (包括 call summaries + metabolism summaries)
  ↓
组装成 Context 给 LLM
```

---

## 📝 配置建议

### 开发环境（快速迭代）

```yaml
state_management:
  max_state_chars: 50000          # 较低阈值，频繁代谢
  recent_events_n: 10             # 保留较少事件
  
  summarization:
    enabled: true
    max_chars: 300                # 较短总结
  
  retention:
    execution:
      max_steps: 3                # 很快删除
      summarize: true
```

### 生产环境（保留更多历史）

```yaml
state_management:
  max_state_chars: 200000         # 较高阈值
  recent_events_n: 50             # 保留更多事件
  
  summarization:
    enabled: true
    max_chars: 800                # 较长总结
  
  retention:
    execution:
      max_steps: 10               # 保留更多
      summarize: true
    plan:
      max_steps: 100              # 长期保留计划
```

### 调试模式（保留所有）

```yaml
state_management:
  max_state_chars: 1000000        # 几乎不触发
  recent_events_n: 200            # 保留大量事件
  
  summarization:
    enabled: false                # 禁用代谢总结
  
  retention:
    execution:
      max_steps: 1000
      summarize: false
```

---

## 🎨 未来扩展

### 1. 智能保留策略

```ruby
# AI 标记重要事件为 milestone
if event_is_critical?(event)
  tag_as_milestone(event)  # 永不删除
end
```

### 2. 多层代谢

```
Level 1: 详细总结 (500 chars) - 保留 100 步
Level 2: 精简总结 (200 chars) - 保留 500 步
Level 3: 一句话总结 (50 chars)  - 永久保留
```

### 3. 跨会话记忆

```ruby
# 重要洞察存储到 variables 表，跨会话保留
@state.set_variable("insight:auth_bug", "JWT token needs refresh")
```

---

## 总结

**两种 Summary 协同工作：**

1. **Call Summary** - 即时的、简洁的工具调用记录
2. **Metabolism Summary** - 批量的、叙事性的历史压缩

**通过配置灵活控制：**
- `tool_protocol.call_summary.*` - 控制 Call Summary
- `state_management.summarization.*` - 控制 Metabolism Summary
- `state_management.retention.*` - 控制事件保留策略

**通过 event_bus 通知 UI：**
- :metabolism_start - 开始代谢
- :metabolism_summary - 生成了总结
- :metabolism_complete - 代谢完成

这是一个**灵活、可扩展、用户友好**的记忆管理系统！🎉
