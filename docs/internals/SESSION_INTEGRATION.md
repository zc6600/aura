# SessionManager Integration Guide

## 集成层次总结

```
✅ 已集成：
  1. CLI Commands (aura session ...)
  2. Shell Session (启动时加载)
  3. Slash Commands (/session 切换)
  
❌ 不需要集成：
  1. Runner - 通过环境变量自动感知
  2. State/StateRecorder - 通过环境变量自动感知
  3. AgentLoop - 不关心会话，只处理逻辑
```

---

## 📍 集成点 1: CLI Commands

### 文件
- `lib/aura/cli/commands/session_command.rb` ✅ 新建
- `lib/aura/cli/commands/application_command.rb` ✅ 已注册

### 使用示例

```bash
# 列出所有会话
$ aura session list
Sessions:
  → research-task                   45 events  (last: 2024-01-15 14:30)
    default                         12 events  (last: 2024-01-14 10:00)
    experiment-abc                   8 events  (last: 2024-01-13 16:45)

Total: 3 session(s)

# 创建新会话
$ aura session create code-review
✓ Created session: code-review
  Database: /path/to/project/state/sessions/code-review.db
✓ Activated session: code-review

# 切换会话
$ aura session switch research-task
✓ Switched to session: research-task
  Database: /path/to/project/state/sessions/research-task.db

# 查看当前会话
$ aura session current
Current session: research-task
Database: /path/to/project/state/sessions/research-task.db

# 克隆会话（实验分支）
$ aura session duplicate working-version refactor-experiment
✓ Duplicated 'working-version' to 'refactor-experiment'

# 删除会话
$ aura session delete old-session
Are you sure you want to delete session 'old-session'? [y/N] y
✓ Deleted session: old-session

# 备份/恢复
$ aura session export important-project /backup/project.db
✓ Exported session 'important-project' to: /backup/project.db

$ aura session import /backup/project.db restored-project
✓ Imported session 'restored-project' from: /backup/project.db
```

---

## 📍 集成点 2: Shell Session

### 文件
- `lib/aura/cli/shell/session.rb` ✅ 已修改

### 行为

当用户启动 `aura chat` 时：

```ruby
def setup_environment
  @runner = Aura::Kernel::Runner.new(@project_path)
  
  # 初始化会话管理器
  @session_mgr = Aura::Context::SessionManager.new(@project_path)
  current_session = @session_mgr.current_name
  
  # 如果有激活的会话，显示提示
  if current_session
    puts "📝 Session: #{current_session}" if @options[:verbose]
  end
  
  # Runner 会自动使用当前会话的 DB
  # 因为 ENV["AURA_SESSION_NAME"] 已被设置
end
```

### 用户体验

```bash
# 启动 chat（使用默认会话）
$ aura chat
📝 Session: default
Welcome to Aura Shell. Type /help for commands.

# 启动 chat（verbose 模式）
$ aura chat -v
📝 Session: research-task
Verbose mode: ON
Welcome to Aura Shell. Type /help for commands.
```

---

## 📍 集成点 3: Slash Commands

### 文件
- `lib/aura/cli/shell/slash_command_manager.rb` ✅ 已修改

### 使用示例

在 `aura chat` 交互模式中：

```
aura> /session list
Aura Conversation Sessions:
------------------------------------------------------------
  * research-task                  (45 events)
    default                        (12 events)
    experiment-abc                  (8 events)
------------------------------------------------------------
Usage: /session <session_name>  - Switch session
       /session new             - Start a new timestamped session

aura> /session new
🔄 Switching conversation session to 'session_20240115_143022'...
Successfully switched and hot-loaded session 'session_20240115_143022'!

aura> /session code-review
🔄 Switching conversation session to 'code-review'...
Successfully switched and hot-loaded session 'code-review'!
```

---

## ❌ 不需要集成的地方

### 1. Runner

**原因**: Runner 通过环境变量自动感知会话

```ruby
# Runner 不需要知道 SessionManager
class Runner
  def initialize(project_path)
    @state = State.new(project_path)
    # State 内部会读取 ENV["AURA_SESSION_NAME"]
    # 或 ENV["AURA_STATE_DB_PATH"] 来确定 DB 路径
  end
end
```

### 2. State / StateRecorder

**原因**: State 通过环境变量自动解析 DB 路径

```ruby
class State
  def initialize(project_path)
    env_db = ENV["AURA_STATE_DB_PATH"]
    session_name = ENV["AURA_SESSION_NAME"]
    
    @db_path = if env_db
      env_db
    elsif session_name
      "state/sessions/#{session_name}.db"
    else
      "state/sessions/default.db"
    end
  end
end
```

### 3. AgentLoop

**原因**: AgentLoop 只关心逻辑流，不关心数据存储

```ruby
class AgentLoop
  def run(goal, ctx: nil, max_steps: nil)
    # 完全不涉及会话概念
    # Runner 负责提供 ctx
    # StateRecorder 负责存储事件
  end
end
```

---

## 🎯 环境变量流程

