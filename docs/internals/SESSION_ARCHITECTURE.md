# Session Management Architecture

## 设计决策：不虚拟化，文件系统即抽象

### 为什么选择"一会话一DB"？

```
✅ 优点：
- 简单直接，天然的隔离
- 每个会话可以独立备份/删除/迁移
- 不需要复杂的多租户逻辑
- SQLite 文件很小（通常 < 10MB）

❌ 缺点：
- 跨会话查询需要打开多个DB（但很少需要）
- 全局搜索稍慢（但可以用索引文件解决）
```

---

## 架构层次

```
┌─────────────────────────────────────────────────────────┐
│            Application Layer (会话管理)                  │
│                                                         │
│  SessionManager (新)                                    │
│  - create("research-task")                              │
│  - activate("research-task")                            │
│  - list()                                               │
│  - delete("old-session")                                │
│  - duplicate("experiment-a", "experiment-b")            │
│  - export/import (备份/恢复)                             │
│                                                         │
│  存储: state/sessions.json (元数据)                      │
│        state/sessions/*.db (实际数据)                    │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│              Runner API (不感知会话)                     │
│                                                         │
│  runner = Runner.new(project_path)                      │
│  - Runner 通过环境变量知道操作哪个 DB                    │
│  - ENV["AURA_SESSION_NAME"] = "research-task"           │
│  - 或 ENV["AURA_STATE_DB_PATH"] = "/path/to/db"         │
│                                                         │
│  Runner 的职责：                                         │
│  - observe() → 从当前 DB 读取上下文                      │
│  - plan() → 写入 plan 事件到当前 DB                      │
│  - execute() → 写入 execution 事件到当前 DB              │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│              State (数据库层)                            │
│                                                         │
│  State.new(project_path)                                │
│  - 读取 ENV["AURA_STATE_DB_PATH"] 或                     │
│    ENV["AURA_SESSION_NAME"] 确定 DB 路径                 │
│  - state/sessions/{session_name}.db                     │
│                                                         │
│  提供的 API：                                            │
│  - record_event(payload)                                │
│  - get_recent_events_structured                         │
│  - metabolize_if_needed                                 │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│         Environment Provider (跨会话配置)                │
│                                                         │
│  存储在 .aura/config/ 或环境变量中：                     │
│  - User preferences (用户偏好)                           │
│  - Project conventions (项目约定)                        │
│  - Tool configurations (工具配置)                        │
│  - API keys (通过 .env)                                  │
│                                                         │
│  不依赖特定会话 DB，所有会话共享                         │
└─────────────────────────────────────────────────────────┘
```

---

## 使用示例

### 1. 基本会话管理

```ruby
require "aura/context/session_manager"

# 初始化会话管理器
sessions = Aura::Context::SessionManager.new("/path/to/project")

# 创建新会话
session = sessions.create("code-review", description: "Reviewing PR #123")
puts "Created: #{session[:db_path]}"
# => Created: /path/to/project/state/sessions/code-review.db

# 激活会话（设置环境变量）
sessions.activate("code-review")

# 现在 Runner 会自动使用这个会话
runner = Aura::Kernel::Runner.new("/path/to/project")
# Runner 内部会读取 ENV["AURA_SESSION_NAME"] = "code-review"
# 然后 State 会打开 state/sessions/code-review.db

# 列出所有会话
all_sessions = sessions.list
all_sessions.each do |s|
  puts "#{s[:name]}: #{s[:event_count]} events, last active: #{s[:last_active_at]}"
end

# 切换会话
sessions.activate("default")
```

### 2. CLI 集成示例

