require_relative "../lib/aura/interface/bridge"

# Mock project path
project_path = File.expand_path("../tmp_test_bridge", __dir__)
FileUtils.mkdir_p(project_path)

puts "--- Testing Bridge ---"

bridge = Aura::Interface::Bridge.new(project_path)

# Test 1: Callback Registration
puts "\nTest 1: Callback Registration"
callback_fired = false
bridge.on(:on_token) do |token|
  puts "Callback received token: #{token}"
  callback_fired = true
end

if bridge.instance_variable_get(:@callbacks)[:on_token]
  puts "✅ Callback Registration Passed"
else
  puts "❌ Callback Registration Failed"
  exit 1
end

# Test 2: Confirmation Hook
puts "\nTest 2: Confirmation Hook"
bridge.register_confirmation_hook(["dangerous_tool"])
hooks = bridge.hooks.instance_variable_get(:@hooks)

if hooks[:before_tool_execution]
  puts "✅ Hook Registration Passed"
else
  puts "❌ Hook Registration Failed"
  exit 1
end

# Test 3: Notification System
puts "\nTest 3: Notification System"
bridge.send(:notify, :on_token, "test_token")
if callback_fired
  puts "✅ Notification Passed"
else
  puts "❌ Notification Failed"
  exit 1
end

FileUtils.rm_rf(project_path)
