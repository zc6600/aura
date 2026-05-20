require_relative "../lib/aura/kernel/runner"
require_relative "../lib/aura/kernel/job"

# Mock project path
project_path = File.expand_path("../tmp_test_hooks_advanced", __dir__)
FileUtils.mkdir_p(project_path)

puts "--- Testing Advanced Hooks & Concurrency ---"

runner = Aura::Kernel::Runner.new(project_path)

# Test 1: Concurrency Lock
puts "\nTest 1: Concurrency Lock"
runner.start_job(input: "Job 1")
begin
  runner.start_job(input: "Job 2")
  puts "❌ Lock Failed (Should have raised error)"
  exit 1
rescue RuntimeError => e
  puts "✅ Lock Passed: #{e.message}"
end
runner.end_job(:completed)

# Test 2: before_planning Hook
puts "\nTest 2: before_planning Hook"
runner.hooks.register(:before_planning) do |payload|
  payload[:context] = payload[:context] + "\n[Injected Context]"
end

# We need to mock Planner or observe to test this fully without API calls.
# But we can check if the hook runs.
# Let's mock the observe method in Runner instance to return a string.
def runner.observe
  "Original Context"
end

# We also need to mock Planner to avoid API call.
# Let's mock Aura::Kernel::Planner
module Aura
  module Kernel
    class Planner
      def initialize(path); end
      def plan(ctx, goal)
        { "plan" => "mock", "context_received" => ctx }
      end
    end
  end
end

res = runner.plan("goal")
if res["context_received"].include?("[Injected Context]")
  puts "✅ before_planning Hook Passed"
else
  puts "❌ before_planning Hook Failed"
  puts "Context: #{res["context_received"]}"
  exit 1
end

# Test 3: after_tool_execution Hook
puts "\nTest 3: after_tool_execution Hook"
runner.hooks.register(:after_tool_execution) do |payload|
  if payload[:tool] == "test_tool"
    payload[:result]["output"] = "Sanitized Output"
  end
end

# Mock ExecutionEngine
module Aura
  module Kernel
    class ExecutionEngine
      def initialize(path, lsp_manager: nil); end
      def execute(tool, args)
        { "output" => "Original Output" }
      end
    end
  end
end

# Mock Validator
module Aura
  module Kernel
    class ToolValidator
      def initialize(path, config, state); end
      def status_for(tool); { state: "ready" }; end
      def ensure_active(tool); { ok: true }; end
    end
  end
end

runner.start_job(input: "Test Job")
res = runner.run_call({ "tool" => "test_tool", "args" => {} })

if res["output"] == "Sanitized Output"
  puts "✅ after_tool_execution Hook Passed"
else
  puts "❌ after_tool_execution Hook Failed"
  puts "Output: #{res["output"]}"
  exit 1
end

FileUtils.rm_rf(project_path)