```ruby
# bin/aura session create my-task
when "session"
  subcommand = ARGV[1]
  session_mgr = Aura::Context::SessionManager.new(Dir.pwd)
  
  case subcommand
  when "create"
    name = ARGV[2]
    session_mgr.create(name)
    puts "✓ Created session: #{name}"
    
  when "switch"
    name = ARGV[2]
    session_mgr.activate(name)
    puts "✓ Switched to session: #{name}"
    
  when "list"
    sessions = session_mgr.list
    current = session_mgr.current_name
    sessions.each do |s|
      marker = s[:name] == current ? " → " : "   "
      puts "#{marker}#{s[:name]} (#{s[:event_count]} events)"
    end
    
  when "delete"
    name = ARGV[2]
    session_mgr.delete(name)
    puts "✓ Deleted session: #{name}"
  end
```

### 3. 会话分支（实验）

```ruby
# 基于当前会话创建一个分支做实验
sessions = Aura::Context::SessionManager.new(Dir.pwd)

# 假设我们有一个正常工作的会话
sessions.activate("working-version")

# 创建一个分支来尝试激进的重构
sessions.duplicate("working-version", "refactor-experiment")
sessions.activate("refactor-experiment")

# 现在可以安全地实验，不会影响原会话
runner = Aura::Kernel::Runner.new(Dir.pwd)
runner.run("Refactor the authentication module...")

# 如果实验失败，切换回原会话
sessions.activate("working-version")

# 如果成功，可以删除实验会话
sessions.delete("refactor-experiment")
```

### 4. 备份和恢复

```ruby
sessions = Aura::Context::SessionManager.new(Dir.pwd)

# 备份重要会话
sessions.export("important-project", "/backup/important-project-2024-01-15.db")

# 恢复（比如换了一台机器）
sessions.import("/backup/important-project-2024-01-15.db", "restored-project")
sessions.activate("restored-project")
```

### 5. 在 Runner 中使用

```ruby
# 方式 1: 通过 SessionManager 设置
session_mgr = Aura::Context::SessionManager.new(project_path)
session_mgr.activate("my-session")
runner = Aura::Kernel::Runner.new(project_path)

# 方式 2: 直接指定 DB 路径（适合测试）
ENV["AURA_STATE_DB_PATH"] = "/tmp/test-session.db"
runner = Aura::Kernel::Runner.new(project_path)

# 方式 3: 通过会话名（适合多会话场景）
ENV["AURA_SESSION_NAME"] = "research-task"
runner = Aura::Kernel::Runner.new(project_path)
```

---

## 数据隔离保证

### 会话间完全隔离

```ruby
# Session A
sessions.activate("session-a")
runner_a = Runner.new(project_path)
runner_a.run("Analyze the codebase")
# → 所有事件存储在 state/sessions/session-a.db

# Session B
sessions.activate("session-b")
runner_b = Runner.new(project_path)
runner_b.run("Write documentation")
# → 所有事件存储在 state/sessions/session-b.db

# 两个会话的数据完全独立
# Session A 看不到 Session B 的事件
# Session B 看不到 Session A 的事件
```

### 验证隔离性

```ruby
require "sqlite3"

db_a = SQLite3::Database.new("state/sessions/session-a.db")
db_b = SQLite3::Database.new("state/sessions/session-b.db")

count_a = db_a.get_first_value("SELECT COUNT(*) FROM events")
count_b = db_b.get_first_value("SELECT COUNT(*) FROM events")

puts "Session A: #{count_a} events"
puts "Session B: #{count_b} events"
# 两个计数互不影响
```

---

## Environment Provider 的职责

跨会话的配置应该放在 Environment Provider 中，**而不是**会话 DB 中：

### ✅ 应该放在 Environment Provider

```ruby
# .aura/config/config.yml
llm:
  provider: "openai"
  model: "gpt-4"
  
user_preferences:
  language: "en"
  timezone: "UTC"
  max_tokens: 4096

project_conventions:
  code_style: "ruby-standard"
  test_framework: "minitest"
  commit_message_style: "conventional"

tool_configurations:
  bash_command:
    timeout: 30
    allowed_directories: ["/tmp", "/home"]
```

### ❌ 不应该放在会话 DB

```ruby
# 这些应该在会话 DB 中（会话特定的状态）
- 用户的当前目标（goal）
- 当前的计划步骤
- 工具执行历史
- 对话上下文
- 临时变量
```

