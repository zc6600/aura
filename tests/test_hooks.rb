require_relative "../lib/aura/kernel/runner"
require_relative "../lib/aura/kernel/hooks"
require_relative "../lib/aura/kernel/event_emitter"

# Mock project path
project_path = File.expand_path("../tmp_test_hooks", __dir__)
FileUtils.mkdir_p(project_path)

puts "--- Testing Hooks & Events ---"

runner = Aura::Kernel::Runner.new(project_path)

# Test 1: Event Emission
puts "\nTest 1: Event Emission"
event_triggered = false
runner.on(:tool_start) do |payload|
  puts "Listener received tool_start: #{payload[:tool]}"
  event_triggered = true
end

# We need to mock execution engine or use a simple tool that doesn't require much
# But run_call checks validator.
# Let's just trust that run_call emits :tool_start before validation.
# Actually, let's register a hook that blocks it, so we don't need actual tool execution.

# Test 2: Hook Blocking
puts "\nTest 2: Hook Blocking"
runner.hooks.register(:before_tool_execution) do |tool, args|
  if tool == "forbidden_tool"
    puts "Hook blocking forbidden_tool"
    false
  else
    true
  end
end

res = runner.run_call({ "tool" => "forbidden_tool", "args" => {} })
puts "Result status: #{res[:status]}"

if event_triggered && res[:status] == "blocked"
  puts "✅ Test Passed"
else
  puts "❌ Test Failed"
  puts "Event triggered: #{event_triggered}"
  puts "Result status: #{res[:status]}"
  exit 1
end

FileUtils.rm_rf(project_path)
