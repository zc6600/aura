require_relative "../lib/aura/kernel/runner"
require_relative "../lib/aura/kernel/job"

# Mock project path
project_path = File.expand_path("../tmp_test_job", __dir__)
FileUtils.mkdir_p(project_path)

puts "--- Testing Job/Run Object ---"

runner = Aura::Kernel::Runner.new(project_path)

# Test 1: Job Lifecycle
puts "\nTest 1: Job Lifecycle"
job = runner.start_job(input: "Test input")
puts "Job started: #{job.id}, Status: #{job.status}"

if job.status == :running && job.metadata[:input] == "Test input"
  puts "✅ Job Start Passed"
else
  puts "❌ Job Start Failed"
  exit 1
end

# Test 2: Event Association
puts "\nTest 2: Event Association"
# Simulate recording an event
event_id = runner.record_user_input("User input event")
if job.events.include?(event_id)
  puts "✅ Event Association Passed (User Input)"
else
  puts "❌ Event Association Failed (User Input)"
  exit 1
end

# Test 3: Job Completion
puts "\nTest 3: Job Completion"
ended_job = runner.end_job(:completed)
puts "Job ended: #{ended_job.id}, Status: #{ended_job.status}"

if ended_job.status == :completed && ended_job.ended_at
  puts "✅ Job Completion Passed"
else
  puts "❌ Job Completion Failed"
  exit 1
end

FileUtils.rm_rf(project_path)