---

## 与 StateRecorder 的关系

```
SessionManager (会话管理)
  ↓ 设置环境变量
  ↓ ENV["AURA_SESSION_NAME"] = "my-session"
  
Runner (编排)
  ↓ 创建 State
  ↓ @state = State.new(project_path)
  ↓ State 读取 ENV 确定 DB 路径
  
StateRecorder (写入)
  ↓ @recorder = StateRecorder.new(@state)
  ↓ @recorder.record_plan(plan)
  ↓ @recorder.record_execution(tool, result)
  
State (数据库)
  ↓ 写入到 state/sessions/my-session.db
  
StateProvider (读取)
  ↓ 从 state/sessions/my-session.db 读取
  ↓ 格式化为 LLM Context
```

---

## 文件结构

```
project/
├── .aura/
│   ├── config/
│   │   └── config.yml              # Environment Provider (跨会话)
│   └── .env                        # API keys (跨会话)
│
├── state/
│   ├── sessions.json               # Session 元数据
│   ├── active_session.txt          # 当前激活的会话名
│   └── sessions/
│       ├── default.db              # 默认会话
│       ├── research-task.db        # 研究任务会话
│       ├── code-review.db          # 代码审查会话
│       └── experiment-abc.db       # 实验分支会话
│
└── ...
```

---

## 最佳实践

### 1. 会话命名

```ruby
# ✅ 好的命名
sessions.create("fix-auth-bug")
sessions.create("add-payment-feature")
sessions.create("refactor-database-layer")

# ❌ 不好的命名
sessions.create("session1")
sessions.create("test")
sessions.create("temp")
```

### 2. 及时清理

```ruby
# 定期清理实验性会话
sessions.list.each do |s|
  if s[:name].start_with?("experiment-") && 
     s[:last_active_at] < 7.days.ago
    sessions.delete(s[:name])
  end
end
```

### 3. 重要会话备份

```ruby
# 项目里程碑时备份
sessions.export("production-fix", 
  "backups/production-fix-#{Date.today}.db")
```

---

## 性能考虑

### SQLite 文件大小

- **空会话**: ~50KB（只有 schema）
- **100 次对话**: ~2-5MB
- **1000 次对话**: ~20-50MB
- **代谢后**: 保持 < 10MB（通过 summary 替代旧事件）

### 多会话开销

```ruby
# 10 个会话的总大小
10 * 5MB = 50MB  # 完全可以接受

# 打开/切换会话的时间
< 10ms  # SQLite 打开文件非常快
```

---

## 未来扩展

### 1. 会话标签和搜索

```ruby
sessions.create("bug-fix", tags: ["bug", "auth"])
sessions.create("feature", tags: ["feature", "payment"])

# 按标签搜索
bug_sessions = sessions.list.select { |s| 
  s[:tags].include?("bug") 
}
```

### 2. 会话合并（高级）

```ruby
# 将两个相关会话的洞察合并
sessions.merge("experiment-a", "experiment-b", "merged-insights")
```

### 3. 会话模板

```ruby
# 基于模板创建会话（预置配置）
sessions.create_from_template("new-feature", 
  template: "standard-dev-workflow")
```

---

## 总结

**SessionManager 提供了：**
- ✅ 简单的"一会话一DB"抽象
- ✅ 完整的生命周期管理（创建/切换/删除/备份）
- ✅ 天然的数据隔离
- ✅ 与现有 Runner/State 完全兼容

**不虚拟化 DB 的理由：**
- ✅ 文件系统就是天然的多租户
- ✅ 每个会话完全独立
- ✅ 易于理解和维护
- ✅ 备份/迁移极其简单

**Environment Provider 负责：**
- ✅ 跨会话的配置（用户偏好、项目约定）
- ✅ 不依赖特定会话
- ✅ 所有会话共享

这是一个**简洁、实用、易扩展**的设计！🎉