```
用户操作
  ↓
SessionManager.activate("research-task")
  ↓
设置环境变量：
  ENV["AURA_SESSION_NAME"] = "research-task"
  ENV["AURA_STATE_DB_PATH"] = nil  # 清除直接路径
  ↓
写入文件：
  state/active_session.txt = "research-task"
  ↓
Runner 启动
  ↓
State.new(project_path)
  ↓
读取环境变量 → 解析 DB 路径
  state/sessions/research-task.db
  ↓
所有操作都在这个 DB 中
```

---

## 📊 完整的用户工作流

### 场景 1: 日常开发

```bash
# 1. 查看当前项目有哪些会话
$ aura session list
Sessions:
  → default                         120 events  (last: 2024-01-15 09:00)
    bug-fix-auth                    45 events  (last: 2024-01-14 16:30)

# 2. 为新功能创建独立会话
$ aura session create add-payment
✓ Created session: add-payment
✓ Activated session: add-payment

# 3. 进入 chat 模式开发
$ aura chat
📝 Session: add-payment
Welcome to Aura Shell. Type /help for commands.

aura> Add payment integration using Stripe
[Agent works in the add-payment session]

# 4. 开发完成后，切回主会话
$ aura session switch default
✓ Switched to session: default

# 5. 如果实验失败，删除会话
$ aura session delete add-payment
Are you sure you want to delete session 'add-payment'? [y/N] y
✓ Deleted session: add-payment
```

### 场景 2: 会话分支实验

```bash
# 1. 基于正常工作版本创建实验分支
$ aura session duplicate working-version aggressive-refactor

# 2. 切换到实验分支
$ aura session switch aggressive-refactor

# 3. 在 chat 中进行激进重构
$ aura chat
📝 Session: aggressive-refactor

aura> Refactor the entire authentication module to use JWT
[Agent works aggressively]

# 4. 如果实验成功，可以合并洞察
# 如果失败，直接删除
$ aura session delete aggressive-refactor

# 5. 切回工作版本继续
$ aura session switch working-version
```

### 场景 3: 备份和迁移

```bash
# 1. 备份重要会话
$ aura session export production-fix /backup/production-fix-2024-01-15.db

# 2. 在另一台机器上恢复
$ aura session import /backup/production-fix-2024-01-15.db restored

# 3. 切换到恢复的会话
$ aura session switch restored
```

---

## 🔧 自定义集成

### 在你的代码中使用 SessionManager

```ruby
require "aura/context/session_manager"

# 创建会话管理器
sessions = Aura::Context::SessionManager.new(Dir.pwd)

# 检查当前会话
current = sessions.current_name
puts "Current: #{current}"

# 创建和激活
sessions.create("my-task")
sessions.activate("my-task")

# 现在创建 Runner，它会自动使用 my-task 会话
runner = Aura::Kernel::Runner.new(Dir.pwd)
runner.run("Do something...")
# 所有事件存储在 state/sessions/my-task.db
```

### Web 界面集成

```ruby
# 在 Web 应用中
get "/sessions" do
  sessions = Aura::Context::SessionManager.new(current_project).list
  json sessions
end

post "/sessions/switch" do
  name = params[:name]
  Aura::Context::SessionManager.new(current_project).activate(name)
  { status: "ok", session: name }.to_json
end
```

---

## 🎨 扩展建议

### 1. 会话标签（未来功能）

```ruby
sessions.create("bug-fix", tags: ["bug", "auth", "urgent"])

# 按标签搜索
bug_sessions = sessions.list.select { |s| 
  s[:tags].include?("bug") 
}
```

### 2. 会话模板（未来功能）

```ruby
# 预置配置的会话模板
sessions.create_from_template("new-feature", 
  template: "standard-dev-workflow")
```

### 3. 会话合并（未来功能）

```ruby
# 合并两个实验会话的洞察
sessions.merge("experiment-a", "experiment-b", "merged-insights")
```

---

## ✅ 集成检查清单

- [x] SessionManager 类创建
- [x] CLI `aura session` 命令
- [x] 注册到 ApplicationCommand
- [x] Shell Session 启动时加载
- [x] Slash `/session` 命令更新
- [x] Runner 通过环境变量自动感知
- [x] State 通过环境变量自动感知
- [x] 测试覆盖（14 个测试全部通过）

---

## 📝 总结

**设计原则：**
1. **上层管理** - SessionManager 在 CLI/Shell 层
2. **下层透明** - Runner/State 通过环境变量自动感知
3. **完全隔离** - 一会话一DB，互不干扰
4. **易于扩展** - 清晰的 API，方便未来功能

**集成点：**
- ✅ CLI: `aura session <command>`
- ✅ Shell: 启动时加载 + `/session` 切换
- ✅ 自动: Runner/State 通过环境变量

**不需要集成：**
- ❌ Runner - 已通过环境变量解耦
- ❌ State/StateRecorder - 已通过环境变量解耦
- ❌ AgentLoop - 不关心存储层

这是一个**简洁、解耦、易维护**的集成方案！🎉
