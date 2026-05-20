require_relative "../lib/aura/context/base"
require_relative "../lib/aura/context/markdown_workspace_provider"

# Mock project path
project_path = File.expand_path("../tmp_test_markdown_workspace", __dir__)
FileUtils.mkdir_p(project_path)

# Create dummy Markdown workspace files
File.write(File.join(project_path, "SOUL.md"), "You are a helpful AI assistant with a witty personality.")
File.write(File.join(project_path, "AGENTS.md"), "- Always double-check your code.\n- Be concise.")
File.write(File.join(project_path, "USER.md"), "User prefers Ruby over Python.")
FileUtils.mkdir_p(File.join(project_path, "memory"))
File.write(File.join(project_path, "memory", "2023-10-27.md"), "- Fixed a bug in the login flow.")

puts "--- Testing Markdown Workspace Integration ---"

# 1. Test Provider Directly
provider = Aura::Context::MarkdownWorkspaceProvider.new(project_path)
content = provider.provide

puts "\nGenerated Context:"
puts content

if content.include?("# AGENT PERSONA (SOUL)") &&
   content.include?("witty personality") &&
   content.include?("# OPERATING INSTRUCTIONS") &&
   content.include?("double-check your code") &&
   content.include?("# USER CONTEXT") &&
   content.include?("User prefers Ruby") &&
   content.include?("# RECENT MEMORY LOGS") &&
   content.include?("Fixed a bug")
  puts "\n✅ MarkdownWorkspaceProvider works correctly."
else
  puts "\n❌ MarkdownWorkspaceProvider failed to load some files."
  exit 1
end

# 2. Test Integration in Base (Assembly)
# Mock DB object
db = Object.new

# We need to mock other providers or ensure they don't crash
# Since Base requires other files, we rely on the require_relative in the test file
# which might fail if paths are wrong relative to test file location.
# But we are running from project root via `ruby -Ilib ...` usually.

begin
  assembler = Aura::Context::Base.new(project_path, db)
  full_context = assembler.assemble
  
  if full_context.include?("# AGENT PERSONA (SOUL)")
    puts "✅ Integration into Context::Base successful."
  else
    puts "❌ Integration into Context::Base failed (content missing)."
    exit 1
  end
rescue StandardError => e
  puts "❌ Integration into Context::Base crashed: #{e.message}"
  puts e.backtrace
  exit 1
end

# Cleanup
FileUtils.rm_rf(project_path)
