# frozen_string_literal: true
#
# Aura Memory Module - Basic Usage Examples
#
# This file demonstrates how to use the new Memory module
#

require "fileutils"
require "tmpdir"

$LOAD_PATH.unshift File.expand_path("../../../", __FILE__)
require "aura/memory"

# Example 1: Basic initialization and recording
def example_basic_usage
  puts "=== Example 1: Basic Usage ==="

  test_dir = Dir.mktmpdir("aura_memory_example_")
  begin
    config = Aura::Memory::Config.new(
      store: { project_path: test_dir },
      metabolism: {
        max_chars: 100_000,
        recent_events_n: 20
      }
    )

    memory = Aura::Memory::Base.new(config: config)

    memory.recorder.record_user("Hello, Aura!")
    memory.recorder.record_plan(
      tool: "read_file",
      args: { file_path: "config.yml" },
      thought: "I should read the config file first",
      summary: "Reading config file"
    )
    memory.recorder.record_execution("read_file", { status: "ok", output: "config content" })
    memory.recorder.record_summary("This is a test summary")

    events = memory.provider.recent_events
    puts "Recorded #{events.size} events"
    events.each { |e| puts "  - #{e['phase']}: #{e['payload'].inspect[0..50]}" }

    context = memory.provider.assemble_context
    puts "\nContext keys: #{context.keys}"

    markdown = memory.provider.to_markdown
    puts "\nMarkdown output (first 200 chars):"
    puts markdown[0..200]

  ensure
    memory.store.close
    FileUtils.remove_entry(test_dir)
  end

  puts
end

# Example 2: Working with variables
def example_variables
  puts "=== Example 2: Variables ==="

  test_dir = Dir.mktmpdir("aura_memory_vars_")
  begin
    config = Aura::Memory::Config.new(store: { project_path: test_dir })
    memory = Aura::Memory::Base.new(config: config)

    memory.store.set_variable(key: "user_preference", value: "dark_mode")
    memory.store.set_variable(key: "last_project", value: "aura")

    puts "Variables:"
    memory.store.all_variables.each do |k, v|
      puts "  #{k} = #{v}"
    end

    puts "\nGetting 'user_preference': #{memory.store.get_variable('user_preference')}"
  ensure
    memory.store.close
    FileUtils.remove_entry(test_dir)
  end

  puts
end

# Example 3: Using Policy directly
def example_policy
  puts "=== Example 3: Retention Policy ==="

  policy = Aura::Memory::Policy.new

  test_events = [
    { "id" => 1, "phase" => "execution", "tool" => "bash_command" },
    { "id" => 2, "phase" => "plan", "tool" => "read_file" },
    { "id" => 3, "phase" => "milestone", "tool" => nil },
    { "id" => 4, "phase" => "user", "tool" => nil }
  ]

  result = policy.apply(test_events)

  puts "To summarize: #{result[:to_summarize].size} events"
  puts "To delete: #{result[:to_delete].size} events"
  puts "To keep: #{result[:to_keep].size} events"

  test_events.each do |event|
    tier = policy.tier_for(event)
    summarize = policy.should_summarize?(event)
    permanent = policy.permanent?(event)
    puts "  Phase #{event['phase']}: tier=#{tier}, summarize=#{summarize}, permanent=#{permanent}"
  end

  puts
end

# Example 4: Using the adapter with existing State
def example_adapter
  puts "=== Example 4: State Adapter ==="
  puts "(Requires full Aura framework to be loaded)"
  puts "Adapter is designed to wrap existing Aura::Kernel::State instances"
  puts "For more details, see lib/aura/memory/adapters/state_adapter.rb"
  puts
end

# Run all examples
if __FILE__ == $PROGRAM_NAME
  puts "Aura Memory Module - Usage Examples"
  puts "=" * 50
  puts

  example_basic_usage
  example_variables
  example_policy
  example_adapter

  puts "Done!"
end
