# State Architecture: Reader-Writer Pattern

## 架构概览

Aura 的状态管理采用了**读写分离**的架构模式，确保职责清晰、易于测试和维护。

```
┌─────────────────────────────────────────────────────────────┐
│                       Agent Loop                            │
│                                                             │
│  User Input → Plan → Execute → Learn → (repeat)            │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                    Runner (Orchestrator)                    │
│                                                             │
│  @recorder = StateRecorder.new(@state)                     │
│  - record_user(input)                                       │
│  - record_plan(plan_result)                                 │
│  - record_execution(tool, result)                           │
│  - record_learn()                                           │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                  StateRecorder (Writer)                     │
│                                                             │
│  职责：将事件写入数据库                                      │
│  - 标准化事件结构                                            │
│  - 验证数据完整性                                            │
│  - 处理序列化                                                │
│                                                             │
│  提供的方法：                                                │
│  ✓ record_user(content)                                     │
│  ✓ record_plan(plan_hash)                                   │
│  ✓ record_execution(tool, result)                           │
│  ✓ record_interception(tool, advice)                        │
│  ✓ record_learn(content)                                    │
│  ✓ record_custom(phase, payload)                            │
│  ✓ record_batch(events)                                     │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                  State (Database Layer)                     │
│                                                             │
│  SQLite Database (state/sessions/{session}.db)              │
│  - events table                                             │
│  - summaries table                                          │
│  - variables table                                          │
│  - undone_events/summaries tables                           │
│                                                             │
│  底层操作：                                                  │
│  - record_event(payload)                                    │
│  - metabolize_if_needed()                                   │
│  - undo/redo                                                │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                  StateProvider (Reader)                     │
│                                                             │
│  职责：从数据库读取事件并格式化为 LLM Context               │
│  - 读取最近的事件                                            │
│  - 格式化历史消息                                            │
│  - 提供变量和摘要                                            │
│  - 智能时间戳显示                                            │
│                                                             │
│  输出的格式：                                                │
│  # AGENT STATE & MEMORY                                     │
│  ### History:                                               │
│  - [10:30:00] User: List Ruby files                         │
│  - [10:30:05] Agent: I'll use find to search...             │
│  - [10:30:06] Tool bash_command: ok - file1.rb...           │
│                                                             │
│  ### Active Variables:                                      │
│  - tool_status:read_file: ready                             │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                  LLM / Planner                              │
│                                                             │
│  接收格式化的 Context，返回 Plan：                          │
│  {                                                          │
│    "tool": "bash_command",                                  │
│    "args": {"command": "find . -name '*.rb'"},              │
│    "thought": "I'll use find to search...",                 │
│    "summary": "Finding Ruby files"                          │
│  }                                                          │
└─────────────────────────────────────────────────────────────┘
```

## 事件结构规范

### 1. User Event
```ruby
{
  phase: "user",
  content: "List all Ruby files",
  call_seq: nil  # 可选，用于关联
}
```

### 2. Plan Event
```ruby
{
  phase: "plan",
  tool: "bash_command",
  args: { "command" => "find . -name '*.rb'" },
  thought: "I'll use find to search for Ruby files",
  summary: "Finding Ruby files",
  # 其他字段会被保留
}
```

### 3. Execution Event
```ruby
{
  phase: "execution",
  tool: "bash_command",
  result: {
    status: "ok",
    output: "file1.rb\nfile2.rb",
    success: true
  },
  call_seq: 42  # 关联到 user event ID
}
```

### 4. Interception Event
```ruby
{
  phase: "interception",
  tool: "dangerous_tool",
  advice: "Tool is not safe to run",
  reason: "Security check failed"  # 可选
}
```

### 5. Learn Event
```ruby
{
  phase: "learn",
  content: "User is interested in Ruby files"  # 可选
}
```

## 设计优势

### 1. **职责分离**
- **StateRecorder**: 专注于写入逻辑，确保数据一致性
- **StateProvider**: 专注于读取逻辑，优化展示格式
- **State**: 专注于数据库操作和事务管理

### 2. **类型安全**
```ruby
# ❌ 旧方式：容易出错，结构不统一
@state.record_event({ phase: "plan", plan: res })
@state.record_event({ phase: "execution", tool: tool, result: res })

# ✅ 新方式：结构化接口，自动验证
@recorder.record_plan(res)
@recorder.record_execution(tool, res, call_seq: id)
```

### 3. **易于测试**
```ruby
# 可以独立测试 Recorder 和 Provider
recorder = StateRecorder.new(mock_state)
recorder.record_plan({ tool: "test", args: {} })
assert_called_with(mock_state, :record_event, expected_payload)
```

### 4. **向后兼容**
- State 的底层 API (`record_event`) 保持不变
- StateRecorder 只是提供了更高级的抽象
- 现有代码可以逐步迁移

### 5. **扩展性**
```ruby
# 轻松添加新的事件类型
def record_custom_event(type, data)
  @recorder.record_custom(type, data)
end

# 批量操作支持事务
@recorder.record_batch([
  { type: "user", content: "..." },
  { type: "plan", plan: {...} },
  { type: "execution", tool: "...", result: {...} }
])
```

## 使用示例

### 在 Runner 中
```ruby
class Runner
  def initialize(project_path)
    @state = State.new(project_path)
    @recorder = StateRecorder.new(@state)  # 初始化 recorder
  end

  def record_user_input(input)
    @last_user_event_id = @recorder.record_user(input)
  end

  def plan(goal, context)
    res = @planner.plan(context, goal)
    @recorder.record_plan(res)  # 使用 recorder
    res
  end

  def run_call(call)
    res = @engine.execute(call["tool"], call["args"])
    @recorder.record_execution(call["tool"], res, call_seq: @last_user_event_id)
    res
  end
end
```

### 在 StateProvider 中
```ruby
class StateProvider
  def provide
    items = @db.get_recent_events_structured(phases: ["user", "plan", "execution"])
    
    items.each do |e|
      case e["phase"]
      when "user"
        # 显示用户消息
      when "plan"
        # 优先显示 thought，其次 summary
        thought = e["payload"]["thought"]
        summary = e["payload"]["summary"]
        body = thought || summary || "Calling #{e['tool']}"
      when "execution"
        # 显示工具执行结果
      end
    end
  end
end
```

## 文件位置

- **StateRecorder**: `lib/aura/context/state_recorder.rb`
- **StateProvider**: `lib/aura/context/state_provider.rb`
- **State**: `lib/aura/kernel/state.rb`
- **Runner**: `lib/aura/kernel/runner.rb`
- **Tests**: `test/context/test_state_recorder.rb`

## 迁移指南

如果你在其他地方直接调用 `@state.record_event`，建议迁移到 `@recorder`：

```ruby
# Before
@state.record_event({ phase: "plan", plan: result })
@state.record_event({ phase: "execution", tool: name, result: res })

# After
@recorder.record_plan(result)
@recorder.record_execution(name, res)
```

这会让代码更加清晰、类型安全，并且与 StateProvider 形成对称的架构。
